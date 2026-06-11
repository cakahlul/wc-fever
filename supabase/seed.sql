-- =====================================================================
-- World Cup Fever 2026 — seed data
-- Run AFTER schema.sql. Idempotent (safe to re-run).
-- Source: official FIFA final draw (Dec 5, 2025), all playoffs resolved.
-- fifa_rank values are APPROXIMATE seed heuristics for the simulator —
-- refresh them from a real source via the crawl/API job.
-- =====================================================================

-- ---------- 48 teams (Groups A–L) ----------
insert into teams (name, code, "group", fifa_rank, flag_emoji) values
  ('Mexico','MEX','A',18,'🇲🇽'),
  ('South Korea','KOR','A',24,'🇰🇷'),
  ('South Africa','RSA','A',44,'🇿🇦'),
  ('Czechia','CZE','A',37,'🇨🇿'),

  ('Canada','CAN','B',29,'🇨🇦'),
  ('Switzerland','SUI','B',15,'🇨🇭'),
  ('Qatar','QAT','B',35,'🇶🇦'),
  ('Bosnia and Herzegovina','BIH','B',41,'🇧🇦'),     -- playoff winner (vs Italy)

  ('Brazil','BRA','C',6,'🇧🇷'),
  ('Morocco','MAR','C',11,'🇲🇦'),
  ('Scotland','SCO','C',31,'🏴󠁧󠁢󠁳󠁣󠁴󠁿'),
  ('Haiti','HAI','C',47,'🇭🇹'),

  ('United States','USA','D',17,'🇺🇸'),
  ('Paraguay','PAR','D',32,'🇵🇾'),
  ('Australia','AUS','D',22,'🇦🇺'),
  ('Turkiye','TUR','D',34,'🇹🇷'),                    -- playoff winner (vs Kosovo)

  ('Germany','GER','E',9,'🇩🇪'),
  ('Ecuador','ECU','E',20,'🇪🇨'),
  ('Ivory Coast','CIV','E',27,'🇨🇮'),
  ('Curacao','CUW','E',48,'🇨🇼'),                    -- World Cup debut

  ('Netherlands','NED','F',7,'🇳🇱'),
  ('Japan','JPN','F',14,'🇯🇵'),
  ('Tunisia','TUN','F',33,'🇹🇳'),
  ('Sweden','SWE','F',28,'🇸🇪'),                     -- playoff winner (verify slot)

  ('Belgium','BEL','G',8,'🇧🇪'),
  ('Iran','IRN','G',19,'🇮🇷'),
  ('Egypt','EGY','G',25,'🇪🇬'),
  ('New Zealand','NZL','G',46,'🇳🇿'),

  ('Spain','ESP','H',1,'🇪🇸'),
  ('Uruguay','URU','H',13,'🇺🇾'),
  ('Saudi Arabia','KSA','H',36,'🇸🇦'),
  ('Cape Verde','CPV','H',38,'🇨🇻'),                 -- World Cup debut

  ('France','FRA','I',3,'🇫🇷'),
  ('Senegal','SEN','I',16,'🇸🇳'),
  ('Norway','NOR','I',23,'🇳🇴'),
  ('Iraq','IRQ','I',42,'🇮🇶'),                       -- intercontinental playoff winner

  ('Argentina','ARG','J',2,'🇦🇷'),
  ('Austria','AUT','J',21,'🇦🇹'),
  ('Algeria','ALG','J',30,'🇩🇿'),
  ('Jordan','JOR','J',43,'🇯🇴'),                     -- World Cup debut

  ('Portugal','POR','K',5,'🇵🇹'),
  ('Colombia','COL','K',12,'🇨🇴'),
  ('Uzbekistan','UZB','K',39,'🇺🇿'),                 -- World Cup debut
  ('DR Congo','COD','K',40,'🇨🇩'),                   -- intercontinental playoff winner

  ('England','ENG','L',4,'🏴󠁧󠁢󠁥󠁮󠁧󠁿'),
  ('Croatia','CRO','L',10,'🇭🇷'),
  ('Panama','PAN','L',26,'🇵🇦'),
  ('Ghana','GHA','L',45,'🇬🇭')
on conflict (name) do update
  set "group"=excluded."group", fifa_rank=excluded.fifa_rank, flag_emoji=excluded.flag_emoji;

-- ---------- 72 group fixtures (auto-generated round-robin) ----------
-- Pairings are the full round-robin per group; position is by fifa_rank within
-- the group. matchday is the standard pattern. kickoff_utc/venue are left NULL
-- for the seed-crawl job to fill from the official schedule.
do $$
declare g char(1); ids uuid[]; mnum int := 1;
begin
  delete from matches where stage='group';  -- idempotent reset
  for g in select distinct "group" from teams where "group" is not null order by 1 loop
    select array_agg(id order by fifa_rank) into ids from teams where "group"=g;
    insert into matches(match_number,stage,"group",matchday,home_team_id,away_team_id,status) values
      (mnum,    'group',g,1,ids[1],ids[2],'scheduled'),
      (mnum+1,  'group',g,1,ids[3],ids[4],'scheduled'),
      (mnum+2,  'group',g,2,ids[1],ids[3],'scheduled'),
      (mnum+3,  'group',g,2,ids[2],ids[4],'scheduled'),
      (mnum+4,  'group',g,3,ids[1],ids[4],'scheduled'),
      (mnum+5,  'group',g,3,ids[2],ids[3],'scheduled');
    mnum := mnum + 6;
  end loop;
end $$;

-- ---------- knockout skeleton (matches 73–104) — OFFICIAL FIFA bracket ----------
-- Slot grammar (the resolution job parses these):
--   'W-<G>'   = winner of group G          (e.g. 'W-E')
--   'RU-<G>'  = runner-up of group G        (e.g. 'RU-A')
--   '3rd:XYZ' = best third-placed team among the listed groups (FIFA allocation table)
--   'W<n>'    = winner of match number n    (e.g. 'W73')
--   'L<n>'    = loser of match number n     (third-place playoff)
-- Pairings & venues are from the official Dec 5, 2025 draw bracket and are FIXED.
-- kickoff_utc left NULL → filled by the seed-crawl job. Round date windows (local):
--   R32: Jun 28–Jul 3 | R16: Jul 4–7 | QF: Jul 9–11 | SF: Jul 14–15 | 3rd: Jul 18 | Final: Jul 19, 2026
delete from matches where stage in ('r32','r16','qf','sf','third_place','final');

insert into matches(match_number,stage,home_slot,away_slot,city,venue,status) values
  -- Round of 32 (73–88)
  (73,'r32','RU-A','RU-B','Los Angeles','SoFi Stadium','scheduled'),
  (74,'r32','W-E','3rd:ABCDF','Boston','Gillette Stadium','scheduled'),
  (75,'r32','W-F','RU-C','Guadalajara','Estadio Akron','scheduled'),
  (76,'r32','W-C','RU-F','Houston','NRG Stadium','scheduled'),
  (77,'r32','W-I','3rd:CDFGH','New York New Jersey','MetLife Stadium','scheduled'),
  (78,'r32','RU-E','RU-I','Dallas','AT&T Stadium','scheduled'),
  (79,'r32','W-A','3rd:CEFHI','Mexico City','Estadio Azteca','scheduled'),
  (80,'r32','W-L','3rd:EHIJK','Atlanta','Mercedes-Benz Stadium','scheduled'),
  (81,'r32','W-D','3rd:BEFIJ','San Francisco Bay Area','Levi''s Stadium','scheduled'),
  (82,'r32','W-G','3rd:AEHIJ','Seattle','Lumen Field','scheduled'),
  (83,'r32','RU-K','RU-L','Toronto','BMO Field','scheduled'),
  (84,'r32','W-H','RU-J','Los Angeles','SoFi Stadium','scheduled'),
  (85,'r32','W-B','3rd:EFGIJ','Vancouver','BC Place','scheduled'),
  (86,'r32','W-J','RU-H','Miami','Hard Rock Stadium','scheduled'),
  (87,'r32','W-K','3rd:DEIJL','Kansas City','Arrowhead Stadium','scheduled'),
  (88,'r32','RU-D','RU-G','Dallas','AT&T Stadium','scheduled'),
  -- Round of 16 (89–96)
  (89,'r16','W74','W77','Philadelphia','Lincoln Financial Field','scheduled'),
  (90,'r16','W73','W75','Houston','NRG Stadium','scheduled'),
  (91,'r16','W76','W78','New York New Jersey','MetLife Stadium','scheduled'),
  (92,'r16','W79','W80','Mexico City','Estadio Azteca','scheduled'),
  (93,'r16','W83','W84','Dallas','AT&T Stadium','scheduled'),
  (94,'r16','W81','W82','Seattle','Lumen Field','scheduled'),
  (95,'r16','W86','W88','Atlanta','Mercedes-Benz Stadium','scheduled'),
  (96,'r16','W85','W87','Vancouver','BC Place','scheduled'),
  -- Quarter-finals (97–100)
  (97,'qf','W89','W90','Boston','Gillette Stadium','scheduled'),
  (98,'qf','W93','W94','Los Angeles','SoFi Stadium','scheduled'),
  (99,'qf','W91','W92','Miami','Hard Rock Stadium','scheduled'),
  (100,'qf','W95','W96','Kansas City','Arrowhead Stadium','scheduled'),
  -- Semi-finals (101–102)
  (101,'sf','W97','W98','Dallas','AT&T Stadium','scheduled'),
  (102,'sf','W99','W100','Atlanta','Mercedes-Benz Stadium','scheduled'),
  -- Third place + Final
  (103,'third_place','L101','L102','Miami','Hard Rock Stadium','scheduled'),
  (104,'final','W101','W102','New York New Jersey','MetLife Stadium','scheduled');
