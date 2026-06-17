import 'server-only';
import type {
  CommentaryEntry,
  GamecastBundle,
  MatchEvent,
  OddsBundle,
  PlayerStatsBundle,
  PlayerStatsRow,
  TeamStatsBundle,
} from '@/lib/supabase/types';

/**
 * ESPN site.api adapter — public JSON endpoints used by espn.com itself.
 * No auth, no anti-bot, structured data. Replaces the Google-scrape path
 * for live scores, lineups, and match events.
 *
 *   /scoreboard?dates=YYYYMMDD  → all events for that date
 *   /summary?event={id}         → full detail: rosters (lineups) + keyEvents
 *
 * Returned objects mirror our DB shapes (LineupSide, MatchEvent) so callers
 * can write directly without going through the LLM extraction pipeline.
 */

const BASE = 'https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36';

async function espnGet(path: string): Promise<unknown> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'User-Agent': UA, Accept: 'application/json' },
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`ESPN ${path} -> HTTP ${res.status}`);
  return res.json();
}

export interface EspnEventSummary {
  eventId: string;
  date: string; // ISO
  homeName: string;
  homeAbbr: string;
  awayName: string;
  awayAbbr: string;
  homeScore: number | null;
  awayScore: number | null;
  status: 'scheduled' | 'live' | 'finished';
  minute: number | null;
  minuteStoppage: number | null;
}

interface RawEvent {
  id: string;
  date: string;
  competitions: Array<{
    competitors: Array<{
      homeAway: 'home' | 'away';
      score: string;
      team: { displayName: string; abbreviation: string };
    }>;
    status: {
      clock?: number;
      displayClock?: string;
      period?: number;
      type: { state: 'pre' | 'in' | 'post'; completed: boolean };
    };
  }>;
}

function mapStatus(state: 'pre' | 'in' | 'post', completed: boolean): EspnEventSummary['status'] {
  if (completed || state === 'post') return 'finished';
  if (state === 'in') return 'live';
  return 'scheduled';
}

function toIsoDate(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

/**
 * Fetch one day's worth of WC events. ESPN groups matches by calendar date
 * (UTC), so daily resolution is enough.
 */
export async function espnFetchScoreboardForDate(date: Date): Promise<EspnEventSummary[]> {
  const data = (await espnGet(`/scoreboard?dates=${toIsoDate(date)}`)) as { events?: RawEvent[] };
  return (data.events ?? []).map((ev) => {
    const comp = ev.competitions[0];
    const home = comp.competitors.find((c) => c.homeAway === 'home')!;
    const away = comp.competitors.find((c) => c.homeAway === 'away')!;
    const homeScore = home.score === '' ? null : Number(home.score);
    const awayScore = away.score === '' ? null : Number(away.score);
    const status = mapStatus(comp.status.type.state, comp.status.type.completed);
    // displayClock examples: "9'", "45'", "45'+2'", "90'+8'". We capture the
    // base and stoppage separately so the UI can render "45+2'" instead of
    // collapsing it into the nonsensical integer 452.
    const { base, stoppage } = (() => {
      if (status !== 'live') return { base: null as number | null, stoppage: null as number | null };
      const raw = comp.status.displayClock ?? '';
      const m = raw.match(/(\d+)(?:'?\+(\d+))?/);
      if (!m) return { base: null, stoppage: null };
      const b = Number(m[1]);
      const s = m[2] ? Number(m[2]) : 0;
      if (!Number.isFinite(b)) return { base: null, stoppage: null };
      return { base: b, stoppage: s > 0 ? s : null };
    })();
    return {
      eventId: ev.id,
      date: ev.date,
      homeName: home.team.displayName,
      homeAbbr: home.team.abbreviation,
      awayName: away.team.displayName,
      awayAbbr: away.team.abbreviation,
      homeScore: Number.isFinite(homeScore as number) ? homeScore : null,
      awayScore: Number.isFinite(awayScore as number) ? awayScore : null,
      status,
      minute: base,
      minuteStoppage: stoppage,
    };
  });
}

/**
 * Find ESPN's event for a given match. Uses kickoff_utc's date to scope the
 * scoreboard query, then matches by team name/abbreviation (both directions).
 */
export async function espnFindEvent(
  homeName: string,
  awayName: string,
  homeCode: string,
  awayCode: string,
  kickoffUtc: string
): Promise<EspnEventSummary | null> {
  const kickoff = new Date(kickoffUtc);
  // Try the kickoff date and ±1 day to account for timezone edges.
  const dates = [kickoff, new Date(kickoff.getTime() - 86400_000), new Date(kickoff.getTime() + 86400_000)];
  // ISO3 abbreviations are stable across providers ("BIH" everywhere); names
  // are not (ESPN says "Bosnia-Herzegovina", FIFA says "Bosnia and Herzegovina").
  // Match exclusively on abbreviation pairs, in either home/away orientation.
  const ourH = homeCode.toLowerCase();
  const ourA = awayCode.toLowerCase();
  // Suppress unused warnings — names kept in signature for future fuzzy fallback.
  void homeName;
  void awayName;
  for (const d of dates) {
    const events = await espnFetchScoreboardForDate(d);
    const found = events.find((e) => {
      const ha = e.homeAbbr.toLowerCase();
      const aa = e.awayAbbr.toLowerCase();
      return (ha === ourH && aa === ourA) || (ha === ourA && aa === ourH);
    });
    if (found) return found;
  }
  return null;
}

export interface EspnLineupPlayer {
  name: string;
  shirt_number: number | null;
  position: string | null;
  is_captain?: boolean;
  subbedIn: boolean;
  subbedOut: boolean;
}

export interface EspnLineupSide {
  formation: string | null;
  starters: EspnLineupPlayer[];
  subs: EspnLineupPlayer[];
}

interface RawRosterPlayer {
  active: boolean;
  starter: boolean;
  jersey?: string;
  athlete: { fullName: string; displayName: string };
  position?: { abbreviation: string };
  subbedIn?: boolean;
  subbedOut?: boolean;
}

interface RawRoster {
  homeAway: 'home' | 'away';
  team?: { id?: string; abbreviation?: string; displayName?: string };
  formation?: string;
  roster: RawRosterPlayer[];
}

const POSITION_MAP: Record<string, string> = {
  G: 'GK',
  GK: 'GK',
  D: 'DF',
  DF: 'DF',
  CB: 'DF',
  RB: 'DF',
  LB: 'DF',
  M: 'MF',
  MF: 'MF',
  CM: 'MF',
  DM: 'MF',
  AM: 'MF',
  F: 'FW',
  FW: 'FW',
  ST: 'FW',
  RW: 'FW',
  LW: 'FW',
};

function mapPosition(abbr: string | undefined): string | null {
  if (!abbr) return null;
  return POSITION_MAP[abbr.toUpperCase()] ?? null;
}

function parseRoster(raw: RawRoster): EspnLineupSide {
  const starters: EspnLineupPlayer[] = [];
  const subs: EspnLineupPlayer[] = [];
  for (const p of raw.roster ?? []) {
    if (!p.athlete?.fullName) continue;
    const entry: EspnLineupPlayer = {
      name: p.athlete.fullName,
      shirt_number: p.jersey ? Number(p.jersey) : null,
      position: mapPosition(p.position?.abbreviation),
      subbedIn: !!p.subbedIn,
      subbedOut: !!p.subbedOut,
    };
    (p.starter ? starters : subs).push(entry);
  }
  return { formation: raw.formation ?? null, starters, subs };
}

interface RawKeyEvent {
  id: string;
  type: { type: string };
  period: { number: number };
  clock: { displayValue: string };
  text?: string;
  team?: { id?: string; abbreviation?: string; displayName?: string };
  participants?: Array<{ athlete?: { id?: string; displayName?: string } }>;
}

const EVENT_TYPE_MAP: Record<string, MatchEvent['type']> = {
  goal: 'goal',
  'goal---header': 'goal',
  'goal---penalty': 'penalty',
  'penalty-scored': 'penalty',
  'penalty-miss': 'penalty',
  'goal---own-goal': 'own_goal',
  'own-goal': 'own_goal',
  'yellow-card': 'yellow',
  'red-card': 'red',
  'second-yellow-card': 'second_yellow',
  substitution: 'sub',
};

// Non-game events to skip entirely (metadata/delays/halftime/etc.)
const SKIP_EVENT_TYPES = new Set([
  'kickoff',
  'start-delay',
  'end-delay',
  'start-2nd-half',
  'halftime',
  'fulltime',
  'pause',
  'resume',
  'suspended',
  'postponed',
  'cancelled',
  'delayed',
  'rain_delay',
  'warmup',
  'end-regular-time',
  'start-extra-time',
  'overtime',
  'shootout',
  'end-sudden-death',
  'end',
]);

function isSkippableMeta(type: string): boolean {
  return SKIP_EVENT_TYPES.has(type);
}

function parseMinute(displayValue: string, period: number): number | null {
  // Examples: "9'", "45'+2'", "65'", "90'+8'"
  const m = displayValue.match(/(\d+)(?:'\+(\d+))?/);
  if (!m) return null;
  const base = Number(m[1]);
  const extra = m[2] ? Number(m[2]) : 0;
  if (!Number.isFinite(base)) return null;
  // ESPN's base already accounts for first vs second half (e.g. 65' in P2 is 65).
  // First-half stoppage minutes (e.g. 45'+2') we collapse onto 45 so the
  // timeline UI doesn't mis-order them.
  return period === 1 && base === 45 ? 45 + extra : base;
}

interface RawCommentary {
  sequence?: number;
  time?: { displayValue?: string; value?: number };
  text?: string;
  type?: { id?: string; text?: string };
  play?: { type?: { text?: string } };
}

interface RawBoxscoreTeamStat {
  name: string;
  displayValue: string | number;
  label?: string;
}

interface RawBoxscorePlayerCategory {
  name?: string;
  athletes?: Array<{
    starter?: boolean;
    athlete: { id: string; fullName: string; displayName?: string; position?: { abbreviation?: string }; jersey?: string };
    stats?: Array<{ name: string; displayValue: string | number; label?: string }>;
  }>;
}

interface RawPickcenter {
  provider?: { name?: string };
  details?: string;
  overUnder?: number;
  drawOdds?: { moneyLine?: number };
  homeTeamOdds?: { moneyLine?: number };
  awayTeamOdds?: { moneyLine?: number };
}

interface RawLeader {
  team?: { abbreviation?: string };
  leaders?: Array<{
    displayName?: string;
    leaders?: Array<{ athlete?: { displayName?: string; fullName?: string }; displayValue?: string }>;
  }>;
}

interface RawH2HEvent {
  gameDate?: string;
  date?: string;
  score?: string;
  gameResult?: 'W' | 'D' | 'L';
  homeTeamScore?: string;
  awayTeamScore?: string;
  opponent?: { displayName?: string; abbreviation?: string };
  // Older shape (kept for forward compatibility with completed-match summaries)
  competitors?: Array<{ homeAway: 'home' | 'away'; team: { displayName?: string }; score?: string }>;
}

interface RawH2HGroup {
  team?: { displayName?: string; abbreviation?: string };
  events?: RawH2HEvent[];
}

function parseCommentary(raw: RawCommentary[] | undefined): CommentaryEntry[] {
  if (!raw) return [];
  return raw
    .filter((c) => c.text && c.text.trim().length > 0)
    .map((c) => {
      const disp = c.time?.displayValue ?? '';
      const m = disp.match(/(\d+)/);
      return {
        minute: m ? Number(m[1]) : null,
        text: c.text!.trim(),
        type: c.type?.text ?? c.play?.type?.text,
      };
    })
    .sort((a, b) => (a.minute ?? 0) - (b.minute ?? 0));
}

function parseTeamStats(raw: Array<{ homeAway?: 'home' | 'away'; statistics?: RawBoxscoreTeamStat[] }> | undefined): TeamStatsBundle {
  const out: TeamStatsBundle = {};
  for (const side of raw ?? []) {
    if (!side.statistics || side.statistics.length === 0) continue; // skip empty pre-match shells
    const dict: Record<string, string | number> = {};
    for (const s of side.statistics) {
      const label = s.label ?? s.name;
      dict[label] = s.displayValue;
    }
    if (Object.keys(dict).length === 0) continue;
    if (side.homeAway === 'home') out.home = dict;
    else if (side.homeAway === 'away') out.away = dict;
  }
  return out;
}

function parsePlayerStats(
  raw: Array<{ homeAway?: 'home' | 'away'; statistics?: RawBoxscorePlayerCategory[] }> | undefined
): PlayerStatsBundle {
  // ESPN groups player stats by category (offensive, defensive...). We flatten
  // to one row per athlete keyed by athlete_id, merging stats across categories.
  const collect = (cats: RawBoxscorePlayerCategory[] | undefined): PlayerStatsRow[] => {
    const byId = new Map<string, PlayerStatsRow>();
    for (const cat of cats ?? []) {
      for (const a of cat.athletes ?? []) {
        const id = a.athlete?.id;
        if (!id) continue;
        const existing = byId.get(id);
        const merged: PlayerStatsRow = existing ?? {
          athlete_id: id,
          name: a.athlete.fullName ?? a.athlete.displayName ?? '',
          position: a.athlete.position?.abbreviation ?? null,
          jersey: a.athlete.jersey ?? null,
          starter: !!a.starter,
          stats: {},
        };
        for (const s of a.stats ?? []) {
          merged.stats[s.label ?? s.name] = s.displayValue;
        }
        byId.set(id, merged);
      }
    }
    return [...byId.values()];
  };
  const out: PlayerStatsBundle = {};
  for (const side of raw ?? []) {
    const rows = collect(side.statistics);
    if (side.homeAway === 'home') out.home = rows;
    else if (side.homeAway === 'away') out.away = rows;
  }
  return out;
}

function parseOdds(raw: RawPickcenter[] | undefined): OddsBundle {
  const top = raw?.[0];
  if (!top) return {};
  return {
    provider: top.provider?.name,
    homeOdds: top.homeTeamOdds?.moneyLine ?? null,
    awayOdds: top.awayTeamOdds?.moneyLine ?? null,
    drawOdds: top.drawOdds?.moneyLine ?? null,
    spread: top.details ?? null,
    total: top.overUnder ?? null,
  };
}

function parseGamecast(
  data: {
    leaders?: RawLeader[];
    lastFiveGames?: RawH2HGroup[];
    headToHeadGames?: RawH2HGroup[];
    gameInfo?: { attendance?: number | null; officials?: Array<{ fullName?: string; displayName?: string; position?: { name?: string } }>; weather?: { displayValue?: string; temperature?: number } | null };
  },
  homeAbbr: string,
  awayAbbr: string
): GamecastBundle {
  const out: GamecastBundle = {};

  const ldHome = data.leaders?.find((l) => l.team?.abbreviation?.toUpperCase() === homeAbbr.toUpperCase());
  const ldAway = data.leaders?.find((l) => l.team?.abbreviation?.toUpperCase() === awayAbbr.toUpperCase());
  const flatLeaders = (group: RawLeader | undefined) =>
    (group?.leaders ?? []).flatMap((cat) =>
      (cat.leaders ?? [])
        .filter((l) => l.athlete?.displayName || l.athlete?.fullName)
        .map((l) => ({
          name: l.athlete?.displayName ?? l.athlete?.fullName ?? '',
          category: cat.displayName ?? '',
          value: l.displayValue ?? '',
        }))
    );
  if (ldHome || ldAway) {
    out.leaders = { home: flatLeaders(ldHome), away: flatLeaders(ldAway) };
  }

  // ESPN's lastFiveGames + headToHeadGames events use top-level `opponent`,
  // `gameDate`, `score`, `gameResult` — NOT nested competitors[]. Fall back
  // to the older competitors shape if present (some endpoints return both).
  const mapEvent = (e: RawH2HEvent, ownerName?: string) => {
    const date = e.gameDate ?? e.date ?? '';
    const opponentName = e.opponent?.displayName;
    if (e.competitors && e.competitors.length === 2) {
      const home = e.competitors.find((c) => c.homeAway === 'home');
      const away = e.competitors.find((c) => c.homeAway === 'away');
      const hs = Number(home?.score ?? e.homeTeamScore ?? '0');
      const as = Number(away?.score ?? e.awayTeamScore ?? '0');
      return {
        date,
        home: home?.team.displayName ?? '',
        away: away?.team.displayName ?? '',
        opponent: ownerName && home?.team.displayName === ownerName ? away?.team.displayName ?? '' : home?.team.displayName ?? '',
        homeScore: hs,
        awayScore: as,
      };
    }
    // Newer top-level shape
    const hs = Number(e.homeTeamScore ?? '0');
    const as = Number(e.awayTeamScore ?? '0');
    return {
      date,
      home: ownerName ?? '',
      away: opponentName ?? '',
      opponent: opponentName ?? '',
      homeScore: hs,
      awayScore: as,
      result: e.gameResult,
    };
  };
  const h2hGroup = data.headToHeadGames?.[0];
  if (h2hGroup?.events?.length) {
    const ownerName = h2hGroup.team?.displayName;
    const mapped = h2hGroup.events
      .map((e) => mapEvent(e, ownerName))
      .filter((m) => m.opponent && m.date)
      .map((m) => ({ date: m.date, home: m.home, away: m.away, score: `${m.homeScore}-${m.awayScore}` }));
    if (mapped.length > 0) out.headToHead = mapped;
  }

  const mapRecent = (g: RawH2HGroup | undefined): GamecastBundle['lastFiveHome'] => {
    if (!g?.events?.length) return [];
    const ownerName = g.team?.displayName;
    return g.events
      .map((e) => mapEvent(e, ownerName))
      .filter((m) => m.opponent && m.date)
      .map((m) => ({
        date: m.date,
        opponent: m.opponent,
        result: (m.result as 'W' | 'D' | 'L') ?? (m.homeScore > m.awayScore ? 'W' : m.homeScore === m.awayScore ? 'D' : 'L'),
        score: `${m.homeScore}-${m.awayScore}`,
      }));
  };
  const homeRecent = mapRecent(data.lastFiveGames?.[0]);
  const awayRecent = mapRecent(data.lastFiveGames?.[1]);
  if (homeRecent && homeRecent.length > 0) out.lastFiveHome = homeRecent;
  if (awayRecent && awayRecent.length > 0) out.lastFiveAway = awayRecent;

  out.attendance = data.gameInfo?.attendance ?? null;
  out.officials = (data.gameInfo?.officials ?? []).map((o) => ({
    name: o.fullName ?? o.displayName ?? '',
    role: o.position?.name,
  }));
  if (data.gameInfo?.weather) {
    out.weather = {
      description: data.gameInfo.weather.displayValue,
      temperature: data.gameInfo.weather.temperature ?? null,
    };
  }
  return out;
}

export interface EspnTeam {
  espnId: string;
  abbreviation: string;
  displayName: string;
}

export interface EspnRosterPlayer {
  name: string;
  shirt_number: number | null;
  position: string | null;
}

interface RawLeagueTeam {
  team: { id: string; abbreviation: string; displayName: string };
}

interface RawRosterAthlete {
  id: string;
  displayName?: string;
  fullName?: string;
  position?: { abbreviation?: string };
  jersey?: string;
}

/** Fetch every WC team ESPN tracks, with their internal team ids. */
export async function espnFetchTeams(): Promise<EspnTeam[]> {
  const data = (await espnGet('/teams')) as {
    sports?: Array<{ leagues?: Array<{ teams?: RawLeagueTeam[] }> }>;
  };
  const teams = data.sports?.[0]?.leagues?.[0]?.teams ?? [];
  return teams.map((t) => ({
    espnId: t.team.id,
    abbreviation: t.team.abbreviation,
    displayName: t.team.displayName,
  }));
}

/** Fetch a team's roster — typically 26 players for the World Cup. */
export async function espnFetchRoster(espnTeamId: string): Promise<EspnRosterPlayer[]> {
  const data = (await espnGet(`/teams/${espnTeamId}/roster`)) as {
    athletes?: RawRosterAthlete[];
  };
  return (data.athletes ?? [])
    .map((a) => ({
      name: a.fullName ?? a.displayName ?? '',
      shirt_number: a.jersey ? Number(a.jersey) : null,
      position: mapPosition(a.position?.abbreviation),
    }))
    .filter((p) => p.name);
}

/**
 * Returns the full ESPN summary for one event, normalized into our DB shapes.
 * Lineups, events, commentary, team stats, player stats, odds, and gamecast
 * (h2h, leaders, recent form, officials) are all parsed here so callers can
 * write rows directly without going through any LLM extraction.
 */
export async function espnFetchSummary(eventId: string, homeAbbr?: string, awayAbbr?: string): Promise<{
  home: EspnLineupSide | null;
  away: EspnLineupSide | null;
  events: Array<MatchEvent & { teamAbbr?: string; playerOff?: string }>;
  commentary: CommentaryEntry[];
  playerStats: PlayerStatsBundle;
  teamStats: TeamStatsBundle;
  odds: OddsBundle;
  gamecast: GamecastBundle;
} | null> {
  const data = (await espnGet(`/summary?event=${eventId}`)) as {
    rosters?: RawRoster[];
    keyEvents?: RawKeyEvent[];
    commentary?: RawCommentary[];
    boxscore?: {
      teams?: Array<{ homeAway?: 'home' | 'away'; statistics?: RawBoxscoreTeamStat[] }>;
      players?: Array<{ homeAway?: 'home' | 'away'; statistics?: RawBoxscorePlayerCategory[] }>;
    };
    pickcenter?: RawPickcenter[];
    leaders?: RawLeader[];
    lastFiveGames?: RawH2HGroup[];
    headToHeadGames?: RawH2HGroup[];
    gameInfo?: { attendance?: number | null; officials?: Array<{ fullName?: string; displayName?: string; position?: { name?: string } }>; weather?: { displayValue?: string; temperature?: number } | null };
  };

  const rosters = data.rosters ?? [];
  const homeRaw = rosters.find((r) => r.homeAway === 'home');
  const awayRaw = rosters.find((r) => r.homeAway === 'away');
  const home = homeRaw ? parseRoster(homeRaw) : null;
  const away = awayRaw ? parseRoster(awayRaw) : null;

  // Get ESPN team IDs from rosters to match keyEvents by team ID.
  const homeTeamId = homeRaw?.team?.id;
  const awayTeamId = awayRaw?.team?.id;

  const events: Array<MatchEvent & { teamAbbr?: string }> = [];
  for (const ke of data.keyEvents ?? []) {
    const mapped = EVENT_TYPE_MAP[ke.type?.type ?? ''];
    if (!mapped) continue;
    const minute = parseMinute(ke.clock?.displayValue ?? '', ke.period?.number ?? 1);
    if (minute == null) continue;
    const teamAbbr = ke.team?.abbreviation;
    const playerName = ke.text?.match(/^(?:Goal! [^.]+\.\s*)?([\p{L} '\-.]+?)\s+\(/u)?.[1]?.trim();

    // Match event team using ESPN's team.id (always present) against the
    // roster team IDs extracted above. This is the most reliable signal.
    const teamId = ke.team?.id;
    let side: 'home' | 'away' = 'away';
    if (teamId && teamId === homeTeamId) {
      side = 'home';
    } else if (teamId && teamId === awayTeamId) {
      side = 'away';
    } else {
      // Fallback to abbreviation match for edge cases
      const teamAbbrUpper = teamAbbr?.toUpperCase() ?? '';
      const homeUpper = homeAbbr?.toUpperCase() ?? '';
      const awayUpper = awayAbbr?.toUpperCase() ?? '';
      if (teamAbbrUpper && homeUpper && teamAbbrUpper === homeUpper) {
        side = 'home';
      } else if (teamAbbrUpper && awayUpper && teamAbbrUpper === awayUpper) {
        side = 'away';
      }
    }

    // For substitutions: ESPN participants[0] = coming ON, participants[1] = going OFF
    const playerOff =
      mapped === 'sub'
        ? ke.participants?.[1]?.athlete?.displayName?.trim()
        : undefined;

    events.push({ minute, type: mapped, team: side, player: playerName, teamAbbr, ...(playerOff ? { playerOff } : {}) });
  }
  events.sort((a, b) => a.minute - b.minute);

  const commentary = parseCommentary(data.commentary);
  const teamStats = parseTeamStats(data.boxscore?.teams);
  const playerStats = parsePlayerStats(data.boxscore?.players);
  const odds = parseOdds(data.pickcenter);
  const gamecast = parseGamecast(
    {
      leaders: data.leaders,
      lastFiveGames: data.lastFiveGames,
      headToHeadGames: data.headToHeadGames,
      gameInfo: data.gameInfo,
    },
    homeAbbr ?? '',
    awayAbbr ?? ''
  );

  return { home, away, events, commentary, playerStats, teamStats, odds, gamecast };
}
