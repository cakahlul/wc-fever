-- Penalty-shootout result for knockout matches.
-- A knockout tie is decided on penalties, but home_score/away_score record only
-- the regulation+ET score (which stays level). Without the shootout result the
-- bracket can't tell who advanced, so store it explicitly.
alter table matches add column if not exists home_pens int;
alter table matches add column if not exists away_pens int;
