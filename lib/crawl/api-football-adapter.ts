import 'server-only';
import { cleanForLLM } from './clean';
import type { CrawlAdapter } from './types';

/**
 * FALLBACK crawl source: API-Football (api-sports.io). Only used when the
 * Playwright crawl throws. league=1 is the FIFA World Cup.
 *
 * The structured JSON is flattened to text lines so the downstream pipeline
 * (cleanForLLM → extractJSON) is identical to the Playwright path — one code
 * path, two interchangeable sources.
 */

const BASE_URL = 'https://v3.football.api-sports.io';

async function apiGet(path: string): Promise<any> {
  const key = process.env.API_FOOTBALL_KEY;
  if (!key) throw new Error('API_FOOTBALL_KEY not configured — fallback unavailable');
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { 'x-apisports-key': key },
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`API-Football ${path} -> HTTP ${res.status}`);
  return res.json();
}

export async function apifootballFetchLive(): Promise<string> {
  // Prefer the live endpoint; fall back to today's World Cup fixtures.
  let data = await apiGet('/fixtures?live=all&league=1&season=2026');
  if (!data?.response?.length) {
    data = await apiGet('/fixtures?league=1&season=2026');
  }
  const lines: string[] = [];
  for (const fx of data?.response ?? []) {
    const home = fx?.teams?.home?.name;
    const away = fx?.teams?.away?.name;
    if (!home || !away) continue;
    const status = fx?.fixture?.status?.short ?? '';
    const minute = fx?.fixture?.status?.elapsed ?? '';
    const hs = fx?.goals?.home ?? '';
    const as = fx?.goals?.away ?? '';
    lines.push(`${home} ${hs} - ${as} ${away} | status=${status} minute=${minute}`);
  }
  return cleanForLLM(lines.join('\n'));
}

export async function apifootballFetchStandings(): Promise<string> {
  const data = await apiGet('/standings?league=1&season=2026');
  return cleanForLLM(JSON.stringify(data?.response ?? []).slice(0, 4000));
}

export const apiFootballAdapter: CrawlAdapter = {
  name: 'api-football',
  fetchLiveText: apifootballFetchLive,
  // API-Football lineups need a fixture id we don't track; not supported here.
  fetchLineupText: async () => null,
};
