-- Migration 0149 — chillers: the chiller status board.
--
-- User 2026-10-13: "replace LOTO section with chiller status list (open,
-- punching, rat race, closed)" + the list of 18 chillers by building. One
-- row per chiller; status is one of the four shop states, with the date
-- and engineer of the last change. TV2's Chillers tile shows the board;
-- the UPark manager page's §14 card sets statuses and adds / removes
-- chillers. Same access shape as winterization_tasks: any signed-in role
-- reads, admin / manager / lead write; in the realtime publication so the
-- wall follows within seconds.

create table public.chillers (
  id            uuid primary key default gen_random_uuid(),
  building_code text not null,
  name          text,                      -- null = unnamed (350, 65 on the list)
  sort_order    int  not null default 0,
  status        text not null default 'closed'
    check (status in ('open', 'punching', 'rat_race', 'closed')),
  status_at     timestamptz,
  status_by     uuid references users(id) on delete set null,
  note          text,
  created_by    uuid references users(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index chillers_sort_idx on public.chillers (sort_order);

create or replace function public.chillers_touch()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
create trigger chillers_touch_trg
  before update on public.chillers
  for each row execute function public.chillers_touch();

alter table public.chillers enable row level security;
create policy "chillers_auth_select" on public.chillers
  for select to authenticated using (true);
create policy "chillers_manage_write" on public.chillers
  for all to authenticated
  using (coalesce(current_user_can_manage_users(), false) or coalesce(current_user_is_lead(), false))
  with check (coalesce(current_user_can_manage_users(), false) or coalesce(current_user_is_lead(), false));

grant select, insert, update, delete on public.chillers to authenticated;
grant all on public.chillers to service_role;

alter publication supabase_realtime add table public.chillers;

-- Seed: the list as pasted 2026-10-13, in that order. Status starts
-- 'closed' with no date (nobody has set it yet).
insert into public.chillers (building_code, name, sort_order) values
  ('750', 'York Chiller1',        1),
  ('750', 'York Chiller2',        2),
  ('26',  'Artic cool chiller1',  3),
  ('26',  'Artic cool chiller2',  4),
  ('40',  'Trane chiller1',       5),
  ('40',  'Trane chiller2',       6),
  ('40',  'Trane chiller3',       7),
  ('350', null,                   8),
  ('300', 'Trane small chiller1', 9),
  ('300', 'Trane chiller2',      10),
  ('35',  'York chiller1',       11),
  ('35',  'Trane chiller2',      12),
  ('35',  'Trane chiller3',      13),
  ('65',  null,                  14),
  ('88',  'Trane chiller1',      15),
  ('88',  'Trane chiller2',      16),
  ('45',  'Trane chiller1',      17),
  ('45',  'Trane chiller2',      18);
