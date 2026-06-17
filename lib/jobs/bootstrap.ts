import 'server-only';
import { revalidateTag } from 'next/cache';
import { createServiceClient } from '@/lib/supabase/server';
import { joinMatchTeams } from '@/lib/supabase/queries';
import type { Database } from '@/lib/supabase/types';
import { crawlWikipedia, crawlWikipediaLong } from '@/lib/crawl/playwright-adapter';
import { espnFetchSummary, espnFindEvent } from '@/lib/crawl/espn-adapter';
import { extractJSON } from '@/lib/llm';
import { SCHEDULE_EXTRACTION, SQUAD_EXTRACTION, LIVE_SCORE_EXTRACTION } from '@/lib/llm/prompts';
import { matchFixture, matchTeam, type ExtractedLiveScores } from './helpers';
import { generateMatchReview, generateHypeBlurb } from './reviews';
import { GROUPS } from '@/lib/domain/standings';
import { isBigMatch } from '@/lib/domain/big-match';
import { resolveBracket } from '@/lib/domain/bracket';

/**
 * Bootstrap job — idempotent backfill, safe to re-run any time:
 *   1. Fill null kickoff_utc/venue on schedule rows (crawl per group).
 *   2. Backfill final scores for scheduled-but-past matches (catch-up the
 *      30s live tick can't do — it only handles imminent/live games).
 *   3. Seed 26-man squads for teams that have no players yet.
 *   4. Generate missing reviews for finished matches and hype blurbs for
 *      upcoming big matches.
 *   5. Resolve knockout bracket slots from completed groups.
 * Everything already present is skipped.
 */

// Wikipedia uses different forms for some teams than FIFA's official names.
const WIKI_TEAM_ALIASES: Record<string, string[]> = {
  czechia: ['czech republic'],
  turkiye: ['turkey'],
  'türkiye': ['turkey'],
};

const normalize = (s: string) =>
  s
    .normalize('NFD')
    // strip combining diacritics: Curaçao → Curacao, Türkiye → Turkiye
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();

/**
 * Slice a team's section out of the consolidated "2026 FIFA World Cup squads"
 * article. The page renders each squad as: a line with the team name (header),
 * then a Head coach line, then the 26-row roster table. We find the team's
 * header line and return up to ~8000 chars after it (enough for ~26 rows).
 */
function sliceTeamSection(doc: string, teamName: string): string | null {
  if (!doc) return null;
  const lines = doc.split('\n');
  const candidates = [teamName, ...(WIKI_TEAM_ALIASES[normalize(teamName)] ?? [])].map(normalize);
  const headerIdx = lines.findIndex((l) => {
    const n = normalize(l);
    return candidates.some((c) => n === c || n === `${c} squad`);
  });
  if (headerIdx === -1) return null;
  return lines.slice(headerIdx, headerIdx + 200).join('\n').slice(0, 8000);
}

interface ExtractedFixture {
  home: string;
  away: string;
  kickoff_utc: string;
  venue: string | null;
  city: string | null;
}

export async function runBootstrap() {
  const log = (msg: string) => console.log(`[bootstrap] ${msg}`);
  const t0 = Date.now();
  log('start');
  const db = createServiceClient();
  const summary = {
    kickoffsFilled: 0,
    resultsBackfilled: 0,
    squadsSeeded: 0,
    lineupsBackfilled: 0,
    eventsBackfilled: 0,
    reviewsGenerated: 0,
    blurbsGenerated: 0,
    bracketUpdates: 0,
    errors: [] as string[],
  };

  const [{ data: teams }, { data: matches }] = await Promise.all([
    db.from('teams').select('*'),
    db.from('matches').select('*').order('match_number'),
  ]);
  if (!teams || !matches) {
    summary.errors.push('Could not load teams/matches');
    return summary;
  }

  // ---- 1. Schedule backfill (group fixtures missing kickoff_utc) ----
  // Crawl one search per group that still has gaps; match extracted fixtures
  // to rows by team pairing. Knockout kickoffs resolve later (reconcile) once
  // teams are known.
  const groupsWithGaps = GROUPS.filter((g) =>
    matches.some((m) => m.group === g && m.stage === 'group' && !m.kickoff_utc)
  );
  log(`schedule backfill: ${groupsWithGaps.length} group(s) with gaps`);
  for (const g of groupsWithGaps) {
    log(`  crawl group ${g}`);
    try {
      const text = await crawlWikipedia(`2026 FIFA World Cup Group ${g}`);
      log(`    crawled ${text.length} chars; preview: ${text.slice(0, 120).replace(/\s+/g, ' ')}`);
      const extracted = await extractJSON<{ fixtures: ExtractedFixture[] }>(
        SCHEDULE_EXTRACTION,
        text
      );
      log(`    extracted ${extracted?.fixtures?.length ?? 0} fixture(s)`);
      for (const fx of extracted?.fixtures ?? []) {
        const home = matchTeam(fx.home, teams);
        const away = matchTeam(fx.away, teams);
        if (!home || !away) continue;
        const row = matches.find(
          (m) =>
            m.stage === 'group' &&
            !m.kickoff_utc &&
            ((m.home_team_id === home.id && m.away_team_id === away.id) ||
              (m.home_team_id === away.id && m.away_team_id === home.id))
        );
        if (!row || !fx.kickoff_utc) continue;
        const { error } = await db
          .from('matches')
          .update({
            kickoff_utc: fx.kickoff_utc,
            venue: row.venue ?? fx.venue,
            city: row.city ?? fx.city,
          })
          .eq('id', row.id);
        if (!error) {
          row.kickoff_utc = fx.kickoff_utc;
          revalidateTag('matches:all');
          revalidateTag(`match:${row.id}`);
          summary.kickoffsFilled++;
        }
      }
    } catch (e) {
      summary.errors.push(`schedule group ${g}: ${(e as Error).message}`);
    }
  }

  // ---- 2. Past-match result backfill ----
  // The 30s live tick only handles matches kicking off in the next 5 min or
  // currently live. Any scheduled match whose kickoff is already in the past
  // is stranded — pull results from each affected group's Wikipedia page.
  const now = Date.now();
  const pastByGroup = new Map<string, typeof matches>();
  for (const m of matches) {
    if (m.stage !== 'group' || m.status !== 'scheduled' || !m.kickoff_utc) continue;
    if (new Date(m.kickoff_utc).getTime() >= now) continue;
    if (!m.group) continue;
    const arr = pastByGroup.get(m.group) ?? [];
    arr.push(m);
    pastByGroup.set(m.group, arr);
  }
  log(`past-match backfill: ${pastByGroup.size} group(s) have completed games to score`);
  const newlyFinishedIds: string[] = [];
  for (const [g, groupMatches] of pastByGroup) {
    log(`  crawl results group ${g} (${groupMatches.length} match(es))`);
    try {
      const text = await crawlWikipedia(`2026 FIFA World Cup Group ${g}`);
      const extracted = await extractJSON<ExtractedLiveScores>(LIVE_SCORE_EXTRACTION, text);
      let applied = 0;
      for (const ex of extracted?.matches ?? []) {
        if (ex.status !== 'finished') continue;
        const home = matchTeam(ex.home, teams);
        const away = matchTeam(ex.away, teams);
        if (!home || !away) continue;
        const found = matchFixture(home, away, groupMatches);
        if (!found) continue;
        const { match, flipped } = found;
        const update = {
          status: 'finished' as const,
          minute: null,
          home_score: flipped ? ex.away_score : ex.home_score,
          away_score: flipped ? ex.home_score : ex.away_score,
        };
        const { error } = await db.from('matches').update(update).eq('id', match.id);
        if (!error) {
          Object.assign(match, update);
          revalidateTag('matches:all');
          revalidateTag(`match:${match.id}`);
          newlyFinishedIds.push(match.id);
          applied++;
        }
      }
      log(`    applied ${applied} result(s)`);
    } catch (e) {
      summary.errors.push(`results group ${g}: ${(e as Error).message}`);
    }
  }
  summary.resultsBackfilled = newlyFinishedIds.length;

  // ---- 3. Squad seeding (teams with zero players) ----
  // Wikipedia hosts every 26-man squad on one consolidated article: crawl it
  // once with a big cap, then slice per team by header anchor so each LLM
  // call only sees that team's section.
  // PostgREST caps every select at max_rows (default 1000); with ~26 players
  // per team that ceiling hits at ~38 teams, so a single select leaves the
  // last few teams looking unseeded even though they exist. Paginate to be
  // immune to the cap regardless of server config.
  const teamsWithPlayers = new Set<string>();
  {
    const PAGE = 1000;
    for (let offset = 0; ; offset += PAGE) {
      const { data: rows } = await db
        .from('players')
        .select('team_id')
        .range(offset, offset + PAGE - 1);
      if (!rows || rows.length === 0) break;
      for (const r of rows) teamsWithPlayers.add(r.team_id);
      if (rows.length < PAGE) break;
    }
  }
  log(`squad seeding: ${teamsWithPlayers.size} team(s) already have players in DB`);
  const teamsToSeed = teams.filter((t) => !teamsWithPlayers.has(t.id));
  log(`squad seeding: ${teamsToSeed.length} team(s) need squads`);

  let squadsDoc = '';
  if (teamsToSeed.length > 0) {
    try {
      squadsDoc = await crawlWikipediaLong('2026 FIFA World Cup squads');
      log(`  consolidated squads page: ${squadsDoc.length} chars`);
    } catch (e) {
      summary.errors.push(`squads page: ${(e as Error).message}`);
    }
  }

  for (const team of teams) {
    if (teamsWithPlayers.has(team.id)) continue; // skip already-seeded squads
    log(`  squad ${team.code}`);
    try {
      const section = sliceTeamSection(squadsDoc, team.name);
      if (!section) {
        log(`    no section found for ${team.name}`);
        continue;
      }
      log(`    section ${section.length} chars`);
      const extracted = await extractJSON<{
        players: Array<{
          name: string;
          shirt_number: number | null;
          position: string | null;
          club: string | null;
          is_captain: boolean;
        }>;
      }>(SQUAD_EXTRACTION, section);
      const players = (extracted?.players ?? []).filter((p) => p.name);
      log(`    extracted ${players.length} player(s)`);
      if (players.length < 11) continue; // implausible squad — try again next run
      // Coerce shirt_number to a real integer (LLM returns mixed string/number)
      // then de-duplicate within the batch. Both transforms are needed because
      // Postgres coerces "5" → 5 silently, which makes Set<string|number>
      // dedup miss the cross-type case and slip dupes to the DB.
      const seenNumbers = new Set<number>();
      const dedupedPlayers = players.map((p) => {
        let shirt: number | null = null;
        if (p.shirt_number != null) {
          const n = Number(p.shirt_number);
          if (Number.isInteger(n) && n > 0 && n < 100) shirt = n;
        }
        if (shirt == null) return { ...p, shirt_number: null };
        if (seenNumbers.has(shirt)) {
          log(`    note: duplicate #${shirt} for ${p.name}, nulling number`);
          return { ...p, shirt_number: null };
        }
        seenNumbers.add(shirt);
        return { ...p, shirt_number: shirt };
      });
      const { error } = await db.from('players').insert(
        dedupedPlayers.map((p) => ({
          team_id: team.id,
          name: p.name,
          shirt_number: p.shirt_number,
          position: p.position,
          club: p.club,
          is_captain: !!p.is_captain,
        }))
      );
      if (!error) {
        summary.squadsSeeded++;
        log(`    inserted ${dedupedPlayers.length} player(s)`);
      } else {
        log(`    insert error: ${error.message} (code=${error.code ?? '?'})`);
      }
    } catch (e) {
      summary.errors.push(`squad ${team.code}: ${(e as Error).message}`);
    }
  }

  // ---- 4. Lineups + events backfill via ESPN's public JSON API ----
  // One /summary call per finished match gives us both rosters (lineups) and
  // keyEvents (timeline). We write directly to lineups and matches.events
  // without going through the LLM — ESPN already returns structured data.
  const lineupSet = new Set<string>();
  {
    const PAGE = 1000;
    for (let offset = 0; ; offset += PAGE) {
      const { data: rows } = await db
        .from('lineups')
        .select('match_id')
        .range(offset, offset + PAGE - 1);
      if (!rows || rows.length === 0) break;
      for (const r of rows) lineupSet.add(r.match_id);
      if (rows.length < PAGE) break;
    }
  }
  // Two flavors of candidate:
  //   - Finished matches missing ANY extra (lineups, events, commentary,
  //     team stats, odds, gamecast). One ESPN call backfills all of them.
  //   - Upcoming matches missing their pre-match gamecast + odds. Same ESPN
  //     summary endpoint — ESPN populates lastFiveGames, leaders, and
  //     pickcenter even before kickoff.
  // Treat both {} and "wrappers with all-empty inner content" as missing. An
  // earlier bug stored {"home":{},"away":{}} for team_stats and gamecasts
  // padded with blank rows; those should re-fetch on next bootstrap.
  const isEmptyObj = (v: unknown) => !v || (typeof v === 'object' && Object.keys(v as object).length === 0);
  const isEmptyTeamStats = (v: unknown): boolean => {
    if (isEmptyObj(v)) return true;
    const t = v as { home?: object; away?: object };
    const homeEmpty = !t.home || Object.keys(t.home).length === 0;
    const awayEmpty = !t.away || Object.keys(t.away).length === 0;
    return homeEmpty && awayEmpty;
  };
  const isEmptyOdds = (v: unknown): boolean => {
    if (isEmptyObj(v)) return true;
    const o = v as { provider?: string; homeOdds?: number | null; awayOdds?: number | null; drawOdds?: number | null };
    return !o.provider && o.homeOdds == null && o.awayOdds == null && o.drawOdds == null;
  };
  const isEmptyGamecast = (v: unknown): boolean => {
    if (isEmptyObj(v)) return true;
    const g = v as {
      headToHead?: unknown[];
      lastFiveHome?: unknown[];
      lastFiveAway?: unknown[];
      leaders?: { home?: unknown[]; away?: unknown[] };
      officials?: unknown[];
    };
    return (
      !(g.headToHead?.length) &&
      !(g.lastFiveHome?.length) &&
      !(g.lastFiveAway?.length) &&
      !(g.leaders?.home?.length) &&
      !(g.leaders?.away?.length) &&
      !(g.officials?.length)
    );
  };
  const needsExtras = (m: typeof matches[number]) => {
    if (!lineupSet.has(m.id)) return true;
    if (Array.isArray(m.events) && m.events.length === 0) return true;
    if (Array.isArray(m.commentary) && m.commentary.length === 0) return true;
    if (isEmptyTeamStats(m.team_stats)) return true;
    if (isEmptyOdds(m.odds)) return true;
    if (isEmptyGamecast(m.gamecast)) return true;
    return false;
  };
  const espnCandidates = matches.filter((m) => {
    if (!m.home_team_id || !m.away_team_id || !m.kickoff_utc) return false;
    if (m.status === 'finished') return needsExtras(m);
    if (m.status === 'scheduled') {
      return isEmptyOdds(m.odds) || isEmptyGamecast(m.gamecast);
    }
    return false;
  });
  log(`ESPN backfill: ${espnCandidates.length} match(es) need ESPN data`);

  for (const m of espnCandidates) {
    const home = teams.find((t) => t.id === m.home_team_id);
    const away = teams.find((t) => t.id === m.away_team_id);
    if (!home || !away) continue;
    log(`  espn m${m.match_number} ${home.code} vs ${away.code}`);
    try {
      const ev = await espnFindEvent(home.name, away.name, home.code, away.code, m.kickoff_utc!);
      if (!ev) {
        log(`    ESPN: event not found`);
        continue;
      }
      const summary_ = await espnFetchSummary(ev.eventId, ev.homeAbbr, ev.awayAbbr);
      if (!summary_) {
        log(`    ESPN: no summary`);
        continue;
      }
      // Persist the rich-sync fields whether or not lineups changed — they're
      // cheap, idempotent, and the UI is hungry for them.
      const updateExtras: Database['public']['Tables']['matches']['Update'] = {};
      if (summary_.commentary.length > 0) updateExtras.commentary = summary_.commentary;
      if (summary_.teamStats.home || summary_.teamStats.away) updateExtras.team_stats = summary_.teamStats;
      if ((summary_.playerStats.home?.length ?? 0) + (summary_.playerStats.away?.length ?? 0) > 0)
        updateExtras.player_stats = summary_.playerStats;
      if (summary_.odds.provider || summary_.odds.homeOdds != null) updateExtras.odds = summary_.odds;
      const hasGamecastFields =
        (summary_.gamecast.headToHead?.length ?? 0) > 0 ||
        (summary_.gamecast.lastFiveHome?.length ?? 0) > 0 ||
        (summary_.gamecast.lastFiveAway?.length ?? 0) > 0 ||
        (summary_.gamecast.officials?.length ?? 0) > 0;
      if (hasGamecastFields) updateExtras.gamecast = summary_.gamecast;
      if (Object.keys(updateExtras).length > 0) {
        const { error } = await db.from('matches').update(updateExtras).eq('id', m.id);
        if (!error) {
          revalidateTag('matches:all');
          revalidateTag(`match:${m.id}`);
          log(`    extras: saved (${Object.keys(updateExtras).join(', ')})`);
        } else log(`    extras update error: ${error.message}`);
      }
      // Map ESPN home/away to our home/away. ESPN's "home" should match ours,
      // but defensively check via the abbreviations.
      const flipped =
        ev.homeAbbr.toLowerCase() !== home.code.toLowerCase() &&
        ev.awayAbbr.toLowerCase() === home.code.toLowerCase();
      const ourHomeSide = flipped ? summary_.away : summary_.home;
      const ourAwaySide = flipped ? summary_.home : summary_.away;

      // -- lineups --
      if (!lineupSet.has(m.id) && ourHomeSide && ourAwaySide) {
        if (ourHomeSide.starters.length === 11 && ourAwaySide.starters.length === 11) {
          const { data: squad } = await db
            .from('players')
            .select('*')
            .in('team_id', [home.id, away.id]);
          const rows: any[] = [];
          const pushSide = (side: typeof ourHomeSide, teamId: string) => {
            for (const role of ['starter', 'sub'] as const) {
              const list = role === 'starter' ? side.starters : side.subs;
              for (const p of list) {
                if (!p.name) continue;
                const sp = (squad ?? []).find(
                  (s) => s.team_id === teamId && s.name.toLowerCase() === p.name.toLowerCase()
                );
                rows.push({
                  match_id: m.id,
                  team_id: teamId,
                  player_id: sp?.id ?? null,
                  player_name: p.name,
                  shirt_number: p.shirt_number,
                  position: p.position,
                  role,
                  is_captain: !!p.is_captain,
                  formation: side.formation,
                });
              }
            }
          };
          pushSide(ourHomeSide, home.id);
          pushSide(ourAwaySide, away.id);
          const { error } = await db
            .from('lineups')
            .upsert(rows, { onConflict: 'match_id,team_id,player_name' });
          if (!error) {
            summary.lineupsBackfilled++;
            revalidateTag(`lineups:${m.id}`);
            revalidateTag('matches:all');
            log(`    lineups: inserted ${rows.length} row(s)`);
          } else {
            log(`    lineups insert error: ${error.message}`);
          }
        } else {
          log(`    lineups: partial XI (${ourHomeSide.starters.length}/${ourAwaySide.starters.length}), skip`);
        }
      }

      // -- events --
      const needEvents = Array.isArray(m.events) && m.events.length === 0;
      if (needEvents && summary_.events.length > 0) {
        const events = summary_.events.map((e) => ({
          minute: e.minute,
          stoppage: e.stoppage,
          type: e.type,
          team: e.team
            ? (flipped ? (e.team === 'home' ? 'away' : 'home') : e.team)
            : undefined,
          player: e.player,
          playerOff: e.playerOff,
          detail: e.detail,
        }));
        const { error } = await db.from('matches').update({ events }).eq('id', m.id);
        if (!error) {
          summary.eventsBackfilled++;
          m.events = events;
          revalidateTag('matches:all');
          revalidateTag(`match:${m.id}`);
          log(`    events: saved ${events.length}`);
        } else {
          log(`    events update error: ${error.message}`);
        }
      }
    } catch (e) {
      summary.errors.push(`espn m${m.match_number}: ${(e as Error).message}`);
    }
  }

  // ---- 5. Missing reviews + big-match hype blurbs ----
  const withTeams = joinMatchTeams(matches, teams);
  const { data: existingReviews } = await db.from('match_reviews').select('match_id');
  const reviewed = new Set((existingReviews ?? []).map((r) => r.match_id));
  const candidates = withTeams.filter((m) => !reviewed.has(m.id));
  log(`reviews/blurbs: ${candidates.length} candidate match(es)`);

  for (const m of withTeams) {
    if (reviewed.has(m.id)) continue;
    try {
      if (m.status === 'finished') {
        log(`  review m${m.match_number}`);
        if (await generateMatchReview(db, m)) {
          summary.reviewsGenerated++;
          revalidateTag('matches:all');
          revalidateTag(`review:${m.id}`);
        }
      } else if (isBigMatch(m, m.home_team, m.away_team).isBig) {
        log(`  blurb m${m.match_number}`);
        if (await generateHypeBlurb(db, m)) {
          summary.blurbsGenerated++;
          revalidateTag('matches:all');
          revalidateTag(`review:${m.id}`);
        }
      }
    } catch (e) {
      summary.errors.push(`review m${m.match_number}: ${(e as Error).message}`);
    }
  }

  // ---- 5. Knockout bracket slot resolution (after groups complete) ----
  let bracketUpdates = 0;
  try {
    for (const u of resolveBracket(teams, matches)) {
      const { id, ...fields } = u;
      const { error } = await db.from('matches').update(fields).eq('id', id);
      if (!error) {
        bracketUpdates++;
        revalidateTag('matches:all');
        revalidateTag(`match:${id}`);
      }
    }
  } catch (e) {
    summary.errors.push(`bracket: ${(e as Error).message}`);
  }
  log(`bracket: ${bracketUpdates} slot update(s)`);
  summary.bracketUpdates = bracketUpdates;

  log(`done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  return summary;
}
