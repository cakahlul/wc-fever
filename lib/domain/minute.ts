/**
 * Render a live match clock as "45+4'" when stoppage time is in play, else
 * "45'". Returns null when no minute is known so callers can fall back to
 * a generic "LIVE" label.
 */
export function formatMatchMinute(
  minute: number | null | undefined,
  stoppage: number | null | undefined
): string | null {
  if (minute == null) return null;
  if (stoppage != null && stoppage > 0) return `${minute}+${stoppage}'`;
  return `${minute}'`;
}
