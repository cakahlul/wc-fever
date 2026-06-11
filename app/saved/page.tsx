import { getTeams } from '@/lib/supabase/queries';
import { SavedList } from '@/components/saved-list';

export const dynamic = 'force-dynamic';

export default async function SavedPage() {
  const teams = await getTeams();
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold">Saved brackets</h1>
        <p className="text-sm text-mist">
          Your simulations, tied to this browser&apos;s anonymous session.
        </p>
      </div>
      <SavedList teams={teams} />
    </div>
  );
}
