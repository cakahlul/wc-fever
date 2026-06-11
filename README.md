# ⚽ World Cup Fever 2026

A vibrant, interactive companion app for the **FIFA World Cup 2026** (USA · Canada · Mexico, June 11 – July 19, 2026): live scores, full schedule, standings with real FIFA tiebreakers, knockout bracket, squads & lineups, AI match reviews, and a tournament simulator.

## Architecture

**Supabase is the single source of truth.** The browser only reads/writes Supabase — it never calls an LLM or crawler directly. All crawling and AI work runs server-side and writes to the DB.

```
[Playwright crawler] -> [extract & clean text] -> [LLM parse/write] -> [Supabase] --(realtime)--> [Next.js UI]
                                                                            ^
                                                [API-Football fallback] ----+
```

| Data | Source |
| --- | --- |
| 104-match schedule | Seeded once (`supabase/seed.sql`); kickoff times backfilled by the bootstrap crawl |
| Live scores + knockout resolution | Playwright crawl → `cleanForLLM` → LLM JSON extraction → Supabase upsert; API-Football fallback |
| Reviews + hype blurbs | LLM (`generateProse`), generated once per match, cached in `match_reviews` |

## Setup

### 1. Database

In the Supabase SQL editor, run **`supabase/schema.sql`** then **`supabase/seed.sql`** (both idempotent). Then in the dashboard:

- **Database → Replication**: enable Realtime publication on the `matches` table.
- **Authentication → Providers**: enable **Anonymous sign-ins**.

### 2. Environment

```bash
cp .env.example .env.local   # fill in every key
```

| Key | Purpose |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Browser + server reads (RLS) |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only writes (crawl jobs) |
| `LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL` | Any OpenAI-compatible endpoint |
| `CRON_SECRET` | Shared secret guarding `/api/crawl/*` |
| `API_FOOTBALL_KEY` | Optional fallback when Playwright fails |
| `APP_BASE_URL` | Used by `scripts/ticker.ts` and `crawl:bootstrap` |

### 3. Run

```bash
npm install
npx playwright install chromium   # crawler browser (server-side only)
npm run dev                       # app is fully usable with just the seed data
```

### 4. Crawl jobs (user's VPS, PM2 already running)

```bash
npm run crawl:bootstrap                          # once: kickoff times, squads, reviews
pm2 start "npm run ticker" --name wc-live-ticker # 30s live tick (gated; cheap when idle)
# crontab — 12h reconcile sweep:
0 */12 * * * curl -fsS -X POST https://<app>/api/crawl/reconcile -H "x-cron-secret: $CRON_SECRET"
```

The live tick is **gated**: it queries the DB first and exits immediately (no Playwright, no LLM) unless a match is live or kicking off within 5 minutes.

## Code map

```
lib/supabase/   typed clients (server = service role, client = anon) + queries
lib/domain/     standings (full FIFA tiebreakers), third-place ranking,
                bracket slot resolution, seeded simulator, big-match rules
lib/crawl/      Playwright adapter (primary), API-Football adapter (fallback),
                cleanForLLM (mandatory pre-LLM text hygiene, 3000-char cap)
lib/llm/        extractJSON (JSON mode) + generateProse, prompts
lib/jobs/       bootstrap / live / reconcile job logic
app/api/crawl/  POST routes wrapping the jobs, guarded by x-cron-secret
scripts/        ticker.ts (PM2 entry), crawl-bootstrap.ts
supabase/       schema.sql + seed.sql
```

Notable domain logic (commented in code):

- **Head-to-head tiebreakers** (`lib/domain/standings.ts`): the SQL view sorts points→GD→GF; criteria 4–8 (H2H mini-table, fair play, lots→fifa_rank) need subset recomputation and live in the domain layer.
- **Third-place allocation** (`lib/domain/bracket.ts`): backtracking perfect matching of the 8 best thirds onto the 8 R32 slots' allowed-group lists.
- **Seeded simulation** (`lib/domain/simulation.ts`): mulberry32 RNG + Elo-style win probability over `fifa_rank`; same seed → same tournament.

## Features

Home (3D trophy hero, countdown, big-match spotlight) · Live (Supabase Realtime, no polling) · Schedule (local-timezone, filters, today-jump) · Standings (12 groups + best-thirds table) · Bracket (zoomable R32→Final) · Match detail (formation pitch lineups, AI review) · Simulator (manual or seeded auto-sim, confetti champion) · Saved (per anonymous user, RLS owner-only).
