'use client';

import Link from 'next/link';
import { motion } from 'framer-motion';
import type { Clinch, TeamStanding } from '@/lib/domain/standings';

/**
 * Renders the 12 group tables + the best-thirds mini-table. Standings are
 * computed server-side in lib/domain/standings.ts (full FIFA tiebreakers) and
 * passed in as plain data.
 */

function GroupTable({
  group,
  rows,
  clinch,
}: {
  group: string;
  rows: TeamStanding[];
  clinch: Map<string, Clinch>;
}) {
  return (
    <div className="rounded-xl border border-night-50/60 bg-night-200 p-3">
      <h3 className="mb-2 font-display text-sm font-bold uppercase tracking-widest text-gold-bright">
        Group {group}
      </h3>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-[10px] uppercase tracking-wider text-mist">
            <th className="pb-1 pr-1 font-normal">#</th>
            <th className="pb-1 font-normal">Team</th>
            {['P', 'W', 'D', 'L', 'GF', 'GA', 'GD', 'Pts'].map((h) => (
              <th key={h} className="pb-1 text-center font-normal">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const status = clinch.get(r.team.id) ?? 'open';
            const qualified = status === 'champion' || status === 'top2';
            const eliminated = status === 'eliminated';
            return (
            <motion.tr
              key={r.team.id}
              layout
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: i * 0.04 }}
              className={`border-t border-night-50/40 ${
                qualified ? 'bg-pitch/20' : eliminated ? 'bg-live/10' : ''
              }`}
            >
              <td className="py-1.5 pr-1 text-mist">{r.rank}</td>
              <td className="py-1.5">
                <Link href={`/teams/${r.team.code}`} className="flex items-center gap-1.5 hover:text-gold-bright">
                  <span aria-hidden>{r.team.flag_emoji}</span>
                  <span className="truncate">{r.team.code}</span>
                  {qualified && (
                    <span
                      className="rounded bg-pitch-line/20 px-1 text-[9px] font-bold uppercase text-pitch-line"
                      title="Qualified to the knockout round"
                    >
                      Q
                    </span>
                  )}
                  {eliminated && (
                    <span
                      className="rounded bg-live/20 px-1 text-[9px] font-bold uppercase text-live"
                      title="Eliminated — cannot reach the knockout round"
                    >
                      OUT
                    </span>
                  )}
                </Link>
              </td>
              <td className="py-1.5 text-center tabular-nums">{r.played}</td>
              <td className="py-1.5 text-center tabular-nums">{r.won}</td>
              <td className="py-1.5 text-center tabular-nums">{r.drawn}</td>
              <td className="py-1.5 text-center tabular-nums">{r.lost}</td>
              <td className="py-1.5 text-center tabular-nums">{r.gf}</td>
              <td className="py-1.5 text-center tabular-nums">{r.ga}</td>
              <td className="py-1.5 text-center tabular-nums">{r.gd > 0 ? `+${r.gd}` : r.gd}</td>
              <td className="py-1.5 text-center font-bold tabular-nums text-gold-bright">{r.points}</td>
            </motion.tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function StandingsTables({
  groups,
  thirds,
  allComplete,
}: {
  groups: Array<{ group: string; rows: TeamStanding[]; clinch: Map<string, Clinch> }>;
  thirds: TeamStanding[];
  /** Best-8 thirds only resolve once every group has finished. */
  allComplete: boolean;
}) {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-display text-2xl font-bold">Standings</h1>
        <p className="text-sm text-mist">
          Top 2 qualify directly · 8 best third-placed teams join the round of 32
        </p>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {groups.map(({ group, rows, clinch }) => (
          <GroupTable key={group} group={group} rows={rows} clinch={clinch} />
        ))}
      </div>

      <section aria-labelledby="best-thirds" className="rounded-xl border border-gold/30 bg-night-200 p-4">
        <h2 id="best-thirds" className="mb-1 font-display text-lg font-bold text-gold-bright">
          Best third-placed teams
        </h2>
        <p className="mb-3 text-xs text-mist">
          Ranked points → GD → GF → fair play. The top 8 advance to the round of 32.
        </p>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-wider text-mist">
              <th className="pb-1 pr-2 font-normal">#</th>
              <th className="pb-1 font-normal">Team</th>
              <th className="pb-1 text-center font-normal">Grp</th>
              <th className="pb-1 text-center font-normal">P</th>
              <th className="pb-1 text-center font-normal">GD</th>
              <th className="pb-1 text-center font-normal">GF</th>
              <th className="pb-1 text-center font-normal">Pts</th>
            </tr>
          </thead>
          <tbody>
            {thirds.map((r, i) => {
              const qualified = allComplete && i < 8;
              return (
              <motion.tr
                key={r.team.id}
                layout
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.03 }}
                className={`border-t border-night-50/40 ${
                  qualified ? 'bg-pitch/20' : allComplete ? 'opacity-60' : ''
                }`}
              >
                <td className="py-1.5 pr-2 text-mist">{i + 1}</td>
                <td className="py-1.5">
                  <span className="flex items-center gap-1.5">
                    <span aria-hidden>{r.team.flag_emoji}</span> {r.team.name}
                    {qualified && (
                      <span className="rounded bg-pitch-line/20 px-1 text-[9px] font-bold uppercase text-pitch-line">
                        Q
                      </span>
                    )}
                  </span>
                </td>
                <td className="py-1.5 text-center">{r.team.group}</td>
                <td className="py-1.5 text-center tabular-nums">{r.played}</td>
                <td className="py-1.5 text-center tabular-nums">{r.gd > 0 ? `+${r.gd}` : r.gd}</td>
                <td className="py-1.5 text-center tabular-nums">{r.gf}</td>
                <td className="py-1.5 text-center font-bold tabular-nums text-gold-bright">{r.points}</td>
              </motion.tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </div>
  );
}
