'use client';

import { useMemo } from 'react';
import { motion } from 'framer-motion';
import type { GoalCelebration } from '@/lib/hooks/use-goal-celebration';

/** Per-team banner glow, keyed on team code. Falls back to gold. */
const TEAM_ACCENT: Record<string, string> = {
  BRA: '#f7d000',
  ARG: '#75aadb',
  FRA: '#1f3a93',
  ENG: '#cf142b',
  ESP: '#c60b1e',
  GER: '#f0f0f0',
  POR: '#c8102e',
  NED: '#f36c21',
  ITA: '#0066b3',
  BEL: '#e30613',
  USA: '#3c3b6e',
  MEX: '#006847',
  CRO: '#ff0000',
  URU: '#5cbfeb',
};

const DEFAULT_ACCENT = '#e8b541';

export function GoalGimmick({
  celebration,
  variant,
}: {
  celebration: GoalCelebration;
  variant: 'card' | 'section' | 'page';
}) {
  const team = celebration.scorer;
  const flag = team?.flag_emoji ?? '⚽';
  const name = team?.name ?? 'GOAL';
  const accent = (team?.code ? TEAM_ACCENT[team.code] : undefined) ?? DEFAULT_ACCENT;
  const big = variant !== 'card';

  const flags = useMemo(() => {
    const count = variant === 'card' ? 14 : 30;
    const baseSize = variant === 'card' ? 14 : 26;
    return Array.from({ length: count }, (_, i) => ({
      left: (i * 53 + celebration.key) % 100,
      delay: (i % 8) * 0.07,
      dur: 1.8 + (i % 5) * 0.25,
      size: baseSize + (i % 3) * 6,
    }));
  }, [celebration.key, variant]);

  const positionClass = variant === 'page' ? 'fixed inset-0 z-50' : 'absolute inset-0 z-30';

  return (
    <motion.div
      aria-hidden
      className={`${positionClass} pointer-events-none flex items-center justify-center overflow-hidden`}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3 }}
    >
      {flags.map((f, i) => (
        <motion.span
          key={i}
          className="absolute top-0 leading-none"
          style={{ left: `${f.left}%`, fontSize: f.size }}
          initial={{ y: '-12%', opacity: 0, rotate: -20 }}
          animate={{ y: '112%', opacity: [0, 1, 1, 0], rotate: 20 }}
          transition={{ duration: f.dur, delay: f.delay, ease: 'easeIn' }}
        >
          {flag}
        </motion.span>
      ))}

      <motion.div
        className="relative rounded-2xl px-5 py-3 text-center"
        style={{
          background: 'rgba(8,12,20,0.62)',
          border: `1px solid ${accent}`,
          boxShadow: `0 0 40px ${accent}99`,
        }}
        initial={{ scale: 0.4, opacity: 0 }}
        animate={{ scale: [0.4, 1.15, 1], opacity: 1 }}
        transition={{ duration: 0.55, ease: 'easeOut' }}
      >
        <p
          className={`font-display font-extrabold tracking-wider ${big ? 'text-5xl' : 'text-xl'}`}
          style={{ color: accent }}
        >
          GOAL!
        </p>
        <p
          className={`mt-1 flex items-center justify-center gap-2 font-bold text-ice ${
            big ? 'text-2xl' : 'text-sm'
          }`}
        >
          <span style={{ fontSize: big ? 34 : 18 }}>{flag}</span>
          {name}
        </p>
      </motion.div>
    </motion.div>
  );
}
