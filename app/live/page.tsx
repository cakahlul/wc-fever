import { getMatchesWithTeams } from '@/lib/supabase/queries';
import { LiveBoard } from '@/components/live-board';

export const dynamic = 'force-dynamic';

export default async function LivePage() {
  const { matches, teams } = await getMatchesWithTeams();
  // Strip the joined team objects — LiveBoard re-joins from the teams list so
  // realtime payloads (raw rows) and initial data share one shape.
  const rawMatches = matches.map(({ home_team, away_team, ...m }) => m);
  return <LiveBoard initialMatches={rawMatches} teams={teams} />;
}
