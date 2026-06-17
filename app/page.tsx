import Link from 'next/link';
import { getMatchesWithTeams, getReviews } from '@/lib/supabase/queries';
import { isBigMatch } from '@/lib/domain/big-match';
import { Hero3D } from '@/components/hero-3d';
import { Countdown } from '@/components/countdown';
import { MatchCard } from '@/components/match-card';
import { EmptyState } from '@/components/skeleton';

export const dynamic = 'force-dynamic';

const QUICK_NAV = [
  { href: '/live', label: 'Live', emoji: '🔴', desc: 'Scores as they happen' },
  { href: '/schedule', label: 'Fixtures & Results', emoji: '🗓️', desc: 'All 104 matches' },
  { href: '/standings', label: 'Standings', emoji: '📊', desc: '12 groups + best thirds' },
  { href: '/bracket', label: 'Bracket', emoji: '🏆', desc: 'Road to the final' },
  { href: '/simulator', label: 'Simulator', emoji: '🎮', desc: 'Pick your champion' },
];

export default async function HomePage() {
  const { matches } = await getMatchesWithTeams();
  const now = Date.now();

  const upcoming = matches
    .filter((m) => m.status === 'scheduled' && m.kickoff_utc && new Date(m.kickoff_utc).getTime() > now)
    .sort((a, b) => new Date(a.kickoff_utc!).getTime() - new Date(b.kickoff_utc!).getTime());
  const nextUp = upcoming[0] ?? null;
  const liveNow = matches.filter((m) => m.status === 'live');

  // Pinned big matches: live big matches first, then the next few upcoming ones.
  const bigUpcoming = upcoming
    .filter((m) => isBigMatch(m, m.home_team, m.away_team).isBig)
    .slice(0, 3);
  const pinned = [
    ...liveNow.filter((m) => isBigMatch(m, m.home_team, m.away_team).isBig),
    ...bigUpcoming,
  ].slice(0, 3);
  const reviews = await getReviews(pinned.map((m) => m.id));
  const blurbByMatch = new Map(reviews.map((r) => [r.match_id, r.body]));

  return (
    <div className="space-y-10">
      {/* Hero */}
      <section className="relative overflow-hidden rounded-2xl border border-night-50/60 bg-night-200/80">
        <div className="grid items-center gap-6 p-6 md:grid-cols-2 md:p-10">
          <div className="space-y-5">
            <h1 className="font-display text-4xl font-extrabold leading-tight md:text-5xl">
              World Cup <span className="text-gold-bright">Fever</span>
              <br />
              <span className="bg-gradient-to-r from-hostUsa via-ice to-hostCan bg-clip-text text-transparent">
                2026
              </span>
            </h1>
            <p className="max-w-md text-mist">
              48 teams. 16 cities. Three host nations{' '}
              <span aria-hidden>🇺🇸 🇨🇦 🇲🇽</span> — every score, table and bracket
              twist, live.
            </p>
            {liveNow.length > 0 ? (
              <p className="flex items-center gap-2 font-display text-lg font-bold text-live">
                <span aria-hidden className="h-2.5 w-2.5 rounded-full bg-live animate-live-pulse" />
                {liveNow.length} match{liveNow.length > 1 ? 'es' : ''} live now —{' '}
                <Link href="/live" className="underline">
                  watch the ticker
                </Link>
              </p>
            ) : nextUp?.kickoff_utc ? (
              <Countdown
                to={nextUp.kickoff_utc}
                label={`Next up: ${nextUp.home_team?.name ?? 'TBD'} vs ${nextUp.away_team?.name ?? 'TBD'}`}
              />
            ) : null}
          </div>
          <Hero3D />
        </div>
      </section>

      {/* Live now — front and center so it pulls focus */}
      {liveNow.length > 0 && (
        <section aria-labelledby="live-now">
          <h2 id="live-now" className="mb-3 flex items-center gap-2 font-display text-xl font-bold">
            <span aria-hidden className="h-2.5 w-2.5 rounded-full bg-live animate-live-pulse" />
            Live now
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {liveNow.map((m) => (
              <MatchCard key={m.id} match={m} />
            ))}
          </div>
        </section>
      )}

      {/* Next fixtures */}
      <section aria-labelledby="next-fixtures">
        <h2 id="next-fixtures" className="mb-3 font-display text-xl font-bold">
          Coming up
        </h2>
        {upcoming.length > 0 ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {upcoming.slice(0, 6).map((m) => (
              <MatchCard key={m.id} match={m} />
            ))}
          </div>
        ) : liveNow.length > 0 ? (
          <p className="rounded-xl border border-night-50/60 bg-night-200 p-4 text-sm text-mist">
            Nothing scheduled next — all the action is live above.
          </p>
        ) : (
          <EmptyState
            title="No fixtures loaded yet"
            hint="Run supabase/schema.sql + seed.sql, then npm run crawl:bootstrap to fill kickoff times."
          />
        )}
      </section>

      {/* Pinned big matches */}
      {pinned.length > 0 && (
        <section aria-labelledby="big-matches">
          <h2 id="big-matches" className="mb-3 font-display text-xl font-bold">
            ⚡ Big match spotlight
          </h2>
          <div className="grid gap-3 md:grid-cols-3">
            {pinned.map((m) => (
              <div key={m.id} className="space-y-2">
                <MatchCard match={m} />
                {blurbByMatch.get(m.id) && (
                  <p className="px-1 text-sm italic leading-relaxed text-gold-bright/90">
                    “{blurbByMatch.get(m.id)}”
                  </p>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Quick nav */}
      <section aria-label="Quick navigation" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {QUICK_NAV.map((q) => (
          <Link
            key={q.href}
            href={q.href}
            className="rounded-xl border border-night-50/60 bg-night-200 p-4 transition-colors hover:border-gold/50 hover:bg-night-100"
          >
            <div aria-hidden className="mb-1 text-2xl">{q.emoji}</div>
            <div className="font-display font-bold">{q.label}</div>
            <div className="text-xs text-mist">{q.desc}</div>
          </Link>
        ))}
      </section>
    </div>
  );
}
