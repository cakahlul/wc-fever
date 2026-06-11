'use client';

import { useEffect, useState } from 'react';

/**
 * Renders a UTC kickoff in the viewer's local timezone. Server renders a UTC
 * placeholder; the client swaps in local time after hydration (avoids a
 * server/client timezone mismatch warning).
 */
export function LocalTime({
  utc,
  withDate = false,
}: {
  utc: string | null;
  withDate?: boolean;
}) {
  const [text, setText] = useState<string | null>(null);

  useEffect(() => {
    if (!utc) return;
    const d = new Date(utc);
    const fmt = new Intl.DateTimeFormat(undefined, {
      ...(withDate ? { weekday: 'short', month: 'short', day: 'numeric' } : {}),
      hour: '2-digit',
      minute: '2-digit',
    });
    setText(fmt.format(d));
  }, [utc, withDate]);

  if (!utc) return <span className="text-mist">TBA</span>;
  return <time dateTime={utc}>{text ?? '…'}</time>;
}
