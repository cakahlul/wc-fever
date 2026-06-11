import { notFound } from 'next/navigation';
import { getPlayersByTeam, getTeams } from '@/lib/supabase/queries';
import { EmptyState } from '@/components/skeleton';

export const dynamic = 'force-dynamic';

const POSITION_LABEL: Record<string, string> = {
  GK: 'Goalkeepers',
  DF: 'Defenders',
  MF: 'Midfielders',
  FW: 'Forwards',
};

export default async function TeamPage({ params }: { params: { code: string } }) {
  const teams = await getTeams();
  const team = teams.find((t) => t.code.toLowerCase() === params.code.toLowerCase());
  if (!team) notFound();
  const players = await getPlayersByTeam(team.id);

  return (
    <div className="space-y-6">
      <header className="flex items-center gap-4">
        <span aria-hidden className="text-5xl">{team.flag_emoji}</span>
        <div>
          <h1 className="font-display text-2xl font-bold">{team.name}</h1>
          <p className="text-sm text-mist">
            Group {team.group} · FIFA rank ~{team.fifa_rank}
          </p>
        </div>
      </header>

      {players.length === 0 ? (
        <EmptyState
          title="Squad not loaded yet"
          hint="The bootstrap crawl seeds 26-man squads — run npm run crawl:bootstrap."
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {(['GK', 'DF', 'MF', 'FW'] as const).map((pos) => {
            const group = players.filter((p) => p.position === pos);
            if (group.length === 0) return null;
            return (
              <section key={pos} aria-labelledby={`pos-${pos}`} className="rounded-xl border border-night-50/60 bg-night-200 p-4">
                <h2 id={`pos-${pos}`} className="mb-2 text-xs uppercase tracking-widest text-gold-bright">
                  {POSITION_LABEL[pos]}
                </h2>
                <ul className="space-y-1.5">
                  {group.map((p) => (
                    <li key={p.id} className="flex items-baseline gap-3 text-sm">
                      <span className="w-6 text-right font-display font-bold text-gold-bright tabular-nums">
                        {p.shirt_number}
                      </span>
                      <span className="font-medium">
                        {p.name}
                        {p.is_captain && (
                          <span className="ml-1.5 rounded bg-gold/15 px-1 text-[10px] font-bold uppercase text-gold-bright" title="Captain">
                            C
                          </span>
                        )}
                      </span>
                      {p.club && <span className="text-xs text-mist">{p.club}</span>}
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
