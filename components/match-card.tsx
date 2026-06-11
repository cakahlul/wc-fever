'use client';

import Link from 'next/link';
import { motion } from 'framer-motion';
import type { MatchWithTeams } from '@/lib/supabase/types';
import { slotLabel } from '@/lib/domain/bracket';
import { isBigMatch } from '@/lib/domain/big-match';
import { LocalTime } from './local-time';
import { BigMatchBadge } from './big-match-badge';

export const STAGE_LABEL: Record<string, string> = {
  group: 'Group',
  r32: 'Round of 32',
  r16: 'Round of 16',
  qf: 'Quarter-final',
  sf: 'Semi-final',
  third_place: 'Third place',
  final: 'FINAL',
};

function TeamRow({
  team,
  slot,
  score,
  winner,
}: {
  team: MatchWithTeams['home_team'];
  slot: string | null;
  score: number | null;
  winner: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <div className="flex min-w-0 items-center gap-2">
        <span aria-hidden className="text-lg">
          {team?.flag_emoji ?? '⚽'}
        </span>
        <span
          className={`truncate text-sm ${
            team ? (winner ? 'font-bold text-ice' : 'text-ice') : 'italic text-mist'
          }`}
        >
          {team?.name ?? slotLabel(slot)}
        </span>
      </div>
      {score != null && (
        <span className={`font-display text-lg tabular-nums ${winner ? 'font-bold text-gold-bright' : ''}`}>
          {score}
        </span>
      )}
    </div>
  );
}

export function MatchCard({ match }: { match: MatchWithTeams }) {
  const big = isBigMatch(match, match.home_team, match.away_team).isBig;
  const finished = match.status === 'finished';
  const live = match.status === 'live';
  const homeWon =
    finished && match.home_score != null && match.away_score != null
      ? match.home_score > match.away_score
      : false;
  const awayWon =
    finished && match.home_score != null && match.away_score != null
      ? match.away_score > match.home_score
      : false;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
    >
      <Link
        href={`/match/${match.id}`}
        className={`block rounded-xl border p-3 transition-colors hover:border-gold/50 ${
          big
            ? 'big-match-shimmer border-gold/40 bg-gradient-to-br from-night-100 to-night-200 shadow-glow'
            : 'border-night-50/60 bg-night-200'
        }`}
      >
        <div className="mb-2 flex items-center justify-between gap-2 text-[11px] uppercase tracking-wider text-mist">
          <span>
            {match.stage === 'group' && match.group
              ? `Group ${match.group} · MD${match.matchday}`
              : STAGE_LABEL[match.stage]}
            {match.match_number ? ` · M${match.match_number}` : ''}
          </span>
          <span className="flex items-center gap-2">
            {big && <BigMatchBadge />}
            {live ? (
              <span className="flex items-center gap-1 font-bold text-live">
                <span aria-hidden className="h-2 w-2 rounded-full bg-live animate-live-pulse" />
                LIVE {match.minute != null ? `${match.minute}'` : ''}
              </span>
            ) : finished ? (
              <span>FT</span>
            ) : (
              <LocalTime utc={match.kickoff_utc} withDate />
            )}
          </span>
        </div>
        <div className="space-y-1.5">
          <TeamRow
            team={match.home_team}
            slot={match.home_slot}
            score={live || finished ? match.home_score : null}
            winner={homeWon}
          />
          <TeamRow
            team={match.away_team}
            slot={match.away_slot}
            score={live || finished ? match.away_score : null}
            winner={awayWon}
          />
        </div>
        {match.venue && (
          <p className="mt-2 truncate text-[11px] text-mist">
            {match.venue}, {match.city}
          </p>
        )}
      </Link>
    </motion.div>
  );
}
