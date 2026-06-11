-- =====================================================================
-- World Cup Fever 2026 — Supabase schema
-- Run in Supabase SQL editor (or via migration). Postgres 15+.
-- =====================================================================

create extension if not exists "pgcrypto";

-- ---------- enums ----------
do $$ begin
  create type match_stage as enum ('group','r32','r16','qf','sf','third_place','final');
exception when duplicate_object then null; end $$;

do $$ begin
  create type match_status as enum ('scheduled','live','finished');
exception when duplicate_object then null; end $$;

-- ---------- teams ----------
create table if not exists teams (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  code        text not null unique,          -- ISO3-ish
  flag_emoji  text,
  "group"     char(1),                       -- A..L (null until known; all known now)
  fifa_rank   int,                           -- approximate seed value; refresh via crawl/API
  created_at  timestamptz not null default now()
);

-- ---------- matches ----------
create table if not exists matches (
  id            uuid primary key default gen_random_uuid(),
  match_number  int unique,                  -- 1..104
  stage         match_stage not null,
  "group"       char(1),                     -- only for group stage
  matchday      int,                          -- 1..3 for group stage
  kickoff_utc   timestamptz,                  -- filled by seed-crawl job
  venue         text,
  city          text,
  home_team_id  uuid references teams(id),
  away_team_id  uuid references teams(id),
  home_slot     text,                         -- knockout placeholder e.g. '1A','3rd-ABCD','W73'
  away_slot     text,
  status        match_status not null default 'scheduled',
  minute        int,
  home_score    int,
  away_score    int,
  events        jsonb not null default '[]',  -- goals/cards/subs
  updated_at    timestamptz not null default now()
);
create index if not exists idx_matches_stage   on matches(stage);
create index if not exists idx_matches_group    on matches("group");
create index if not exists idx_matches_kickoff  on matches(kickoff_utc);
create index if not exists idx_matches_status   on matches(status);

-- ---------- players (squads — locked per nation, seeded once via crawl) ----------
create table if not exists players (
  id            uuid primary key default gen_random_uuid(),
  team_id       uuid not null references teams(id) on delete cascade,
  name          text not null,
  shirt_number  int,
  position      text,                         -- GK / DF / MF / FW
  club          text,
  is_captain    boolean not null default false,
  created_at    timestamptz not null default now(),
  unique (team_id, shirt_number)
);
create index if not exists idx_players_team on players(team_id);

-- ---------- lineups (per match, crawled ~1h before kickoff) ----------
create table if not exists lineups (
  id            uuid primary key default gen_random_uuid(),
  match_id      uuid not null references matches(id) on delete cascade,
  team_id       uuid not null references teams(id),
  player_id     uuid references players(id),  -- nullable: late call-ups not yet in squad
  player_name   text not null,                -- denormalized snapshot
  shirt_number  int,
  position      text,                          -- grid/role for formation rendering
  role          text not null default 'starter', -- 'starter' | 'sub'
  is_captain    boolean not null default false,
  formation     text,                          -- e.g. '4-3-3' (same value across the XI)
  updated_at    timestamptz not null default now(),
  unique (match_id, team_id, player_name)
);
create index if not exists idx_lineups_match on lineups(match_id);

-- ---------- match reviews (LLM output cache) ----------
create table if not exists match_reviews (
  match_id      uuid primary key references matches(id) on delete cascade,
  language      text not null default 'id',
  body          text not null,
  generated_at  timestamptz not null default now()
);

-- ---------- simulations (per user) ----------
create table if not exists simulations (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid,                     -- auth.uid() or anon session id
  name              text not null,
  picks             jsonb not null default '{}',   -- { "73": "<team_id>", ... }
  champion_team_id  uuid references teams(id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists idx_sim_user on simulations(user_id);

-- ---------- updated_at trigger ----------
create or replace function touch_updated_at() returns trigger as $$
begin new.updated_at = now(); return new; end $$ language plpgsql;

drop trigger if exists trg_matches_touch on matches;
create trigger trg_matches_touch before update on matches
  for each row execute function touch_updated_at();

drop trigger if exists trg_sim_touch on simulations;
create trigger trg_sim_touch before update on simulations
  for each row execute function touch_updated_at();

drop trigger if exists trg_lineups_touch on lineups;
create trigger trg_lineups_touch before update on lineups
  for each row execute function touch_updated_at();

-- ---------- standings view ----------
-- Base ordering by points -> GD -> GF. Head-to-head, fair-play and FIFA-rank
-- tiebreakers are applied in the app/domain layer (they need subset recomputation
-- that's awkward in a single view). Third-place ranking exposed in v_third_place.
create or replace view v_standings as
with played as (
  select home_team_id as team_id, "group",
         home_score gf, away_score ga,
         case when home_score>away_score then 3 when home_score=away_score then 1 else 0 end pts
  from matches where stage='group' and status='finished'
  union all
  select away_team_id, "group",
         away_score, home_score,
         case when away_score>home_score then 3 when away_score=home_score then 1 else 0 end
  from matches where stage='group' and status='finished'
)
select
  t.id as team_id, t.name, t.code, t.flag_emoji, t."group",
  count(p.team_id)                              as played,
  count(*) filter (where p.pts=3)               as won,
  count(*) filter (where p.pts=1)               as drawn,
  count(*) filter (where p.pts=0)               as lost,
  coalesce(sum(p.gf),0)                         as gf,
  coalesce(sum(p.ga),0)                         as ga,
  coalesce(sum(p.gf-p.ga),0)                    as gd,
  coalesce(sum(p.pts),0)                        as points,
  rank() over (
    partition by t."group"
    order by coalesce(sum(p.pts),0) desc,
             coalesce(sum(p.gf-p.ga),0) desc,
             coalesce(sum(p.gf),0) desc
  ) as group_rank
from teams t
left join played p on p.team_id = t.id
where t."group" is not null
group by t.id;

-- third-place teams ranked across all groups (for the 8 best -> R32)
create or replace view v_third_place as
select *, rank() over (order by points desc, gd desc, gf desc) as overall_rank
from v_standings where group_rank = 3;

-- ---------- Row Level Security ----------
alter table teams         enable row level security;
alter table matches       enable row level security;
alter table match_reviews enable row level security;
alter table simulations   enable row level security;
alter table players       enable row level security;
alter table lineups       enable row level security;

-- public read for tournament data
create policy "public read teams"    on teams         for select using (true);
create policy "public read matches"  on matches       for select using (true);
create policy "public read reviews"  on match_reviews for select using (true);
create policy "public read players"  on players       for select using (true);
create policy "public read lineups"  on lineups       for select using (true);

-- writes to tournament data are server-only (service role bypasses RLS).
-- users manage only their own simulations:
create policy "own sims select" on simulations for select using (auth.uid() = user_id);
create policy "own sims insert" on simulations for insert with check (auth.uid() = user_id);
create policy "own sims update" on simulations for update using (auth.uid() = user_id);
create policy "own sims delete" on simulations for delete using (auth.uid() = user_id);
