import { getMatchesWithTeams } from '@/lib/supabase/queries';
import { buildBracketContext, resolveSlot, slotLabel } from '@/lib/domain/bracket';
import { BracketView, type BracketNode, type BracketRound } from '@/components/bracket-view';
import { EmptyState } from '@/components/skeleton';
import type { MatchWithTeams, Team } from '@/lib/supabase/types';

export const dynamic = 'force-dynamic';

const ROUND_TITLES: Array<{ stage: string; title: string }> = [
  { stage: 'r32', title: 'Round of 32' },
  { stage: 'r16', title: 'Round of 16' },
  { stage: 'qf', title: 'Quarter-finals' },
  { stage: 'sf', title: 'Semi-finals' },
  { stage: 'final', title: 'Final' },
];

export default async function BracketPage() {
  const { matches, teams } = await getMatchesWithTeams();
  if (matches.length === 0) {
    return (
      <EmptyState
        title="Bracket not loaded"
        hint="Apply supabase/schema.sql and seed.sql to your Supabase project first."
      />
    );
  }

  // Resolve every slot we can from real results; otherwise keep the label.
  const ctx = buildBracketContext(teams, matches);
  const toNode = (m: MatchWithTeams): BracketNode => {
    const home: Team | null = m.home_team ?? resolveSlot(m.home_slot, ctx);
    const away: Team | null = m.away_team ?? resolveSlot(m.away_slot, ctx);
    return {
      id: m.id,
      matchNumber: m.match_number,
      status: m.status,
      homeScore: m.home_score,
      awayScore: m.away_score,
      home: home ? { name: home.name, flag: home.flag_emoji } : null,
      away: away ? { name: away.name, flag: away.flag_emoji } : null,
      homeLabel: slotLabel(m.home_slot),
      awayLabel: slotLabel(m.away_slot),
      venue: m.venue,
      city: m.city,
    };
  };

  const rounds: BracketRound[] = ROUND_TITLES.map(({ stage, title }) => ({
    title,
    nodes: matches
      .filter((m) => m.stage === stage)
      .sort((a, b) => (a.match_number ?? 0) - (b.match_number ?? 0))
      .map(toNode),
  }));
  const thirdPlaceMatch = matches.find((m) => m.stage === 'third_place');

  return (
    <BracketView rounds={rounds} thirdPlace={thirdPlaceMatch ? toNode(thirdPlaceMatch) : null} />
  );
}
