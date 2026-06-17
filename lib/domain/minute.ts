/**
 * Render a live match clock as "45+4'" when stoppage time is in play, else
 * "45'". Returns null when no minute is known so callers can fall back to
 * a generic "LIVE" label.
 *
 * Also defensively splits legacy/corrupt single-integer encodings produced by
 * an earlier parser that concatenated base + stoppage (e.g. 45'+4' → 454,
 * 90'+12' → 9012). Stoppage happens at the end of each scheduled period, so
 * any value with a prefix in {45, 90, 105, 120} and at least one trailing
 * digit is treated as base + extra.
 */
const STOPPAGE_BASES = [120, 105, 90, 45];

export function formatMatchMinute(
  minute: number | null | undefined,
  stoppage: number | null | undefined
): string | null {
  if (minute == null) return null;
  if (stoppage != null && stoppage > 0) return `${minute}+${stoppage}'`;
  const split = splitCorruptMinute(minute);
  if (split) return `${split.base}+${split.stoppage}'`;
  return `${minute}'`;
}

function splitCorruptMinute(n: number): { base: number; stoppage: number } | null {
  const s = String(n);
  for (const base of STOPPAGE_BASES) {
    const bs = String(base);
    if (s.startsWith(bs) && s.length > bs.length) {
      const stoppage = Number(s.slice(bs.length));
      if (Number.isFinite(stoppage) && stoppage > 0) return { base, stoppage };
    }
  }
  return null;
}
