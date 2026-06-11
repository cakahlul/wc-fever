'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { MatchWithTeams, Team } from '@/lib/supabase/types';
import { MatchCard, STAGE_LABEL } from './match-card';
import { Countdown } from './countdown';
import { EmptyState } from './skeleton';

/**
 * Full 104-match calendar: grouped by local date, filterable by group, stage,
 * team, host country and venue. Kickoffs render in the viewer's timezone.
 */

const HOST_BY_CITY: Record<string, 'USA' | 'Canada' | 'Mexico'> = {
  'Los Angeles': 'USA', Boston: 'USA', Houston: 'USA', Dallas: 'USA',
  'New York New Jersey': 'USA', Atlanta: 'USA', Miami: 'USA', Seattle: 'USA',
  'San Francisco Bay Area': 'USA', Philadelphia: 'USA', 'Kansas City': 'USA',
  Toronto: 'Canada', Vancouver: 'Canada',
  Guadalajara: 'Mexico', 'Mexico City': 'Mexico', Monterrey: 'Mexico',
};

const GROUPS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'];
const STAGES = ['group', 'r32', 'r16', 'qf', 'sf', 'third_place', 'final'];

export function ScheduleList({
  matches,
  teams,
}: {
  matches: MatchWithTeams[];
  teams: Team[];
}) {
  const [group, setGroup] = useState('');
  const [stage, setStage] = useState('');
  const [teamId, setTeamId] = useState('');
  const [host, setHost] = useState('');
  const [venue, setVenue] = useState('');
  const todayRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const venues = useMemo(
    () => Array.from(new Set(matches.map((m) => m.venue).filter(Boolean))).sort() as string[],
    [matches]
  );

  const filtered = useMemo(
    () =>
      matches.filter((m) => {
        if (group && m.group !== group) return false;
        if (stage && m.stage !== stage) return false;
        if (teamId && m.home_team_id !== teamId && m.away_team_id !== teamId) return false;
        if (host && HOST_BY_CITY[m.city ?? ''] !== host) return false;
        if (venue && m.venue !== venue) return false;
        return true;
      }),
    [matches, group, stage, teamId, host, venue]
  );

  // Group by the viewer's LOCAL date (only after mount — server can't know it).
  const byDate = useMemo(() => {
    const map = new Map<string, MatchWithTeams[]>();
    const fmt = new Intl.DateTimeFormat(undefined, {
      weekday: 'long', month: 'long', day: 'numeric',
    });
    for (const m of filtered) {
      const key = m.kickoff_utc && mounted ? fmt.format(new Date(m.kickoff_utc)) : 'Date TBA';
      map.set(key, [...(map.get(key) ?? []), m]);
    }
    return map;
  }, [filtered, mounted]);

  const now = Date.now();
  const nextKickoff = matches
    .filter((m) => m.status === 'scheduled' && m.kickoff_utc && new Date(m.kickoff_utc).getTime() > now)
    .sort((a, b) => new Date(a.kickoff_utc!).getTime() - new Date(b.kickoff_utc!).getTime())[0];

  const todayKey =
    mounted
      ? new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' }).format(new Date())
      : null;

  const select =
    'rounded-lg border border-night-50 bg-night-100 px-2 py-1.5 text-sm text-ice focus:border-gold focus:outline-none';

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold">Schedule</h1>
          <p className="text-sm text-mist">
            {filtered.length} of {matches.length} matches · times shown in your timezone
          </p>
        </div>
        {nextKickoff?.kickoff_utc && (
          <Countdown to={nextKickoff.kickoff_utc} label="Next kickoff" />
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2" role="group" aria-label="Schedule filters">
        <select aria-label="Filter by group" className={select} value={group} onChange={(e) => setGroup(e.target.value)}>
          <option value="">All groups</option>
          {GROUPS.map((g) => <option key={g} value={g}>Group {g}</option>)}
        </select>
        <select aria-label="Filter by stage" className={select} value={stage} onChange={(e) => setStage(e.target.value)}>
          <option value="">All stages</option>
          {STAGES.map((s) => <option key={s} value={s}>{STAGE_LABEL[s]}</option>)}
        </select>
        <select aria-label="Filter by team" className={select} value={teamId} onChange={(e) => setTeamId(e.target.value)}>
          <option value="">All teams</option>
          {[...teams].sort((a, b) => a.name.localeCompare(b.name)).map((t) => (
            <option key={t.id} value={t.id}>{t.flag_emoji} {t.name}</option>
          ))}
        </select>
        <select aria-label="Filter by host country" className={select} value={host} onChange={(e) => setHost(e.target.value)}>
          <option value="">All hosts</option>
          <option value="USA">🇺🇸 USA</option>
          <option value="Canada">🇨🇦 Canada</option>
          <option value="Mexico">🇲🇽 Mexico</option>
        </select>
        <select aria-label="Filter by venue" className={select} value={venue} onChange={(e) => setVenue(e.target.value)}>
          <option value="">All venues</option>
          {venues.map((v) => <option key={v} value={v}>{v}</option>)}
        </select>
        {todayKey && byDate.has(todayKey) && (
          <button
            type="button"
            onClick={() => todayRef.current?.scrollIntoView({ behavior: 'smooth' })}
            className="rounded-lg border border-gold/50 bg-gold/10 px-3 py-1.5 text-sm font-bold text-gold-bright"
          >
            Jump to today
          </button>
        )}
      </div>

      {/* Calendar */}
      {filtered.length === 0 ? (
        <EmptyState title="No matches found" hint="Try clearing a filter — or run the bootstrap job to load the schedule." />
      ) : (
        Array.from(byDate.entries()).map(([date, dayMatches]) => (
          <section
            key={date}
            ref={date === todayKey ? todayRef : undefined}
            aria-label={date}
            className="scroll-mt-20"
          >
            <h2 className="mb-3 flex items-center gap-2 font-display text-lg font-bold">
              {date}
              {date === todayKey && (
                <span className="rounded-full bg-gold/15 px-2 py-0.5 text-[10px] uppercase tracking-widest text-gold-bright">
                  Today
                </span>
              )}
            </h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {dayMatches.map((m) => <MatchCard key={m.id} match={m} />)}
            </div>
          </section>
        ))
      )}
    </div>
  );
}
