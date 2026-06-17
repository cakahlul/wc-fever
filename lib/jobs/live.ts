import 'server-only';
import { revalidateTag } from 'next/cache';
import { createServiceClient } from '@/lib/supabase/server';
import { joinMatchTeams } from '@/lib/supabase/queries';
import { espnFetchSummary, espnFindEvent } from '@/lib/crawl/espn-adapter';
import { generateMatchReview } from './reviews';
import { resolveBracket } from '@/lib/domain/bracket';
import type { Database, Match, Team } from '@/lib/supabase/types';

/**
 * Live tick — runs every 30s from the PM2 ticker. Every tick it refreshes
 * every match from ESPN (incoming, live, and finished) so scores, lineups,
 * schedule changes, and post-match stat backfills are always in sync.
 *
 * All data comes from ESPN's public site.api summary endpoint, which returns
 * score + status + lineups + events + commentary + stats + odds + gamecast
 * in a single JSON call. One HTTP per relevant match per tick — no LLM, no
 * scraping.
 */

const KICKOFF_LOOKAHEAD_MS = 5 * 60 * 1000;
const STALE_AFTER_KICKOFF_MS = 3 * 60 * 60 * 1000;
const LINEUP_WINDOW_MIN_MS = 60 * 60 * 1000;
const LINEUP_WINDOW_MAX_MS = 75 * 60 * 1000;
// Post-match: ESPN keeps enriching stats/commentary/events for a while after
// the final whistle. Keep ticking finished matches for a bounded window so the
// final view isn't frozen at whatever the last live tick captured.
const POST_MATCH_REFRESH_MS = 4 * 60 * 60 * 1000;
const POST_MATCH_MIN_GAP_MS = 5 * 60 * 1000;

export async function runLiveTick() {
  const db = createServiceClient();
  const now = Date.now();

  const [{ data: matches }, { data: teams }] = await Promise.all([
    db.from('matches').select('*').order('match_number'),
    db.from('teams').select('*'),
  ]);
  if (!matches || !teams) return { skipped: true, reason: 'db unavailable' };

  const liveMatches = matches.filter((m) => m.status === 'live');
  const imminent = matches.filter(
    (m) =>
      m.status === 'scheduled' &&
      m.kickoff_utc &&
      new Date(m.kickoff_utc).getTime() - now <= KICKOFF_LOOKAHEAD_MS &&
      now - new Date(m.kickoff_utc).getTime() < STALE_AFTER_KICKOFF_MS
  );
  const lineupCandidates = matches.filter((m) => {
    if (m.status !== 'scheduled' || !m.kickoff_utc || !m.home_team_id || !m.away_team_id) return false;
    const untilKickoff = new Date(m.kickoff_utc).getTime() - now;
    return untilKickoff >= LINEUP_WINDOW_MIN_MS && untilKickoff <= LINEUP_WINDOW_MAX_MS;
  });
  const recentlyFinished = matches.filter((m) => {
    if (m.status !== 'finished' || !m.kickoff_utc) return false;
    const sinceKickoff = now - new Date(m.kickoff_utc).getTime();
    if (sinceKickoff <= 0 || sinceKickoff > POST_MATCH_REFRESH_MS) return false;
    return now - new Date(m.updated_at).getTime() >= POST_MATCH_MIN_GAP_MS;
  });

  // De-duplicate the time-critical buckets, then fall back to every other
  // match so incoming/finished rows also get refreshed every tick.
  const relevantById = new Map<string, Match>();
  for (const m of [...liveMatches, ...imminent, ...lineupCandidates, ...recentlyFinished, ...matches])
    relevantById.set(m.id, m);
  const relevant = [...relevantById.values()];

  if (relevant.length === 0) {
    return { skipped: true, reason: 'no matches in db' };
  }

  const summary = {
    skipped: false,
    scoresUpdated: 0,
    lineupsCrawled: 0,
    eventsUpdated: 0,
    commentaryUpdated: 0,
    statsUpdated: 0,
    oddsUpdated: 0,
    reviewsGenerated: 0,
    bracketUpdates: 0,
    errors: [] as string[],
  };

  const newlyFinished: string[] = [];
  const teamsById = new Map(teams.map((t) => [t.id, t]));

  for (const m of relevant) {
    if (!m.home_team_id || !m.away_team_id || !m.kickoff_utc) continue;
    const home = teamsById.get(m.home_team_id);
    const away = teamsById.get(m.away_team_id);
    if (!home || !away) continue;
    try {
      await tickOneMatch(db, m, home, away, summary, newlyFinished);
    } catch (e) {
      summary.errors.push(`m${m.match_number ?? '?'}: ${(e as Error).message}`);
    }
  }

  if (newlyFinished.length > 0) {
    const withTeams = joinMatchTeams(matches, teams);
    for (const id of newlyFinished) {
      const wt = withTeams.find((x) => x.id === id);
      if (wt && (await generateMatchReview(db, wt))) {
        revalidateTag(`review:${id}`);
        summary.reviewsGenerated++;
      }
    }
    for (const u of resolveBracket(teams, matches)) {
      const { id, ...fields } = u;
      const { error } = await db.from('matches').update(fields).eq('id', id);
      if (error) {
        summary.errors.push(`bracket ${id} [${Object.keys(fields).join(',')}]: ${error.message}`);
      } else {
        revalidateTag(`match:${id}`);
        summary.bracketUpdates++;
      }
    }
  }

  return summary;
}

/**
 * Single ESPN round-trip for one DB match: resolves the eventId, pulls the
 * summary, and patches the row with every field that changed. Lineups are
 * upserted into the lineups table, the rest live on the matches row.
 */
async function tickOneMatch(
  db: ReturnType<typeof createServiceClient>,
  m: Match,
  home: Team,
  away: Team,
  summary: {
    scoresUpdated: number;
    lineupsCrawled: number;
    eventsUpdated: number;
    commentaryUpdated: number;
    statsUpdated: number;
    oddsUpdated: number;
    errors: string[];
  },
  newlyFinished: string[]
) {
  const ev = await espnFindEvent(home.name, away.name, home.code, away.code, m.kickoff_utc!);
  if (!ev) return;
  const data = await espnFetchSummary(ev.eventId, ev.homeAbbr, ev.awayAbbr);
  if (!data) return;
  const flipped =
    ev.homeAbbr.toLowerCase() !== home.code.toLowerCase() &&
    ev.awayAbbr.toLowerCase() === home.code.toLowerCase();
  const ourHomeSide = flipped ? data.away : data.home;
  const ourAwaySide = flipped ? data.home : data.away;
  const ourHomeScore = flipped ? ev.awayScore : ev.homeScore;
  const ourAwayScore = flipped ? ev.homeScore : ev.awayScore;

  const update: Database['public']['Tables']['matches']['Update'] = {};

  // -- score / status / minute --
  // Never resurrect a finished match from a stale crawl.
  const protectFinished = m.status === 'finished' && ev.status !== 'finished';
  if (!protectFinished) {
    if (m.status !== ev.status) update.status = ev.status;
    if (m.minute !== (ev.status === 'live' ? ev.minute : null))
      update.minute = ev.status === 'live' ? ev.minute : null;
    const nextStoppage = ev.status === 'live' ? ev.minuteStoppage : null;
    if (m.minute_stoppage !== nextStoppage) update.minute_stoppage = nextStoppage;
    if (m.home_score !== ourHomeScore) update.home_score = ourHomeScore;
    if (m.away_score !== ourAwayScore) update.away_score = ourAwayScore;
  }

  // -- events --
  if (data.events.length > 0) {
    const events = data.events.map((e) => ({
      minute: e.minute,
      type: e.type,
      team: flipped ? (e.team === 'home' ? 'away' : 'home') : e.team,
      player: e.player,
      playerOff: e.playerOff,
    }));
    update.events = events;
  }

  // -- commentary / stats / odds / gamecast --
  if (data.commentary.length > 0) update.commentary = data.commentary;
  if (data.teamStats.home || data.teamStats.away) {
    update.team_stats = flipped ? { home: data.teamStats.away, away: data.teamStats.home } : data.teamStats;
  }
  if ((data.playerStats.home?.length ?? 0) + (data.playerStats.away?.length ?? 0) > 0) {
    update.player_stats = flipped
      ? { home: data.playerStats.away, away: data.playerStats.home }
      : data.playerStats;
  }
  if (data.odds.provider || data.odds.homeOdds != null) update.odds = data.odds;
  const hasGamecast =
    (data.gamecast.headToHead?.length ?? 0) > 0 ||
    (data.gamecast.lastFiveHome?.length ?? 0) > 0 ||
    (data.gamecast.lastFiveAway?.length ?? 0) > 0 ||
    (data.gamecast.officials?.length ?? 0) > 0;
  if (hasGamecast) update.gamecast = data.gamecast;

  if (Object.keys(update).length > 0) {
    const { error } = await db.from('matches').update(update).eq('id', m.id);
    if (error) {
      summary.errors.push(`m${m.match_number ?? '?'} update [${Object.keys(update).join(',')}]: ${error.message}`);
    } else {
      revalidateTag(`match:${m.id}`);
      if ('home_score' in update || 'status' in update) summary.scoresUpdated++;
      if ('events' in update) summary.eventsUpdated++;
      if ('commentary' in update) summary.commentaryUpdated++;
      if ('team_stats' in update || 'player_stats' in update) summary.statsUpdated++;
      if ('odds' in update) summary.oddsUpdated++;
      if (update.status === 'finished' && m.status !== 'finished') {
        newlyFinished.push(m.id);
        // Keep in-memory copy consistent so bracket resolution sees the new state.
        Object.assign(m, update);
      }
    }
  }

  // -- lineups (only if not already stored for this match) --
  if (ourHomeSide && ourAwaySide && ourHomeSide.starters.length === 11 && ourAwaySide.starters.length === 11) {
    const { count } = await db
      .from('lineups')
      .select('id', { count: 'exact', head: true })
      .eq('match_id', m.id);
    if ((count ?? 0) === 0) {
      const { data: squad } = await db
        .from('players')
        .select('*')
        .in('team_id', [home.id, away.id]);
      const rows: Database['public']['Tables']['lineups']['Insert'][] = [];
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
      if (error) {
        summary.errors.push(`m${m.match_number ?? '?'} lineups upsert: ${error.message}`);
      } else {
        revalidateTag(`lineups:${m.id}`);
        summary.lineupsCrawled++;
      }
    }
  }
}
