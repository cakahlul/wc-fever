'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { motion } from 'framer-motion';
import { getBrowserClient, ensureAnonSession } from '@/lib/supabase/client';
import type { Match, Team } from '@/lib/supabase/types';
import {
  applyGroupSimScores,
  autoSimulate,
  buildSimBracket,
  championFromPicks,
  clearGroupScore,
  getGroupScore,
  KNOCKOUT_ORDER,
  setGroupScore,
  setKnockoutWinner,
  type Picks,
  type SimBracketMatch,
} from '@/lib/domain/simulation';
import { slotLabel } from '@/lib/domain/bracket';
import { computeAllStandings, GROUPS } from '@/lib/domain/standings';
import { ConfettiBurst } from './confetti';

/**
 * Bracket simulator. Picks live in component state as
 * { "<match_number>": "<team_id>" } and persist to the `simulations` table
 * (RLS owner-only, anon auth uid). Auto-simulate uses a seeded RNG weighted
 * by fifa_rank so a given seed always reproduces the same tournament.
 */

const STAGE_TITLES: Array<{ stage: string; title: string }> = [
  { stage: 'r32', title: 'Round of 32' },
  { stage: 'r16', title: 'Round of 16' },
  { stage: 'qf', title: 'Quarter-finals' },
  { stage: 'sf', title: 'Semi-finals' },
  { stage: 'third_place', title: 'Third place' },
  { stage: 'final', title: 'Final' },
];

/**
 * After a pick changes, downstream picks may reference teams that no longer
 * reach that match — prune until stable so the bracket never shows a winner
 * who isn't actually an entrant.
 */
function prunePicks(teams: Team[], matches: Match[], picks: Picks): Picks {
  const next = { ...picks };
  for (let pass = 0; pass < KNOCKOUT_ORDER.length; pass++) {
    const bracket = buildSimBracket(teams, matches, next);
    let removed = false;
    for (const sim of bracket) {
      const key = String(sim.match.match_number);
      const pick = next[key];
      if (!pick) continue;
      if (sim.home?.id !== pick && sim.away?.id !== pick) {
        delete next[key];
        removed = true;
      }
    }
    if (!removed) break;
  }
  return next;
}

/**
 * Inline score stepper for a single group-stage match.
 * Real finished matches are locked; the input shows the actual score.
 */
function GroupMatchRow({
  match,
  home,
  away,
  pickedScore,
  onChange,
  onClear,
}: {
  match: Match;
  home: Team | null;
  away: Team | null;
  pickedScore: [number, number] | null;
  onChange: (h: number, a: number) => void;
  onClear: () => void;
}) {
  const finished = match.status === 'finished' && match.home_score != null && match.away_score != null;
  const h = finished ? (match.home_score as number) : pickedScore?.[0] ?? 0;
  const a = finished ? (match.away_score as number) : pickedScore?.[1] ?? 0;
  const isPicked = !!pickedScore;
  const Stepper = ({ value, onDelta, locked }: { value: number; onDelta: (d: number) => void; locked: boolean }) => (
    <div className="flex items-center gap-1">
      <button
        type="button"
        disabled={locked || value === 0}
        onClick={() => onDelta(-1)}
        className="h-5 w-5 rounded bg-night-50 text-xs leading-none hover:bg-night-100 disabled:opacity-30"
        aria-label="decrement"
      >−</button>
      <span className={`w-4 text-center font-display tabular-nums ${isPicked || finished ? 'text-gold-bright' : 'text-mist'}`}>{value}</span>
      <button
        type="button"
        disabled={locked || value >= 9}
        onClick={() => onDelta(+1)}
        className="h-5 w-5 rounded bg-night-50 text-xs leading-none hover:bg-night-100 disabled:opacity-30"
        aria-label="increment"
      >+</button>
    </div>
  );
  return (
    <div className="flex items-center gap-2 rounded-md border border-night-50/50 bg-night-200 px-2 py-1 text-xs">
      <span className="w-6 text-mist tabular-nums">M{match.match_number}</span>
      <span className="flex w-20 items-center gap-1 truncate" title={home?.name}>
        <span aria-hidden>{home?.flag_emoji ?? '·'}</span>
        <span className="truncate">{home?.code ?? '?'}</span>
      </span>
      <Stepper value={h} onDelta={(d) => onChange(Math.max(0, h + d), a)} locked={finished} />
      <span aria-hidden className="text-mist">–</span>
      <Stepper value={a} onDelta={(d) => onChange(h, Math.max(0, a + d))} locked={finished} />
      <span className="flex w-20 items-center gap-1 truncate" title={away?.name}>
        <span aria-hidden>{away?.flag_emoji ?? '·'}</span>
        <span className="truncate">{away?.code ?? '?'}</span>
      </span>
      {finished && <span className="text-[10px] uppercase tracking-wider text-pitch-line">final</span>}
      {isPicked && !finished && (
        <button
          type="button"
          onClick={onClear}
          className="ml-auto text-[10px] uppercase tracking-wider text-mist hover:text-live"
          aria-label="Clear pick"
        >
          clear
        </button>
      )}
    </div>
  );
}

function PickCard({
  sim,
  onPick,
  locked,
}: {
  sim: SimBracketMatch;
  onPick: (matchNumber: number, teamId: string) => void;
  locked: boolean;
}) {
  const n = sim.match.match_number!;
  const btn = (team: Team | null, fallback: string | null) => {
    const isPicked = !!team && sim.pickedWinnerId === team.id;
    return (
      <button
        type="button"
        disabled={!team || locked}
        aria-label={team ? `Pick ${team.name} to win match ${n}` : 'Awaiting team'}
        onClick={() => team && onPick(n, team.id)}
        className={`flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-xs transition-colors ${
          isPicked
            ? 'bg-gold/20 font-bold text-gold-bright'
            : team
              ? 'hover:bg-night-50'
              : 'cursor-default italic text-mist'
        }`}
      >
        <span aria-hidden>{team?.flag_emoji ?? '·'}</span>
        <span className="truncate">{team?.name ?? slotLabel(fallback)}</span>
        {isPicked && <span aria-hidden className="ml-auto">✓</span>}
      </button>
    );
  };

  return (
    <div className={`w-52 rounded-lg border bg-night-200 p-1 ${locked ? 'border-pitch-line/40' : 'border-night-50/70'}`}>
      <p className="px-2 pt-1 text-[9px] uppercase tracking-wider text-mist">
        M{n} {locked && <span className="text-pitch-line">· result final</span>}
      </p>
      {btn(sim.home, sim.match.home_slot)}
      {btn(sim.away, sim.match.away_slot)}
    </div>
  );
}

export function SimulatorClient({ teams, matches }: { teams: Team[]; matches: Match[] }) {
  const searchParams = useSearchParams();
  const [picks, setPicks] = useState<Picks>({});
  const [simId, setSimId] = useState<string | null>(null);
  const [simName, setSimName] = useState('My bracket');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [confettiSeed, setConfettiSeed] = useState(0);

  // Load a saved simulation when arriving via /simulator?sim=<id>.
  useEffect(() => {
    const id = searchParams.get('sim');
    if (!id) return;
    (async () => {
      const supabase = getBrowserClient();
      if (!supabase) return;
      await ensureAnonSession();
      const { data } = await supabase.from('simulations').select('*').eq('id', id).maybeSingle();
      if (data) {
        setPicks((data.picks as Picks) ?? {});
        setSimId(data.id);
        setSimName(data.name);
      }
    })();
  }, [searchParams]);

  const bracket = useMemo(() => buildSimBracket(teams, matches, picks), [teams, matches, picks]);
  const champion = useMemo(() => championFromPicks(teams, matches, picks), [teams, matches, picks]);
  const pickedCount = Object.keys(picks).length;

  useEffect(() => {
    if (champion) setConfettiSeed((s) => s + 1);
  }, [champion?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const handlePick = useCallback(
    (matchNumber: number, teamId: string) => {
      setPicks((prev) => prunePicks(teams, matches, setKnockoutWinner(prev, matchNumber, teamId)));
    },
    [teams, matches]
  );

  const handleGroupScore = useCallback(
    (matchNumber: number, h: number, a: number) => {
      setPicks((prev) => prunePicks(teams, matches, setGroupScore(prev, matchNumber, h, a)));
    },
    [teams, matches]
  );

  const handleGroupScoreClear = useCallback(
    (matchNumber: number) => {
      setPicks((prev) => prunePicks(teams, matches, clearGroupScore(prev, matchNumber)));
    },
    [teams, matches]
  );

  const handleAutoSim = () => {
    const seed = `wc2026-${Date.now()}`;
    setPicks((prev) => autoSimulate(teams, matches, prev, seed));
  };

  // Sync with current matchday: ask the server to refresh, then prefill picks
  // from whatever real finished matches the DB now reports. Reload picks state
  // wholesale — anything the user manually picked for a now-finished match is
  // overridden by reality (which is the whole point of the button).
  const [syncing, setSyncing] = useState(false);
  const handleSync = async () => {
    setSyncing(true);
    setMessage(null);
    try {
      // Fire-and-forget kick the live tick so any in-progress match catches up.
      // Reconcile is too slow to await on a click; we just refresh the DB read.
      fetch('/api/crawl/live', { method: 'POST' }).catch(() => {});

      const supabase = getBrowserClient();
      if (!supabase) throw new Error('Supabase not configured');
      const { data: fresh } = await supabase.from('matches').select('*').order('match_number');
      if (!fresh) throw new Error('Failed to load matches');

      let next: Picks = { ...picks };
      for (const m of fresh) {
        if (m.status !== 'finished' || m.match_number == null) continue;
        if (m.home_score == null || m.away_score == null) continue;
        if (m.stage === 'group') {
          next = setGroupScore(next, m.match_number, m.home_score, m.away_score);
        } else if (m.home_score !== m.away_score && m.home_team_id && m.away_team_id) {
          const winnerId = m.home_score > m.away_score ? m.home_team_id : m.away_team_id;
          next = setKnockoutWinner(next, m.match_number, winnerId);
        }
      }
      setPicks(prunePicks(teams, fresh as Match[], next));
      setMessage('Synced with current matchday ✓');
    } catch (e) {
      setMessage(`Sync failed: ${(e as Error).message}`);
    } finally {
      setSyncing(false);
    }
  };

  const handleSave = async () => {
    const supabase = getBrowserClient();
    if (!supabase) {
      setMessage('Supabase not configured');
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      const userId = await ensureAnonSession();
      if (!userId) throw new Error('Could not establish a session');
      const row = {
        user_id: userId,
        name: simName.trim() || 'My bracket',
        picks,
        champion_team_id: champion?.id ?? null,
      };
      if (simId) {
        const { error } = await supabase.from('simulations').update(row).eq('id', simId);
        if (error) throw error;
      } else {
        const { data, error } = await supabase
          .from('simulations')
          .insert(row)
          .select('id')
          .single();
        if (error) throw error;
        setSimId(data.id);
      }
      setMessage('Saved ✓');
    } catch (e) {
      setMessage(`Save failed: ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold">Simulator</h1>
          <p className="text-sm text-mist">
            Pick winners match by match, or let the seeded engine run the whole thing.
            {pickedCount > 0 && ` · ${pickedCount}/32 picked`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={handleSync}
            disabled={syncing}
            className="rounded-lg border border-pitch-line bg-night-100 px-4 py-2 text-sm hover:border-gold disabled:opacity-50"
          >
            {syncing ? 'Syncing…' : '↻ Sync with current matchday'}
          </button>
          <button
            type="button"
            onClick={handleAutoSim}
            className="rounded-lg bg-gold px-4 py-2 text-sm font-bold text-night transition-colors hover:bg-gold-bright"
          >
            🎲 Auto-simulate
          </button>
          <button
            type="button"
            onClick={() => {
              setPicks({});
              setSimId(null);
            }}
            className="rounded-lg border border-night-50 bg-night-100 px-4 py-2 text-sm hover:border-live/60"
          >
            Reset
          </button>
        </div>
      </div>

      {/* Champion banner */}
      {champion && (
        <motion.div
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 200, damping: 16 }}
          className="relative overflow-hidden rounded-2xl border border-gold/60 bg-gradient-to-br from-night-100 via-night-200 to-pitch/40 p-8 text-center shadow-glow-strong"
        >
          <ConfettiBurst seed={confettiSeed} />
          <motion.div
            aria-hidden
            className="text-6xl"
            initial={{ y: 20 }}
            animate={{ y: [20, -6, 0] }}
            transition={{ duration: 0.8 }}
          >
            🏆
          </motion.div>
          <p className="mt-2 text-xs uppercase tracking-[0.3em] text-gold-bright">Your champion</p>
          <p className="mt-1 font-display text-3xl font-extrabold">
            <span aria-hidden>{champion.flag_emoji}</span> {champion.name}
          </p>
        </motion.div>
      )}

      {/* Save bar */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-night-50/60 bg-night-200 p-3">
        <label htmlFor="sim-name" className="text-xs uppercase tracking-wider text-mist">
          Name
        </label>
        <input
          id="sim-name"
          value={simName}
          onChange={(e) => setSimName(e.target.value)}
          className="min-w-0 flex-1 rounded-lg border border-night-50 bg-night-100 px-3 py-1.5 text-sm focus:border-gold focus:outline-none"
        />
        <button
          type="button"
          onClick={handleSave}
          disabled={saving || pickedCount === 0}
          className="rounded-lg bg-pitch-light px-4 py-1.5 text-sm font-bold text-ice transition-colors hover:bg-pitch-line disabled:opacity-40"
        >
          {saving ? 'Saving…' : simId ? 'Update' : 'Save'}
        </button>
        {message && <span className="text-xs text-mist">{message}</span>}
      </div>

      {/* Group stage — score picks per match, with projected standings */}
      <GroupStageSection
        teams={teams}
        matches={matches}
        picks={picks}
        onScore={handleGroupScore}
        onClear={handleGroupScoreClear}
      />

      {/* Rounds */}
      <div className="bracket-scroll overflow-x-auto rounded-xl border border-night-50/60 bg-night-300/50 p-4">
        <div className="flex gap-8" style={{ width: `${STAGE_TITLES.length * 240}px` }}>
          {STAGE_TITLES.map(({ stage, title }) => {
            const nodes = bracket.filter((b) => b.match.stage === stage);
            if (nodes.length === 0) return null;
            return (
              <div key={stage} className="flex flex-col">
                <h2 className="mb-3 text-center font-display text-xs font-bold uppercase tracking-widest text-gold-bright">
                  {title}
                </h2>
                <div className="flex flex-1 flex-col justify-around gap-2">
                  {nodes.map((sim) => (
                    <PickCard
                      key={sim.match.id}
                      sim={sim}
                      onPick={handlePick}
                      locked={sim.match.status === 'finished'}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function GroupStageSection({
  teams,
  matches,
  picks,
  onScore,
  onClear,
}: {
  teams: Team[];
  matches: Match[];
  picks: Picks;
  onScore: (matchNumber: number, h: number, a: number) => void;
  onClear: (matchNumber: number) => void;
}) {
  const teamsById = useMemo(() => new Map(teams.map((t) => [t.id, t])), [teams]);
  // Projected standings layer simulated scores over real results.
  const standings = useMemo(
    () => computeAllStandings(teams, applyGroupSimScores(matches, picks)),
    [teams, matches, picks]
  );

  return (
    <section className="space-y-3">
      <h2 className="font-display text-lg font-bold">Group stage</h2>
      <p className="text-xs text-mist">
        Pick scores to project group standings. Real finished matches lock automatically.
      </p>
      <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-3">
        {GROUPS.map((g) => {
          const groupMatches = matches
            .filter((m) => m.stage === 'group' && m.group === g && m.match_number != null)
            .sort((a, b) => a.match_number! - b.match_number!);
          const table = standings.get(g) ?? [];
          return (
            <div key={g} className="rounded-xl border border-night-50/60 bg-night-300/40 p-3">
              <h3 className="mb-2 font-display text-sm font-bold text-gold-bright">Group {g}</h3>
              <div className="space-y-1">
                {groupMatches.map((m) => (
                  <GroupMatchRow
                    key={m.id}
                    match={m}
                    home={m.home_team_id ? teamsById.get(m.home_team_id) ?? null : null}
                    away={m.away_team_id ? teamsById.get(m.away_team_id) ?? null : null}
                    pickedScore={getGroupScore(picks, m.match_number!)}
                    onChange={(h, a) => onScore(m.match_number!, h, a)}
                    onClear={() => onClear(m.match_number!)}
                  />
                ))}
              </div>
              {table.length > 0 && (
                <table className="mt-3 w-full text-[11px]">
                  <thead className="text-mist">
                    <tr>
                      <th className="text-left font-normal">#</th>
                      <th className="text-left font-normal">Team</th>
                      <th className="text-right font-normal">Pts</th>
                      <th className="text-right font-normal">GD</th>
                    </tr>
                  </thead>
                  <tbody>
                    {table.map((row) => (
                      <tr key={row.team.id} className={row.rank <= 2 ? 'text-ice' : 'text-mist'}>
                        <td className="tabular-nums">{row.rank}</td>
                        <td className="truncate">{row.team.flag_emoji} {row.team.code}</td>
                        <td className="text-right tabular-nums">{row.points}</td>
                        <td className="text-right tabular-nums">{row.gd >= 0 ? `+${row.gd}` : row.gd}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
