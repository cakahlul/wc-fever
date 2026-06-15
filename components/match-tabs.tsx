'use client';

import { useMemo, useState } from 'react';
import { FormationPitch } from '@/components/formation-pitch';
import type {
  CommentaryEntry,
  GamecastBundle,
  LineupEntry,
  Match,
  MatchEvent,
  OddsBundle,
  Player,
  PlayerStatsBundle,
  Team,
  TeamStatsBundle,
} from '@/lib/supabase/types';

/**
 * Tabbed detail panel for the match page. Server passes pre-fetched data;
 * this component only owns tab state. Tabs render only when their data is
 * present so an upcoming match shows Gamecast + Lineups + Odds and a finished
 * match shows Timeline + Stats + Commentary + Lineups + Odds.
 */

export interface MatchTabsProps {
  match: Match & {
    home_team: Team | null;
    away_team: Team | null;
  };
  lineups: LineupEntry[];
  homeSquad: Player[];
  awaySquad: Player[];
  reviewBody: string | null;
}

const EVENT_ICONS: Record<MatchEvent['type'], string> = {
  goal: '⚽',
  penalty: '🎯',
  own_goal: '🥅',
  yellow: '🟨',
  red: '🟥',
  second_yellow: '🟥',
  sub: '🔁',
};

export function MatchTabs({ match, lineups, homeSquad, awaySquad, reviewBody }: MatchTabsProps) {
  const finished = match.status === 'finished';
  const live = match.status === 'live';

  const homeLineup = lineups.filter((l) => l.team_id === match.home_team_id);
  const awayLineup = lineups.filter((l) => l.team_id === match.away_team_id);

  const has = useMemo(() => {
    return {
      timeline: (match.events ?? []).length > 0,
      lineups: homeLineup.length > 0 || awayLineup.length > 0 || homeSquad.length > 0 || awaySquad.length > 0,
      stats:
        Boolean(match.team_stats?.home || match.team_stats?.away) ||
        (match.player_stats?.home?.length ?? 0) > 0 ||
        (match.player_stats?.away?.length ?? 0) > 0,
      commentary: (match.commentary ?? []).length > 0,
      odds: Boolean(match.odds?.provider || match.odds?.homeOdds != null),
      gamecast: !finished && match.gamecast ? hasGamecastContent(match.gamecast) : false,
      overview: Boolean(reviewBody),
    };
  }, [match, homeLineup, awayLineup, homeSquad, awaySquad, reviewBody, finished]);

  type TabKey = 'overview' | 'timeline' | 'gamecast' | 'lineups' | 'stats' | 'commentary' | 'odds';
  const tabs: Array<{ key: TabKey; label: string; icon: string; show: boolean }> = [
    { key: 'overview', label: finished ? 'Review' : 'The Hype', icon: '📝', show: has.overview },
    { key: 'gamecast', label: 'Gamecast', icon: '🔭', show: has.gamecast },
    { key: 'timeline', label: 'Timeline', icon: '⚽', show: has.timeline },
    { key: 'lineups', label: 'Lineups', icon: '👥', show: has.lineups },
    { key: 'stats', label: 'Stats', icon: '📊', show: has.stats },
    { key: 'commentary', label: 'Commentary', icon: '💬', show: has.commentary },
    { key: 'odds', label: 'Odds', icon: '🎲', show: has.odds },
  ];
  const visibleTabs = tabs.filter((t) => t.show);

  const [active, setActive] = useState<TabKey>(visibleTabs[0]?.key ?? 'overview');
  const currentTab = visibleTabs.find((t) => t.key === active) ?? visibleTabs[0];

  if (visibleTabs.length === 0) {
    return (
      <p className="rounded-xl border border-night-50/60 bg-night-200 p-4 text-sm text-mist">
        No additional data yet. Run the bootstrap or wait for the next tick to populate.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {/* Tab bar — horizontal scroll on mobile, no wrap */}
      <div role="tablist" aria-label="Match sections" className="-mx-2 flex gap-1 overflow-x-auto px-2 pb-1">
        {visibleTabs.map((t) => {
          const isActive = t.key === currentTab?.key;
          return (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={isActive}
              aria-controls={`panel-${t.key}`}
              id={`tab-${t.key}`}
              onClick={() => setActive(t.key)}
              className={`flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-sm transition-colors ${
                isActive
                  ? 'bg-gold text-night shadow-glow font-bold'
                  : 'bg-night-200 text-mist hover:bg-night-100 hover:text-ice'
              }`}
            >
              <span aria-hidden>{t.icon}</span>
              <span>{t.label}</span>
            </button>
          );
        })}
      </div>

      {/* Active panel */}
      <div role="tabpanel" id={`panel-${currentTab.key}`} aria-labelledby={`tab-${currentTab.key}`}>
        {currentTab.key === 'overview' && reviewBody && (
          <div className="rounded-2xl border border-gold/30 bg-night-200 p-5">
            <p className="leading-relaxed text-ice/90">{reviewBody}</p>
          </div>
        )}

        {currentTab.key === 'gamecast' && match.gamecast && (
          <Gamecast gamecast={match.gamecast} homeTeam={match.home_team} awayTeam={match.away_team} />
        )}

        {currentTab.key === 'timeline' && (
          <EventTimeline
            events={match.events}
            homeCode={match.home_team?.code ?? 'HOME'}
            awayCode={match.away_team?.code ?? 'AWAY'}
            homeFlag={match.home_team?.flag_emoji ?? null}
            awayFlag={match.away_team?.flag_emoji ?? null}
          />
        )}

        {currentTab.key === 'lineups' && (
          <LineupsPanel
            match={match}
            homeLineup={homeLineup}
            awayLineup={awayLineup}
            homeSquad={homeSquad}
            awaySquad={awaySquad}
            finished={finished}
          />
        )}

        {currentTab.key === 'stats' && (
          <div className="space-y-6">
            {(match.team_stats?.home || match.team_stats?.away) && (
              <TeamStats
                stats={match.team_stats}
                homeCode={match.home_team?.code ?? 'HOME'}
                awayCode={match.away_team?.code ?? 'AWAY'}
              />
            )}
            {((match.player_stats?.home?.length ?? 0) > 0 || (match.player_stats?.away?.length ?? 0) > 0) && (
              <PlayerStats stats={match.player_stats} homeTeam={match.home_team} awayTeam={match.away_team} />
            )}
          </div>
        )}

        {currentTab.key === 'commentary' && <Commentary entries={match.commentary} live={live} />}

        {currentTab.key === 'odds' && (
          <OddsBlock
            odds={match.odds}
            homeCode={match.home_team?.code ?? 'HOME'}
            awayCode={match.away_team?.code ?? 'AWAY'}
          />
        )}
      </div>
    </div>
  );
}

// ----------------------------- sub-components -----------------------------

function EventTimeline({
  events,
  homeCode,
  awayCode,
  homeFlag,
  awayFlag,
}: {
  events: MatchEvent[];
  homeCode: string;
  awayCode: string;
  homeFlag: string | null;
  awayFlag: string | null;
}) {
  return (
    <div className="rounded-2xl border border-night-50/60 bg-night-200 p-4">
      <div className="relative">
        <div
          aria-hidden
          className="absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-gradient-to-b from-gold/60 via-pitch-line/40 to-gold/60"
        />
        <ul className="space-y-3">
          {events.map((e, i) => {
            const isHome = e.team === 'home';
            const isGoal = e.type === 'goal' || e.type === 'penalty' || e.type === 'own_goal';
            const flagSide = isHome ? homeFlag : awayFlag;
            const codeSide = isHome ? homeCode : awayCode;
            return (
              <li key={i} className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
                <div className={`flex items-center gap-2 ${isHome ? 'justify-end text-right' : 'invisible'}`}>
                  <div>
                    <p className={`text-sm font-bold ${isGoal ? 'text-gold-bright' : 'text-ice'}`}>
                      {e.player ?? e.type}
                    </p>
                    <p className="text-[10px] uppercase tracking-wider text-mist">
                      <span aria-hidden>{flagSide}</span> {codeSide}
                    </p>
                  </div>
                </div>
                <div className="flex flex-col items-center gap-0.5">
                  <span
                    className={`flex h-9 w-9 items-center justify-center rounded-full text-sm shadow-glow ${
                      isGoal ? 'bg-gold text-night' : 'bg-night-100 ring-1 ring-night-50'
                    }`}
                  >
                    <span aria-hidden>{EVENT_ICONS[e.type]}</span>
                  </span>
                  <span className="font-display text-xs font-bold tabular-nums text-gold-bright">
                    {e.minute}&#8242;
                  </span>
                </div>
                <div className={`flex items-center gap-2 ${!isHome ? 'justify-start text-left' : 'invisible'}`}>
                  <div>
                    <p className={`text-sm font-bold ${isGoal ? 'text-gold-bright' : 'text-ice'}`}>
                      {e.player ?? e.type}
                    </p>
                    <p className="text-[10px] uppercase tracking-wider text-mist">
                      <span aria-hidden>{flagSide}</span> {codeSide}
                    </p>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

function statValueNumber(v: string | number | undefined): number {
  if (v == null) return 0;
  if (typeof v === 'number') return v;
  const n = parseFloat(v.replace?.('%', '') ?? '');
  return Number.isFinite(n) ? n : 0;
}

function TeamStats({
  stats,
  homeCode,
  awayCode,
}: {
  stats: TeamStatsBundle;
  homeCode: string;
  awayCode: string;
}) {
  const labels = Array.from(new Set([...Object.keys(stats.home ?? {}), ...Object.keys(stats.away ?? {})]));
  if (labels.length === 0) return null;
  return (
    <div className="rounded-2xl border border-night-50/60 bg-night-200 p-4">
      <h3 className="mb-3 font-display text-sm font-bold uppercase tracking-wider text-mist">Team stats</h3>
      <div className="mb-3 flex items-center justify-between text-xs uppercase tracking-wider text-mist">
        <span>{homeCode}</span>
        <span>{awayCode}</span>
      </div>
      <ul className="space-y-3">
        {labels.map((label) => {
          const h = stats.home?.[label];
          const a = stats.away?.[label];
          const hn = statValueNumber(h);
          const an = statValueNumber(a);
          const total = hn + an;
          const hPct = total > 0 ? (hn / total) * 100 : 50;
          const aPct = 100 - hPct;
          return (
            <li key={label}>
              <p className="mb-1 text-center text-[11px] uppercase tracking-wider text-mist">{label}</p>
              <div className="grid grid-cols-[3rem_1fr_3rem] items-center gap-2">
                <span className="text-right font-display text-sm font-bold tabular-nums text-ice">{h ?? '—'}</span>
                <div className="relative flex h-2 overflow-hidden rounded-full bg-night-100">
                  <span
                    className="absolute left-0 top-0 h-full rounded-l-full bg-gradient-to-r from-pitch to-pitch-light"
                    style={{ width: `${hPct}%` }}
                    aria-hidden
                  />
                  <span
                    className="absolute right-0 top-0 h-full rounded-r-full bg-gradient-to-l from-gold to-gold-bright"
                    style={{ width: `${aPct}%` }}
                    aria-hidden
                  />
                </div>
                <span className="text-left font-display text-sm font-bold tabular-nums text-ice">{a ?? '—'}</span>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function PlayerStats({
  stats,
  homeTeam,
  awayTeam,
}: {
  stats: PlayerStatsBundle;
  homeTeam: Team | null;
  awayTeam: Team | null;
}) {
  const renderSide = (rows: PlayerStatsBundle['home'], team: Team | null) => {
    if (!rows || rows.length === 0) return null;
    const allKeys = Array.from(new Set(rows.flatMap((r) => Object.keys(r.stats))));
    const keys = allKeys.slice(0, 5);
    return (
      <div className="rounded-xl border border-night-50/60 bg-night-300/30 p-3">
        <h3 className="mb-2 flex items-center gap-2 font-display text-sm font-bold">
          <span aria-hidden>{team?.flag_emoji}</span>
          {team?.name ?? '—'}
        </h3>
        <div className="overflow-x-auto">
          <table className="w-full text-[11px]">
            <thead className="text-mist">
              <tr>
                <th className="py-1 pr-2 text-left font-normal">#</th>
                <th className="py-1 pr-2 text-left font-normal">Player</th>
                {keys.map((k) => (
                  <th key={k} className="py-1 pr-2 text-right font-normal" title={k}>
                    {k.length > 8 ? k.slice(0, 8) + '…' : k}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.athlete_id} className={r.starter ? 'text-ice' : 'text-mist'}>
                  <td className="py-0.5 pr-2 tabular-nums">{r.jersey ?? ''}</td>
                  <td className="py-0.5 pr-2 truncate" title={r.name}>
                    {r.name}
                  </td>
                  {keys.map((k) => (
                    <td key={k} className="py-0.5 pr-2 text-right tabular-nums">
                      {r.stats[k] ?? '—'}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  };
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {renderSide(stats.home, homeTeam)}
      {renderSide(stats.away, awayTeam)}
    </div>
  );
}

function formatMoneyline(v: number | null | undefined) {
  if (v == null) return '—';
  return v > 0 ? `+${v}` : String(v);
}

function OddsBlock({ odds, homeCode, awayCode }: { odds: OddsBundle; homeCode: string; awayCode: string }) {
  return (
    <div className="rounded-2xl border border-gold/30 bg-night-200 p-4">
      {odds.provider && (
        <p className="mb-3 text-right text-[10px] uppercase tracking-wider text-mist">via {odds.provider}</p>
      )}
      <div className="grid grid-cols-3 gap-2">
        {[
          { label: homeCode, value: odds.homeOdds, accent: true },
          { label: 'Draw', value: odds.drawOdds, accent: false },
          { label: awayCode, value: odds.awayOdds, accent: true },
        ].map((col) => (
          <div
            key={col.label}
            className={`rounded-xl border p-3 text-center ${
              col.accent ? 'border-gold/40 bg-night-100' : 'border-night-50 bg-night-100'
            }`}
          >
            <p className="text-[10px] uppercase tracking-wider text-mist">{col.label}</p>
            <p className="mt-1 font-display text-xl font-extrabold tabular-nums text-gold-bright">
              {formatMoneyline(col.value)}
            </p>
          </div>
        ))}
      </div>
      {(odds.spread || odds.total != null) && (
        <div className="mt-3 flex flex-wrap gap-3 text-xs text-mist">
          {odds.spread && (
            <span>
              Spread: <span className="text-ice">{odds.spread}</span>
            </span>
          )}
          {odds.total != null && (
            <span>
              O/U: <span className="text-ice">{odds.total}</span>
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function hasGamecastContent(g: GamecastBundle): boolean {
  return (
    (g.headToHead?.length ?? 0) > 0 ||
    (g.lastFiveHome?.length ?? 0) > 0 ||
    (g.lastFiveAway?.length ?? 0) > 0 ||
    (g.leaders?.home?.length ?? 0) > 0 ||
    (g.leaders?.away?.length ?? 0) > 0 ||
    (g.officials?.length ?? 0) > 0
  );
}

function FormBadge({ result }: { result: 'W' | 'D' | 'L' }) {
  const color =
    result === 'W' ? 'bg-pitch text-ice' : result === 'D' ? 'bg-night-50 text-mist' : 'bg-live/70 text-night';
  return (
    <span className={`inline-flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold ${color}`}>
      {result}
    </span>
  );
}

function Gamecast({
  gamecast,
  homeTeam,
  awayTeam,
}: {
  gamecast: GamecastBundle;
  homeTeam: Team | null;
  awayTeam: Team | null;
}) {
  return (
    <div className="space-y-4">
      {(gamecast.lastFiveHome?.length || gamecast.lastFiveAway?.length) && (
        <div className="grid gap-4 md:grid-cols-2">
          {(['home', 'away'] as const).map((side) => {
            const last = side === 'home' ? gamecast.lastFiveHome : gamecast.lastFiveAway;
            const team = side === 'home' ? homeTeam : awayTeam;
            if (!last?.length) return null;
            return (
              <div key={side} className="rounded-xl border border-night-50/60 bg-night-200 p-3">
                <p className="mb-2 flex items-center gap-2 text-xs uppercase tracking-wider text-mist">
                  <span aria-hidden>{team?.flag_emoji}</span> {team?.name} · last 5
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {last.map((g, i) => (
                    <span key={i} className="flex items-center gap-1 rounded-md bg-night-100 px-2 py-1 text-[11px]">
                      <FormBadge result={g.result} />
                      <span className="text-mist">vs {g.opponent}</span>
                      <span className="font-display tabular-nums text-ice">{g.score}</span>
                    </span>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {(gamecast.headToHead?.length ?? 0) > 0 && (
        <div className="rounded-xl border border-night-50/60 bg-night-200 p-3">
          <p className="mb-2 text-xs uppercase tracking-wider text-mist">Head-to-head</p>
          <ul className="space-y-1 text-sm">
            {gamecast.headToHead!.slice(0, 5).map((m, i) => (
              <li key={i} className="flex items-center gap-2 text-mist">
                <span className="text-[10px] tabular-nums">{m.date.slice(0, 10)}</span>
                <span className="text-ice">{m.home}</span>
                <span className="font-display tabular-nums text-gold-bright">{m.score}</span>
                <span className="text-ice">{m.away}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {(gamecast.leaders?.home?.length || gamecast.leaders?.away?.length) && (
        <div className="grid gap-4 md:grid-cols-2">
          {(['home', 'away'] as const).map((side) => {
            const ld = side === 'home' ? gamecast.leaders?.home : gamecast.leaders?.away;
            const team = side === 'home' ? homeTeam : awayTeam;
            if (!ld?.length) return null;
            return (
              <div key={side} className="rounded-xl border border-night-50/60 bg-night-200 p-3">
                <p className="mb-2 flex items-center gap-2 text-xs uppercase tracking-wider text-mist">
                  <span aria-hidden>{team?.flag_emoji}</span> {team?.name} · top performers
                </p>
                <ul className="space-y-1 text-sm">
                  {ld.slice(0, 4).map((l, i) => (
                    <li key={i} className="flex items-center justify-between">
                      <span className="text-ice">{l.name}</span>
                      <span className="text-mist">
                        {l.category} · <span className="tabular-nums text-gold-bright">{l.value}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      )}

      {(gamecast.officials?.length || gamecast.attendance || gamecast.weather) && (
        <div className="rounded-xl border border-night-50/60 bg-night-200 p-3 text-sm">
          {gamecast.officials && gamecast.officials.length > 0 && (
            <p className="text-mist">
              <span className="text-[10px] uppercase tracking-wider">Officials</span>:{' '}
              <span className="text-ice">{gamecast.officials.map((o) => o.name).join(' · ')}</span>
            </p>
          )}
          {gamecast.attendance != null && (
            <p className="text-mist">
              <span className="text-[10px] uppercase tracking-wider">Attendance</span>:{' '}
              <span className="tabular-nums text-ice">{gamecast.attendance.toLocaleString()}</span>
            </p>
          )}
          {gamecast.weather?.description && (
            <p className="text-mist">
              <span className="text-[10px] uppercase tracking-wider">Weather</span>:{' '}
              <span className="text-ice">{gamecast.weather.description}</span>
              {gamecast.weather.temperature != null && (
                <span className="text-ice"> · {gamecast.weather.temperature}°</span>
              )}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function Commentary({ entries, live }: { entries: CommentaryEntry[]; live: boolean }) {
  const ordered = live ? [...entries].reverse() : entries;
  return (
    <div className="rounded-2xl border border-night-50/60 bg-night-200 p-4">
      <ul className="space-y-2.5 text-sm">
        {ordered.map((c, i) => (
          <li key={i} className="flex gap-3 border-b border-night-50/30 pb-2 last:border-0">
            <span className="w-10 shrink-0 text-right font-display text-xs font-bold tabular-nums text-gold-bright">
              {c.minute != null ? `${c.minute}'` : '—'}
            </span>
            <span className="text-ice/90">{c.text}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function LineupsPanel({
  match,
  homeLineup,
  awayLineup,
  homeSquad,
  awaySquad,
  finished,
}: {
  match: MatchTabsProps['match'];
  homeLineup: LineupEntry[];
  awayLineup: LineupEntry[];
  homeSquad: Player[];
  awaySquad: Player[];
  finished: boolean;
}) {
  if (homeLineup.length > 0 && awayLineup.length > 0) {
    return (
      <div className="grid gap-6 md:grid-cols-2">
        <FormationPitch
          teamName={match.home_team?.name ?? 'Home'}
          flag={match.home_team?.flag_emoji ?? null}
          entries={homeLineup}
        />
        <FormationPitch
          teamName={match.away_team?.name ?? 'Away'}
          flag={match.away_team?.flag_emoji ?? null}
          entries={awayLineup}
        />
      </div>
    );
  }
  return (
    <div className="space-y-4">
      {!finished && (
        <p className="rounded-lg border border-night-50/60 bg-night-200 p-3 text-sm text-mist">
          Lineups announced ~1 hour before kickoff — here are the full squads.
        </p>
      )}
      <div className="grid gap-6 md:grid-cols-2">
        {match.home_team && (
          <SquadList teamName={match.home_team.name} flag={match.home_team.flag_emoji} players={homeSquad} />
        )}
        {match.away_team && (
          <SquadList teamName={match.away_team.name} flag={match.away_team.flag_emoji} players={awaySquad} />
        )}
      </div>
    </div>
  );
}

function SquadList({
  teamName,
  flag,
  players,
}: {
  teamName: string;
  flag: string | null;
  players: Player[];
}) {
  const byPos = (pos: string) => players.filter((p) => p.position === pos);
  return (
    <div>
      <h3 className="mb-2 flex items-center gap-2 font-display font-bold">
        <span aria-hidden>{flag}</span> {teamName}
      </h3>
      {players.length === 0 ? (
        <p className="text-sm text-mist">Squad not loaded yet.</p>
      ) : (
        <div className="space-y-3 rounded-xl border border-night-50/60 bg-night-200 p-3">
          {(['GK', 'DF', 'MF', 'FW'] as const).map((pos) => {
            const group = byPos(pos);
            if (group.length === 0) return null;
            return (
              <div key={pos}>
                <p className="mb-1 text-[10px] uppercase tracking-widest text-mist">{pos}</p>
                <ul className="space-y-0.5 text-sm">
                  {group.map((p) => (
                    <li key={p.id} className="flex items-baseline gap-2">
                      <span className="w-6 text-right font-display text-xs text-gold-bright tabular-nums">
                        {p.shirt_number}
                      </span>
                      <span>
                        {p.name}
                        {p.is_captain && (
                          <span className="ml-1 text-gold-bright" title="Captain">
                            ©
                          </span>
                        )}
                      </span>
                      {p.club && <span className="text-xs text-mist">· {p.club}</span>}
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
