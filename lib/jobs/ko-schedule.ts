/**
 * Deterministic parser for the Wikipedia "2026 FIFA World Cup knockout stage"
 * article's per-match detail section. Replaces LLM extraction here because the
 * detail boxes are a fixed, regular format and carry everything the bracket
 * needs — kickoff, result, and (crucially) the penalty-shootout winner, which
 * a level full-time score alone cannot express.
 *
 * Each detail block looks like:
 *
 *   June 29, 2026
 *   4:30 p.m. UTC−4
 *   Germany 	1–1 (a.e.t.)	 Paraguay
 *   ...
 *   Penalties
 *   ...
 *   3–4
 *   ...
 *
 * Finished blocks carry a "H–A" score in the middle; not-yet-played blocks
 * carry the fixture's own "Match <n>" there instead — so we key those by
 * match number and the finished ones by team pairing.
 */

export interface ParsedKoMatch {
  /** ISO-8601 UTC kickoff. */
  kickoff_utc: string;
  /** Home/away as printed; null when the cell is a "Winner Match N" placeholder. */
  homeName: string | null;
  awayName: string | null;
  /** Present for not-yet-played blocks (the fixture's own number); null when finished. */
  matchNumber: number | null;
  finished: boolean;
  homeScore: number | null;
  awayScore: number | null;
  homePens: number | null;
  awayPens: number | null;
}

export interface ThirdPlaceAllocation {
  /** Group letter of the group winner (the 'W-<G>' side of the R32 match). */
  winnerGroup: string;
  /** Group letter whose third-placed team takes the '3rd:' slot. */
  thirdGroup: string;
  /** Third-placed team's name as printed (resolve via matchTeam). */
  thirdTeamName: string;
}

/**
 * The R32 third-place matchups depend on which eight groups' thirds qualify —
 * one of 495 FIFA-published combinations. Rather than reproduce that table, we
 * read the article's explicit per-tournament statement, e.g.:
 *
 *   1E (Germany) vs 3D (Paraguay)
 *
 * which fixes the third-placed team of group D into the R32 match played by the
 * group E winner. Our own backtracking allocation only finds *a* valid matching,
 * not necessarily FIFA's, so this authoritative line is what we trust.
 */
export function parseThirdPlaceAllocation(text: string): ThirdPlaceAllocation[] {
  const re = /^1([A-L]) \(([^)]+)\) vs 3([A-L]) \(([^)]+)\)$/;
  const out: ThirdPlaceAllocation[] = [];
  for (const raw of text.split('\n')) {
    const m = raw.replace(/\s+/g, ' ').trim().match(re);
    if (m) out.push({ winnerGroup: m[1], thirdGroup: m[3], thirdTeamName: m[4] });
  }
  return out;
}

const MONTHS: Record<string, number> = {
  january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
  july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
};

const DATE_RE = /^([A-Z][a-z]+) (\d{1,2}), (\d{4})$/;
const TIME_RE = /^(\d{1,2}):(\d{2})\s*(a\.m\.|p\.m\.)\s*UTC\s*([+−-])\s*(\d{1,2})/;
// Score in the result line: "1–1 (a.e.t.)" or "0–1". Penalty line: "3–4".
const DASH = '[\\u2013\\u2014-]'; // en/em dash or hyphen
const PEN_RE = new RegExp(`^(\\d+)\\s*${DASH}\\s*(\\d+)$`);

/** Convert a clock + UTC offset into an ISO UTC timestamp. */
function toIsoUtc(
  year: number, month: number, day: number,
  hour12: number, minute: number, meridiem: string, sign: string, offsetHrs: number
): string {
  let h = hour12 % 12; // 12 a.m. -> 0, 12 p.m. -> 12 (after +12)
  if (meridiem === 'p.m.') h += 12;
  const offsetMs = (sign === '+' ? offsetHrs : -offsetHrs) * 3600_000;
  // Build the instant as if the clock were UTC, then subtract the offset to
  // get true UTC (local = UTC + offset  =>  UTC = local - offset).
  const ms = Date.UTC(year, month, day, h, minute) - offsetMs;
  return new Date(ms).toISOString();
}

export function parseKnockoutSchedule(text: string): ParsedKoMatch[] {
  const lines = text.split('\n').map((l) => l.replace(/\s+/g, ' ').trim());
  const out: ParsedKoMatch[] = [];

  for (let i = 0; i < lines.length; i++) {
    const dm = lines[i].match(DATE_RE);
    if (!dm) continue;
    const month = MONTHS[dm[1].toLowerCase()];
    if (month === undefined) continue;
    const day = parseInt(dm[2], 10);
    const year = parseInt(dm[3], 10);

    // next non-empty line must be a time line
    let j = i + 1;
    while (j < lines.length && lines[j] === '') j++;
    const tm = lines[j]?.match(TIME_RE);
    if (!tm) continue;
    const kickoff_utc = toIsoUtc(
      year, month, day,
      parseInt(tm[1], 10), parseInt(tm[2], 10), tm[3], tm[4], parseInt(tm[5], 10)
    );

    // next non-empty line is the result line
    let k = j + 1;
    while (k < lines.length && lines[k] === '') k++;
    const resultLine = lines[k];
    if (!resultLine) continue;

    // Mask "Winner/Loser Match N" placeholders so the only bare "Match N" left
    // is the fixture's own number; keep real team names intact.
    const masked = resultLine.replace(/(?:Winner|Loser) Match \d+/g, 'TBD');
    const scoreRe = new RegExp(`^(.+?)\\s+(\\d+)\\s*${DASH}\\s*(\\d+)(?:\\s*\\(a\\.e\\.t\\.\\))?\\s+(.+)$`);
    const numRe = /^(.+?)\s+Match (\d+)\s+(.+)$/;

    let parsed: ParsedKoMatch | null = null;
    const sc = masked.match(scoreRe);
    if (sc) {
      parsed = {
        kickoff_utc,
        homeName: sc[1] === 'TBD' ? null : sc[1],
        awayName: sc[4] === 'TBD' ? null : sc[4],
        matchNumber: null,
        finished: true,
        homeScore: parseInt(sc[2], 10),
        awayScore: parseInt(sc[3], 10),
        homePens: null,
        awayPens: null,
      };
      // Look for a penalty shootout score before the next date line.
      let p = k + 1;
      let sawPenalties = false;
      for (; p < lines.length && !DATE_RE.test(lines[p]); p++) {
        if (lines[p].toLowerCase() === 'penalties') sawPenalties = true;
        if (sawPenalties) {
          const pm = lines[p].match(PEN_RE);
          if (pm) {
            parsed.homePens = parseInt(pm[1], 10);
            parsed.awayPens = parseInt(pm[2], 10);
            break;
          }
        }
      }
    } else {
      const nm = masked.match(numRe);
      if (nm) {
        parsed = {
          kickoff_utc,
          homeName: nm[1] === 'TBD' ? null : nm[1],
          awayName: nm[3] === 'TBD' ? null : nm[3],
          matchNumber: parseInt(nm[2], 10),
          finished: false,
          homeScore: null,
          awayScore: null,
          homePens: null,
          awayPens: null,
        };
      }
    }

    if (parsed) {
      out.push(parsed);
      i = k; // continue scanning after this block's result line
    }
  }

  return out;
}
