import { Suspense } from 'react';
import { getMatchesWithTeams } from '@/lib/supabase/queries';
import { SimulatorClient } from '@/components/simulator-client';
import { EmptyState, MatchCardSkeleton } from '@/components/skeleton';

export const dynamic = 'force-dynamic';

export default async function SimulatorPage() {
  const { matches, teams } = await getMatchesWithTeams();
  if (teams.length === 0) {
    return (
      <EmptyState
        title="Simulator needs seed data"
        hint="Apply supabase/schema.sql and seed.sql to your Supabase project first."
      />
    );
  }
  const rawMatches = matches.map(({ home_team, away_team, ...m }) => m);
  return (
    <Suspense fallback={<MatchCardSkeleton />}>
      <SimulatorClient teams={teams} matches={rawMatches} />
    </Suspense>
  );
}
