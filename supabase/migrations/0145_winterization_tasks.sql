-- Migration 0145 — winterization_tasks: the shop's "Cold Weather Prep" list.
--
-- The whiteboard (user 2026-10-13, photo): one line per building task —
-- "55 garage water risers drain downs", "65 RTU make-up water lines drain
-- downs + sumps", "35+40 AHU 2.1 CHW coil drain downs", … — ticked off as
-- the crew works through the fall. TV2's Winterization tile shows the
-- current season's list with each task's done state; the UPark manager
-- page gets a small card to tick / add / remove tasks.
--
-- One row per task per season ('2026-27' = Aug 2026 – Jul 2027; the app's
-- currentWinterSeason() picks the season from the date). done_at / done_by
-- record the tick; clearing done_at un-ticks. Read: any signed-in role
-- (the TV included). Write: admin / manager / lead — the same people who
-- run the Shop TV card and the equipment board.

create table public.winterization_tasks (
  id            uuid primary key default gen_random_uuid(),
  season        text not null,            -- '2026-27'
  building_code text not null,            -- '55', '35+40'
  task          text not null,
  sort_order    int  not null default 0,
  done_at       timestamptz,
  done_by       uuid references users(id) on delete set null,
  note          text,
  created_by    uuid references users(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index winterization_tasks_season_idx on public.winterization_tasks (season, sort_order);

create or replace function public.winterization_tasks_touch()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
create trigger winterization_tasks_touch_trg
  before update on public.winterization_tasks
  for each row execute function public.winterization_tasks_touch();

alter table public.winterization_tasks enable row level security;

create policy "winterization_tasks_auth_select" on public.winterization_tasks
  for select to authenticated using (true);
create policy "winterization_tasks_manage_write" on public.winterization_tasks
  for all to authenticated
  using (coalesce(current_user_can_manage_users(), false) or coalesce(current_user_is_lead(), false))
  with check (coalesce(current_user_can_manage_users(), false) or coalesce(current_user_is_lead(), false));

grant select, insert, update, delete on public.winterization_tasks to authenticated;
grant all on public.winterization_tasks to service_role;

-- The wall follows ticks live.
alter publication supabase_realtime add table public.winterization_tasks;

-- Seed: the whiteboard as photographed 2026-10-13.
insert into public.winterization_tasks (season, building_code, task, sort_order) values
  ('2026-27', '55',    'Garage water risers drain downs',                1),
  ('2026-27', '80',    'Garage water risers drain downs',                2),
  ('2026-27', '30',    'Garage water risers drain downs',                3),
  ('2026-27', '65',    'RTU make-up water lines drain downs + sumps',    4),
  ('2026-27', '350',   'AHU make-up water lines drain downs + sumps',    5),
  ('2026-27', '45',    'CT 2+3 drain downs',                             6),
  ('2026-27', '26',    'CT 2+3 drain downs',                             7),
  ('2026-27', '35+40', 'AHU 2.1 CHW coil drain downs',                   8),
  ('2026-27', '88',    'Cooling tower make-up float adjustment',         9);
