'use client';

import { isBigMatch } from '@/lib/domain/big-match';
import { formatMatchMinute } from '@/lib/domain/minute';
import { goalScorers, liveBreakLabel, type Scorer } from '@/lib/domain/match-state';
import { slotLabel } from '@/lib/domain/bracket';
import type { MatchWithTeams } from '@/lib/supabase/types';
import { BigMatchBadge } from './big-match-badge';
import { LocalTime } from './local-time';
import { STAGE_LABEL } from './match-card';

function ScorerList({ scorers, align }: { scorers: Scorer[]; align: 'left' | 'right' }) {
  if (scorers.length === 0) return null;
  return (
    <ul className={`mt-1.5 space-y-0.5 ${align === 'right' ? 'text-right' : 'text-left'}`}>
      {scorers.map((s, i) => (
        <li key={i} className="text-[11px] text-mist">
          {s.player} <span className="tabular-nums text-gold-bright/80">{s.minute}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * Match detail scoreboard — pure presentation. Its `match` prop is kept live by
 * the parent <MatchLive>, so score + minute update in place, in sync with the
 * home "Live now" cards and /live.
 */
export function MatchScoreboard({ match }: { match: MatchWithTeams }) {
  const big = isBigMatch(match, match.home_team, match.away_team);
  const live = match.status === 'live';
  const finished = match.status === 'finished';
  const breakLabel = liveBreakLabel(match);
  const scorers = live || finished ? goalScorers(match.events) : { home: [], away: [] };

  return (
    <section
      className={`rounded-2xl border p-6 text-center ${
        big.isBig ? 'big-match-shimmer border-gold/40 bg-night-100 shadow-glow' : 'border-night-50/60 bg-night-200'
      }`}
    >
      <p className="mb-3 flex items-center justify-center gap-2 text-xs uppercase tracking-widest text-mist">
        {match.stage === 'group' && match.group
          ? `Group ${match.group} · Matchday ${match.matchday}`
          : STAGE_LABEL[match.stage]}
        {match.match_number ? ` · Match ${match.match_number}` : ''}
        {big.isBig && <BigMatchBadge />}
      </p>
      <div className="grid grid-cols-3 items-center gap-2">
        <div>
          <div aria-hidden className="text-4xl">{match.home_team?.flag_emoji ?? '⚽'}</div>
          <p className="mt-1 font-display font-bold">
            {match.home_team?.name ?? slotLabel(match.home_slot)}
          </p>
          <ScorerList scorers={scorers.home} align="right" />
        </div>
        <div>
          {live || finished ? (
            <p className="font-display text-4xl font-extrabold tabular-nums text-gold-bright">
              {match.home_score ?? 0} – {match.away_score ?? 0}
            </p>
          ) : (
            <p className="font-display text-2xl text-mist">vs</p>
          )}
          {live && (
            <p className="mt-1 flex items-center justify-center gap-1.5 text-sm font-bold text-live">
              <span aria-hidden className="h-2 w-2 rounded-full bg-live animate-live-pulse" />
              {breakLabel ?? formatMatchMinute(match.minute, match.minute_stoppage) ?? 'LIVE'}
            </p>
          )}
          {finished && <p className="mt-1 text-xs uppercase text-mist">Full time</p>}
          {!live && !finished && (
            <p className="mt-1 text-sm text-mist">
              <LocalTime utc={match.kickoff_utc} withDate />
            </p>
          )}
        </div>
        <div>
          <div aria-hidden className="text-4xl">{match.away_team?.flag_emoji ?? '⚽'}</div>
          <p className="mt-1 font-display font-bold">
            {match.away_team?.name ?? slotLabel(match.away_slot)}
          </p>
          <ScorerList scorers={scorers.away} align="left" />
        </div>
      </div>
      {match.venue && (
        <p className="mt-4 text-sm text-mist">
          {match.venue} · {match.city}
        </p>
      )}
      {big.isBig && !finished && (
        <p className="mt-2 text-xs text-gold-bright/80">{big.reasons.join(' · ')}</p>
      )}
    </section>
  );
}
