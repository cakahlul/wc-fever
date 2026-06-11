'use client';

import { useState } from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';

/** Serializable bracket node prepared server-side (app/bracket/page.tsx). */
export interface BracketNode {
  id: string;
  matchNumber: number | null;
  status: string;
  homeScore: number | null;
  awayScore: number | null;
  home: { name: string; flag: string | null } | null;
  away: { name: string; flag: string | null } | null;
  homeLabel: string;
  awayLabel: string;
  venue: string | null;
  city: string | null;
}

export interface BracketRound {
  title: string;
  nodes: BracketNode[];
}

function NodeCard({ node, index }: { node: BracketNode; index: number }) {
  const finished = node.status === 'finished';
  const homeWon = finished && (node.homeScore ?? 0) > (node.awayScore ?? 0);
  const awayWon = finished && (node.awayScore ?? 0) > (node.homeScore ?? 0);

  const row = (
    side: BracketNode['home'],
    label: string,
    score: number | null,
    won: boolean
  ) => (
    <div className={`flex items-center justify-between gap-2 px-2 py-1 ${won ? 'bg-gold/10' : ''}`}>
      <span className={`flex min-w-0 items-center gap-1.5 text-xs ${side ? '' : 'italic text-mist'}`}>
        {side && <span aria-hidden>{side.flag}</span>}
        <span className="truncate">{side?.name ?? label}</span>
      </span>
      {score != null && (
        <span className={`font-display text-sm tabular-nums ${won ? 'font-bold text-gold-bright' : ''}`}>
          {score}
        </span>
      )}
    </div>
  );

  return (
    <div className="relative flex items-center">
      <Link
        href={`/match/${node.id}`}
        className="w-48 rounded-lg border border-night-50/70 bg-night-200 py-1 transition-colors hover:border-gold/50"
      >
        <div className="px-2 pb-0.5 text-[9px] uppercase tracking-wider text-mist">
          M{node.matchNumber} {node.city ? `· ${node.city}` : ''}
          {node.status === 'live' && <span className="ml-1 font-bold text-live">LIVE</span>}
        </div>
        {row(node.home, node.homeLabel, finished || node.status === 'live' ? node.homeScore : null, homeWon)}
        {row(node.away, node.awayLabel, finished || node.status === 'live' ? node.awayScore : null, awayWon)}
      </Link>
      {/* connector line: draws in with framer-motion as the bracket loads */}
      <motion.span
        aria-hidden
        className="absolute -right-6 top-1/2 hidden h-px w-6 origin-left bg-gold/40 md:block"
        initial={{ scaleX: 0 }}
        whileInView={{ scaleX: 1 }}
        viewport={{ once: true }}
        transition={{ duration: 0.5, delay: 0.1 + index * 0.05 }}
      />
    </div>
  );
}

export function BracketView({ rounds, thirdPlace }: { rounds: BracketRound[]; thirdPlace: BracketNode | null }) {
  const [zoom, setZoom] = useState(1);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold">Bracket</h1>
          <p className="text-sm text-mist">Round of 32 → Final · scroll sideways, zoom with the buttons</p>
        </div>
        <div className="flex gap-1" role="group" aria-label="Zoom controls">
          <button
            type="button"
            aria-label="Zoom out"
            onClick={() => setZoom((z) => Math.max(0.5, +(z - 0.15).toFixed(2)))}
            className="h-9 w-9 rounded-lg border border-night-50 bg-night-100 font-bold hover:border-gold/50"
          >
            −
          </button>
          <button
            type="button"
            aria-label="Zoom in"
            onClick={() => setZoom((z) => Math.min(1.4, +(z + 0.15).toFixed(2)))}
            className="h-9 w-9 rounded-lg border border-night-50 bg-night-100 font-bold hover:border-gold/50"
          >
            +
          </button>
        </div>
      </div>

      <div className="bracket-scroll overflow-x-auto rounded-xl border border-night-50/60 bg-night-300/50 p-4">
        <div
          className="flex origin-top-left gap-12"
          style={{ transform: `scale(${zoom})`, width: `${rounds.length * 240}px` }}
        >
          {rounds.map((round) => (
            <div key={round.title} className="flex flex-col">
              <h2 className="mb-3 text-center font-display text-xs font-bold uppercase tracking-widest text-gold-bright">
                {round.title}
              </h2>
              <div className="flex flex-1 flex-col justify-around gap-3">
                {round.nodes.map((n, i) => (
                  <NodeCard key={n.id} node={n} index={i} />
                ))}
                {/* third-place playoff sits under the final column */}
                {round.title === 'Final' && thirdPlace && (
                  <div className="mt-8">
                    <h3 className="mb-2 text-center text-[10px] uppercase tracking-widest text-mist">
                      Third place
                    </h3>
                    <NodeCard node={thirdPlace} index={0} />
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
