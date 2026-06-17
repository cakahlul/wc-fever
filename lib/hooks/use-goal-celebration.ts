'use client';

import { useEffect, useRef, useState } from 'react';
import type { MatchWithTeams, Team } from '@/lib/supabase/types';

export interface GoalCelebration {
  /** Unique per goal — drives remount of the overlay so it replays. */
  key: number;
  team: 'home' | 'away';
  scorer: Team | null;
  matchId: string;
}

const CLEAR_MS = 4_500;

/**
 * Fires a celebration whenever a live match's scoreline ticks up. Seeds a
 * per-match baseline on first observation (so loading into an in-progress 2-1
 * never triggers), then watches for an increase on either side and reports the
 * scoring team. Pass a single match (`[match]`) for a scoped overlay or the
 * full live set for a section-level one.
 */
export function useGoalCelebration(matches: MatchWithTeams[]): GoalCelebration | null {
  const matchesRef = useRef(matches);
  matchesRef.current = matches;
  const baseline = useRef(new Map<string, { home: number; away: number }>());
  const [celebration, setCelebration] = useState<GoalCelebration | null>(null);

  const sig = matches
    .map((m) => `${m.id}:${m.status}:${m.home_score ?? 0}:${m.away_score ?? 0}`)
    .join('|');

  useEffect(() => {
    const seen = baseline.current;
    let found: GoalCelebration | null = null;
    for (const m of matchesRef.current) {
      if (m.status !== 'live') {
        seen.delete(m.id);
        continue;
      }
      const home = m.home_score ?? 0;
      const away = m.away_score ?? 0;
      const base = seen.get(m.id);
      seen.set(m.id, { home, away });
      if (!base) continue;
      if (home > base.home) found = { key: Date.now(), team: 'home', scorer: m.home_team, matchId: m.id };
      else if (away > base.away) found = { key: Date.now(), team: 'away', scorer: m.away_team, matchId: m.id };
    }
    if (found) setCelebration(found);
  }, [sig]);

  useEffect(() => {
    if (!celebration) return;
    const t = setTimeout(() => setCelebration(null), CLEAR_MS);
    return () => clearTimeout(t);
  }, [celebration]);

  return celebration;
}
