'use client';

import dynamic from 'next/dynamic';
import { Skeleton } from './skeleton';

/**
 * R3F must never run on the server — dynamic import with ssr:false, plus a
 * skeleton fallback so low-end devices / slow loads degrade gracefully.
 */
const TrophyScene = dynamic(() => import('./trophy-scene'), {
  ssr: false,
  loading: () => <Skeleton className="h-full w-full rounded-2xl" />,
});

export function Hero3D() {
  return (
    <div
      className="h-64 w-full md:h-80"
      role="img"
      aria-label="Interactive 3D World Cup 26 logo with the trophy — drag to rotate"
    >
      <TrophyScene />
    </div>
  );
}
