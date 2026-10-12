-- Migration 0141 — ot_api_jobs_log: a permanent record of every OT-viewer job.
--
-- "log all OT coverage posts" (user 2026-10-11). The OT viewer API only ever
-- returns FUTURE jobs (its window is forward-only), and the mirror
-- (ot_api_jobs, 0136) deletes whatever the API stops returning — so a job
-- vanishes from the dashboard the moment its day passes. TV3 wants to show
-- yesterday's coverage, and nothing else keeps history, so the sync now
-- also upserts every job it sees into this table and never deletes from it:
--
--   first_seen_at  first poll that carried the id
--   last_seen_at   latest poll that carried it
--   gone_at        the poll at which it stopped appearing (null = still on
--                  the schedule). An id that disappears BEFORE its start was
--                  cancelled or moved (a moved Outlook event gets a new id);
--                  one that disappears after its start simply aged out —
--                  readers showing "what happened yesterday" keep rows with
--                  gone_at is null or gone_at >= start_at.
--
-- Native posts (overtime_posts) are never deleted, so they need no log.
-- Same read policy as the mirror: any signed-in role may select, writes
-- come only from the sync's service-role key.

create table public.ot_api_jobs_log (
  id            text primary key,
  title         text not null default '',
  location      text,
  source        text,
  notes         text,
  start_at      timestamptz not null,
  end_at        timestamptz,
  all_day       boolean not null default false,
  when_text     text,
  spaces        int not null default 0,
  filled        int not null default 0,
  open_spaces   int not null default 0,
  status        text not null default 'unfilled',
  volunteers    jsonb not null default '[]'::jsonb,
  raw           jsonb,
  fetched_at    timestamptz,
  first_seen_at timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  gone_at       timestamptz
);

create index ot_api_jobs_log_start_idx on public.ot_api_jobs_log (start_at);

alter table public.ot_api_jobs_log enable row level security;
create policy "ot_api_jobs_log_auth_select" on public.ot_api_jobs_log
  for select to authenticated using (true);

-- Seed 1: everything on the mirror right now.
insert into public.ot_api_jobs_log
  (id, title, location, source, notes, start_at, end_at, all_day, when_text,
   spaces, filled, open_spaces, status, volunteers, raw, fetched_at,
   first_seen_at, last_seen_at)
select id, title, location, source, notes, start_at, end_at, all_day, when_text,
       spaces, filled, open_spaces, status, volunteers, raw, fetched_at,
       fetched_at, fetched_at
  from public.ot_api_jobs
on conflict (id) do nothing;

-- Seed 2: anything in the retained sync payloads (7 days) that already
-- dropped off the mirror. first/last seen from the polls that carried it;
-- gone_at = its last poll when it is no longer on the mirror.
with seen as (
  select j->>'id' as id, s.fetched_at, j
    from public.ot_api_syncs s, jsonb_array_elements(s.payload->'jobs') j
   where s.status = 'ok'
     and nullif(j->>'id', '') is not null
     and nullif(j->>'start', '') is not null
),
agg as (
  select id, min(fetched_at) as first_seen, max(fetched_at) as last_seen
    from seen group by id
),
latest as (
  select distinct on (id) id, j from seen order by id, fetched_at desc
)
insert into public.ot_api_jobs_log
  (id, title, location, source, notes, start_at, end_at, all_day, when_text,
   spaces, filled, open_spaces, status, volunteers, raw, fetched_at,
   first_seen_at, last_seen_at, gone_at)
select l.id,
       coalesce(l.j->>'title', ''),
       nullif(l.j->>'location', ''),
       nullif(l.j->>'source', ''),
       nullif(l.j->>'notes', ''),
       (l.j->>'start')::timestamptz,
       nullif(l.j->>'end', '')::timestamptz,
       coalesce((l.j->>'all_day')::boolean, false),
       nullif(l.j->>'when', ''),
       coalesce((l.j->>'spaces')::int, 0),
       coalesce((l.j->>'filled')::int, 0),
       coalesce((l.j->>'open')::int, 0),
       coalesce(nullif(l.j->>'status', ''), 'unfilled'),
       coalesce(l.j->'volunteers', '[]'::jsonb),
       l.j,
       a.last_seen,
       a.first_seen,
       a.last_seen,
       case when exists (select 1 from public.ot_api_jobs x where x.id = l.id)
            then null else a.last_seen end
  from latest l join agg a using (id)
on conflict (id) do update
  set first_seen_at = least(public.ot_api_jobs_log.first_seen_at, excluded.first_seen_at);
