import { getMatchesWithTeams } from '@/lib/supabase/queries';
import {
  allGroupsComplete,
  computeAllStandings,
  computeGroupClinch,
  rankThirdPlaceTeams,
  GROUPS,
} from '@/lib/domain/standings';
import { StandingsTables } from '@/components/standings-tables';
import { EmptyState } from '@/components/skeleton';

export const dynamic = 'force-dynamic';

export default async function StandingsPage() {
  const { matches, teams } = await getMatchesWithTeams();
  if (teams.length === 0) {
    return (
      <EmptyState
        title="No standings yet"
        hint="Apply supabase/schema.sql and seed.sql to your Supabase project first."
      />
    );
  }
  // Full FIFA tiebreaker ladder lives in the domain layer (not the SQL view).
  const standings = computeAllStandings(teams, matches);
  // Clinch status is mathematical (brute-forces remaining group fixtures), so a
  // team is only marked Q / OUT once it's truly locked or eliminated.
  const groups = GROUPS.map((g) => ({
    group: g,
    rows: standings.get(g) ?? [],
    clinch: computeGroupClinch(g, teams, matches),
  }));
  const thirds = rankThirdPlaceTeams(standings);
  return (
    <StandingsTables
      groups={groups}
      thirds={thirds}
      allComplete={allGroupsComplete(matches)}
    />
  );
}
