'use client';

import { useEffect, useState } from 'react';

function parts(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return {
    d: Math.floor(s / 86400),
    h: Math.floor((s % 86400) / 3600),
    m: Math.floor((s % 3600) / 60),
    s: s % 60,
  };
}

export function Countdown({ to, label }: { to: string; label?: string }) {
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  if (now === null) {
    return <div className="h-12" aria-hidden />;
  }
  const remaining = new Date(to).getTime() - now;
  if (remaining <= 0) {
    return <p className="font-display text-xl font-bold text-live">Kicking off!</p>;
  }
  const { d, h, m, s } = parts(remaining);

  return (
    <div role="timer" aria-label={label ?? 'Countdown to kickoff'}>
      {label && <p className="mb-1 text-xs uppercase tracking-widest text-mist">{label}</p>}
      <div className="flex gap-3 font-display">
        {[
          [d, 'days'],
          [h, 'hrs'],
          [m, 'min'],
          [s, 'sec'],
        ].map(([value, unit]) => (
          <div key={unit} className="text-center">
            <div className="min-w-[2.5rem] rounded-lg bg-night-100 px-2 py-1 text-2xl font-bold tabular-nums text-gold-bright">
              {String(value).padStart(2, '0')}
            </div>
            <div className="mt-1 text-[10px] uppercase tracking-wider text-mist">{unit}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
