import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  getLineups,
  getMatchById,
  getPlayersByTeam,
  getReview,
} from '@/lib/supabase/queries';
import { MatchLive } from '@/components/match-live';

export const dynamic = 'force-dynamic';

export default async function MatchPage({ params }: { params: { id: string } }) {
  const match = await getMatchById(params.id);
  if (!match) notFound();

  const [lineups, review] = await Promise.all([getLineups(match.id), getReview(match.id)]);
  const [homeSquad, awaySquad] = await Promise.all([
    match.home_team_id && lineups.length === 0 ? getPlayersByTeam(match.home_team_id) : Promise.resolve([]),
    match.away_team_id && lineups.length === 0 ? getPlayersByTeam(match.away_team_id) : Promise.resolve([]),
  ]);

  const teams = [match.home_team, match.away_team].filter((t): t is NonNullable<typeof t> => t != null);
  const { home_team, away_team, ...rawMatch } = match;

  return (
    <div className="space-y-6">
      {/* Scoreboard + tabs share one realtime subscription so score, minute,
          timeline, stats, commentary, odds and gamecast all update live. */}
      <MatchLive
        initialMatch={rawMatch}
        teams={teams}
        initialLineups={lineups}
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
