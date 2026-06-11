import type { LineupEntry } from '@/lib/supabase/types';

/**
 * Starting XI on a formation pitch. Rows are derived from the formation
 * string ('4-3-3' → GK + lines of 4/3/3); players fill lines in GK→DF→MF→FW
 * order, falling back to position groups when the formation is missing.
 */

function lineUpRows(starters: LineupEntry[], formation: string | null): LineupEntry[][] {
  const order = { GK: 0, DF: 1, MF: 2, FW: 3 } as Record<string, number>;
  const sorted = [...starters].sort(
    (a, b) =>
      (order[a.position ?? ''] ?? 9) - (order[b.position ?? ''] ?? 9) ||
      (a.shirt_number ?? 99) - (b.shirt_number ?? 99)
  );
  const gk = sorted.filter((p) => p.position === 'GK').slice(0, 1);
  const outfield = sorted.filter((p) => !gk.includes(p));

  const lineSizes = (formation ?? '')
    .split('-')
    .map((n) => parseInt(n, 10))
    .filter((n) => Number.isFinite(n) && n > 0);

  const rows: LineupEntry[][] = [gk];
  if (lineSizes.reduce((a, b) => a + b, 0) === outfield.length && lineSizes.length > 0) {
    let i = 0;
    for (const size of lineSizes) {
      rows.push(outfield.slice(i, i + size));
      i += size;
    }
  } else {
    // formation unknown/mismatched → group by position
    rows.push(
      outfield.filter((p) => p.position === 'DF'),
      outfield.filter((p) => p.position === 'MF'),
      outfield.filter((p) => p.position === 'FW' || !['DF', 'MF'].includes(p.position ?? ''))
    );
  }
  return rows.filter((r) => r.length > 0);
}

function PlayerDot({ p }: { p: LineupEntry }) {
  return (
    <div className="flex flex-col items-center gap-0.5 text-center">
      <div className="flex h-8 w-8 items-center justify-center rounded-full border border-ice/40 bg-night-300/90 font-display text-xs font-bold text-gold-bright">
        {p.shirt_number ?? '–'}
      </div>
      <span className="max-w-[5rem] truncate text-[10px] leading-tight text-ice">
        {p.player_name}
        {p.is_captain && <span className="ml-0.5 text-gold-bright" title="Captain">©</span>}
      </span>
    </div>
  );
}

export function FormationPitch({
  teamName,
  flag,
  entries,
}: {
  teamName: string;
  flag: string | null;
  entries: LineupEntry[];
}) {
  const starters = entries.filter((e) => e.role === 'starter');
  const subs = entries.filter((e) => e.role === 'sub');
  const formation = starters.find((e) => e.formation)?.formation ?? null;
  const rows = lineUpRows(starters, formation);

  return (
    <div>
      <h3 className="mb-2 flex items-center gap-2 font-display font-bold">
        <span aria-hidden>{flag}</span> {teamName}
        {formation && <span className="text-xs font-normal text-mist">({formation})</span>}
      </h3>
      <div className="relative overflow-hidden rounded-xl border border-pitch-line/40 bg-gradient-to-b from-pitch to-pitch-light p-3">
        {/* pitch markings */}
        <div aria-hidden className="pointer-events-none absolute inset-3 rounded-lg border border-ice/15" />
        <div aria-hidden className="pointer-events-none absolute left-1/2 top-3 h-10 w-28 -translate-x-1/2 rounded-b-lg border border-t-0 border-ice/15" />
        <div aria-hidden className="pointer-events-none absolute bottom-3 left-1/2 h-10 w-28 -translate-x-1/2 rounded-t-lg border border-b-0 border-ice/15" />
        <div aria-hidden className="pointer-events-none absolute left-1/2 top-1/2 h-16 w-16 -translate-x-1/2 -translate-y-1/2 rounded-full border border-ice/15" />

        <div className="relative flex min-h-[22rem] flex-col justify-between gap-3 py-2">
          {rows.map((row, i) => (
            <div key={i} className="flex items-center justify-evenly">
              {row.map((p) => (
                <PlayerDot key={p.id} p={p} />
              ))}
            </div>
          ))}
        </div>
      </div>
      {subs.length > 0 && (
        <div className="mt-2">
          <p className="mb-1 text-[10px] uppercase tracking-widest text-mist">Bench</p>
          <p className="text-xs leading-relaxed text-mist">
            {subs.map((s) => `${s.shirt_number ?? ''} ${s.player_name}`.trim()).join(' · ')}
          </p>
        </div>
      )}
    </div>
  );
}
