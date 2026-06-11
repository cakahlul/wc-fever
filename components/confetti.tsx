'use client';

import { useMemo } from 'react';
import { motion } from 'framer-motion';

const COLORS = ['#e8b541', '#ffd166', '#3c6ff0', '#e0413e', '#1f9d55', '#dce6f5'];

/** Lightweight confetti burst (pure framer-motion, no canvas dependency). */
export function ConfettiBurst({ seed }: { seed: number }) {
  const pieces = useMemo(
    () =>
      Array.from({ length: 60 }, (_, i) => ({
        x: ((i * 137 + seed) % 100) - 50,
        delay: (i % 10) * 0.04,
        color: COLORS[i % COLORS.length],
        rotate: (i * 67) % 360,
        size: 5 + (i % 4) * 2,
      })),
    [seed]
  );

  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      {pieces.map((p, i) => (
        <motion.span
          key={`${seed}-${i}`}
          className="absolute left-1/2 top-1/3 rounded-sm"
          style={{ width: p.size, height: p.size * 0.6, backgroundColor: p.color }}
          initial={{ x: 0, y: 0, opacity: 1, rotate: 0 }}
          animate={{
            x: p.x * 6,
            y: [0, -120 - (i % 5) * 30, 260],
            opacity: [1, 1, 0],
            rotate: p.rotate * 3,
          }}
          transition={{ duration: 2 + (i % 5) * 0.2, delay: p.delay, ease: 'easeOut' }}
        />
      ))}
    </div>
  );
}
