import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  getLineups,
  getMatchById,
  getPlayersByTeam,
  getReview,
} from '@/lib/supabase/queries';
import { isBigMatch } from '@/lib/domain/big-match';
import { formatMatchMinute } from '@/lib/domain/minute';
import { slotLabel } from '@/lib/domain/bracket';
import { BigMatchBadge } from '@/components/big-match-badge';
import { LocalTime } from '@/components/local-time';
import { STAGE_LABEL } from '@/components/match-card';
import { MatchTabs } from '@/components/match-tabs';

export const dynamic = 'force-dynamic';

export default async function MatchPage({ params }: { params: { id: string } }) {
  const match = await getMatchById(params.id);
  if (!match) notFound();

  const [lineups, review] = await Promise.all([getLineups(match.id), getReview(match.id)]);
  const [homeSquad, awaySquad] = await Promise.all([
    match.home_team_id && lineups.length === 0 ? getPlayersByTeam(match.home_team_id) : Promise.resolve([]),
    match.away_team_id && lineups.length === 0 ? getPlayersByTeam(match.away_team_id) : Promise.resolve([]),
  ]);

  const big = isBigMatch(match, match.home_team, match.away_team);
  const live = match.status === 'live';
  const finished = match.status === 'finished';

  return (
    <div className="space-y-6">
      {/* Header / scoreboard — stays sticky at top, all other detail lives in tabs below */}
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
                {formatMatchMinute(match.minute, match.minute_stoppage) ?? 'LIVE'}
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

      <MatchTabs
        match={match}
        lineups={lineups}
        homeSquad={homeSquad}
        awaySquad={awaySquad}
        reviewBody={review?.body ?? null}
      />

      <div className="flex gap-4 text-sm">
        {match.home_team && (
          <Link href={`/teams/${match.home_team.code}`} className="text-gold-bright underline">
            {match.home_team.name} squad
          </Link>
        )}
        {match.away_team && (
          <Link href={`/teams/${match.away_team.code}`} className="text-gold-bright underline">
            {match.away_team.name} squad
          </Link>
        )}
      </div>
    </div>
  );
}
