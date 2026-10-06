-- Migration 0136 — University Park Overtime API mirror (Jie's "CW OT Viewer").
--
-- The OT viewer publishes the crew's overtime schedule — Outlook calendar
-- events in off-hours plus jobs added through its editor, each with a number
-- of spaces and the engineers who volunteered — over a REST API:
--   GET https://vpn-1.tail198a37.ts.net/api/v1/ot?days=14   (bearer key)
-- It has no CORS headers by design and the key must never reach a browser,
-- so watcher/ot_api_poller.py (service role, same pattern as the Cove
-- pollers) fetches it every few minutes and mirrors the jobs here. The UPark
-- manager page (§11b) and TV2's overtime strip read the mirror.
--
--   ot_api_jobs   — one row per job, keyed by the API's job id. Each poll
--                   upserts what it saw and deletes the rest: a job's id
--                   changes when its event is moved in Outlook, so the old
--                   id simply disappears and the new one appears.
--   ot_api_syncs  — one row per poll (ok or error) with the API's own
--                   generated timestamp, its warnings, the team list (name +
--                   email — what a future write-back must send) and the raw
--                   payload, so a shape change is diagnosable from the DB.
--                   The UI reads the newest row for freshness ("synced 3m
--                   ago" / "last poll failed").
--
-- Read-only mirror. The API also takes writes (add job, volunteer, spaces);
-- nothing here uses them yet.

create table public.ot_api_syncs (
  id            uuid primary key default gen_random_uuid(),
  fetched_at    timestamptz not null default now(),
  status        text not null default 'ok' check (status in ('ok', 'error')),
  error_msg     text,
  source_url    text,
  generated_at  timestamptz,          -- payload.generated
  window_days   int,                  -- payload.window_days
  job_count     int not null default 0,
  warnings      jsonb not null default '[]'::jsonb,
  team          jsonb not null default '[]'::jsonb,
  payload       jsonb
);

create index ot_api_syncs_fetched_idx on public.ot_api_syncs (fetched_at desc);

create table public.ot_api_jobs (
  id            text primary key,     -- API job id (hex); changes if the Outlook event moves
  title         text not null default '',
  location      text,
  source        text,                 -- 'calendar' (Outlook) | 'added' (API / editor)
  notes         text,
  start_at      timestamptz not null,
  end_at        timestamptz,
  all_day       boolean not null default false,
  when_text     text,                 -- the API's own "Sat Sep 19, 7 AM - 4 PM"
  spaces        int not null default 0,
  filled        int not null default 0,
  open_spaces   int not null default 0,
  status        text not null default 'unfilled',   -- unfilled | partial | full
  volunteers    jsonb not null default '[]'::jsonb, -- [{name, email, signed_up}]
  raw           jsonb,
  fetched_at    timestamptz not null default now()
);

create index ot_api_jobs_start_idx on public.ot_api_jobs (start_at);

alter table public.ot_api_syncs enable row level security;
alter table public.ot_api_jobs  enable row level security;

-- Any signed-in role may read (the TV account included). Writes come only
-- from the poller's service-role key — no insert/update/delete policies.
create policy "ot_api_syncs_auth_select" on public.ot_api_syncs
  for select to authenticated using (true);
create policy "ot_api_jobs_auth_select" on public.ot_api_jobs
  for select to authenticated using (true);

-- Realtime: the manager page invalidates when the mirror changes. The jobs
-- table emits per-row events; the syncs row is one event per poll and is
-- what the "synced N min ago" meta listens to.
alter publication supabase_realtime add table public.ot_api_jobs;
alter publication supabase_realtime add table public.ot_api_syncs;
