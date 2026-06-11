import { getMatchesWithTeams } from '@/lib/supabase/queries';
import { ScheduleList } from '@/components/schedule-list';

export const dynamic = 'force-dynamic';

export default async function SchedulePage() {
  const { matches, teams } = await getMatchesWithTeams();
  // Stable order: dated fixtures chronologically, undated ones by match number.
  const sorted = [...matches].sort((a, b) => {
    if (a.kickoff_utc && b.kickoff_utc)
      return new Date(a.kickoff_utc).getTime() - new Date(b.kickoff_utc).getTime();
    if (a.kickoff_utc) return -1;
    if (b.kickoff_utc) return 1;
    return (a.match_number ?? 0) - (b.match_number ?? 0);
  });
  return <ScheduleList matches={sorted} teams={teams} />;
}
