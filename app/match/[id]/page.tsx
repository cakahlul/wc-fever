import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  getLineups,
  getMatchById,
  getPlayersByTeam,
  getReview,
} from '@/lib/supabase/queries';
import { isBigMatch } from '@/lib/domain/big-match';
import { slotLabel } from '@/lib/domain/bracket';
import { FormationPitch } from '@/components/formation-pitch';
import { BigMatchBadge } from '@/components/big-match-badge';
import { LocalTime } from '@/components/local-time';
import { STAGE_LABEL } from '@/components/match-card';
import type { Player } from '@/lib/supabase/types';

export const dynamic = 'force-dynamic';

function SquadFallback({ teamName, flag, players }: { teamName: string; flag: string | null; players: Player[] }) {
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
                        {p.is_captain && <span className="ml-1 text-gold-bright" title="Captain">©</span>}
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
  const homeLineup = lineups.filter((l) => l.team_id === match.home_team_id);
  const awayLineup = lineups.filter((l) => l.team_id === match.away_team_id);

  return (
    <div className="space-y-8">
      {/* Header / scoreboard */}
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
                {match.minute != null ? `${match.minute}'` : 'LIVE'}
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

      {/* Events timeline */}
      {(match.events ?? []).length > 0 && (
        <section aria-labelledby="events">
          <h2 id="events" className="mb-2 font-display text-lg font-bold">Key events</h2>
          <ul className="space-y-1 text-sm">
            {match.events.map((e, i) => (
              <li key={i} className="flex items-center gap-2 text-mist">
                <span className="w-9 text-right font-display text-gold-bright tabular-nums">{e.minute}&#8242;</span>
                <span aria-hidden>
                  {e.type === 'goal' || e.type === 'penalty' ? '⚽' : e.type === 'own_goal' ? '🥅' : e.type === 'yellow' ? '🟨' : e.type === 'sub' ? '🔁' : '🟥'}
                </span>
                <span className="text-ice">{e.player ?? e.type}</span>
                <span>({e.team === 'home' ? match.home_team?.code : match.away_team?.code})</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Review / hype blurb */}
      {review && (
        <section
          aria-labelledby="review"
          className="rounded-xl border border-gold/30 bg-night-200 p-4"
        >
          <h2 id="review" className="mb-2 font-display text-lg font-bold text-gold-bright">
            {finished ? 'Match review' : 'The hype'}
          </h2>
          <p className="leading-relaxed text-ice/90">{review.body}</p>
        </section>
      )}

      {/* Lineups / squad fallback */}
      <section aria-labelledby="lineups">
        <h2 id="lineups" className="mb-3 font-display text-lg font-bold">Lineups</h2>
        {homeLineup.length > 0 && awayLineup.length > 0 ? (
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
        ) : (
          <div className="space-y-4">
            {!finished && (
              <p className="rounded-lg border border-night-50/60 bg-night-200 p-3 text-sm text-mist">
                Lineups announced ~1 hour before kickoff — here are the full squads.
              </p>
            )}
            <div className="grid gap-6 md:grid-cols-2">
              {match.home_team && (
                <SquadFallback teamName={match.home_team.name} flag={match.home_team.flag_emoji} players={homeSquad} />
              )}
              {match.away_team && (
                <SquadFallback teamName={match.away_team.name} flag={match.away_team.flag_emoji} players={awaySquad} />
              )}
            </div>
          </div>
        )}
      </section>

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
