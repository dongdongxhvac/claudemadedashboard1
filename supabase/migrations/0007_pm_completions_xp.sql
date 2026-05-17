-- Migration 0007 — XP calculator
--
-- Persists every distinct (task_no, engineer) completion observed in any
-- pm_rows snapshot, so XP accumulates across the snapshot history rather than
-- vanishing when the CMMS drops completed items from later exports.
--
-- Triggers:
--   pm_rows.after_insert  → if row is completed, upsert into pm_completions
--   pm_completions.after_insert → recompute engineer_profiles.xp + level
--
-- XP formula: 10 + round(labor_hours * 2), clamped to [10, 50] per PM
-- Level formula: floor(sqrt(xp / 100)) + 1, capped at 10
--   level 1 = 0 XP, level 2 = 100, level 3 = 400, ..., level 10 = 8100

create table if not exists pm_completions (
  id                          uuid primary key default gen_random_uuid(),
  task_no                     text not null,
  user_id                     uuid not null references users(id) on delete cascade,
  cmms_assignee_name          text,
  pm_type                     text,
  labor_hours                 numeric default 0,
  first_completed_in_snapshot uuid references snapshots(id) on delete set null,
  first_seen_at               timestamptz not null default now(),
  unique (task_no, user_id)
);
create index if not exists pm_completions_user_idx on pm_completions(user_id);

create or replace function compute_xp_for(labor_hours_in numeric)
returns int language sql immutable as $$
  select least(50, greatest(10, 10 + round(coalesce(labor_hours_in, 0) * 2)::int));
$$;

create or replace function compute_level_from_xp(xp_in int)
returns int language sql immutable as $$
  select least(10, floor(sqrt(greatest(0, xp_in) / 100.0))::int + 1);
$$;

create or replace function maybe_record_pm_completion()
returns trigger language plpgsql as $$
declare uid uuid;
begin
  if NEW.status is null or lower(NEW.status) not in ('completed','closed','complete') then
    return NEW;
  end if;
  if NEW.task_no is null or NEW.assigned_to_name is null then
    return NEW;
  end if;
  select ep.user_id into uid
  from engineer_profiles ep
  where ep.cmms_assignee_name = trim(NEW.assigned_to_name)
  limit 1;
  if uid is null then return NEW; end if;

  insert into pm_completions (task_no, user_id, cmms_assignee_name, pm_type, labor_hours, first_completed_in_snapshot)
  values (NEW.task_no, uid, NEW.assigned_to_name, NEW.pm_type, NEW.labor_hours, NEW.snapshot_id)
  on conflict (task_no, user_id) do nothing;
  return NEW;
end;
$$;

drop trigger if exists pm_rows_after_insert_record_completion on pm_rows;
create trigger pm_rows_after_insert_record_completion
  after insert on pm_rows
  for each row execute function maybe_record_pm_completion();

create or replace function recompute_engineer_xp()
returns trigger language plpgsql as $$
declare total_xp int;
begin
  select coalesce(sum(compute_xp_for(labor_hours)), 0)::int into total_xp
  from pm_completions
  where user_id = NEW.user_id;

  update engineer_profiles
  set xp = total_xp,
      level = compute_level_from_xp(total_xp),
      updated_at = now()
  where user_id = NEW.user_id;
  return NEW;
end;
$$;

drop trigger if exists pm_completions_after_insert_recompute on pm_completions;
create trigger pm_completions_after_insert_recompute
  after insert on pm_completions
  for each row execute function recompute_engineer_xp();

alter table pm_completions enable row level security;

create policy "pm_completions_admin_manager_select" on pm_completions
  for select to authenticated
  using (current_user_role() in ('admin','manager'));

create policy "pm_completions_self_select" on pm_completions
  for select to authenticated
  using (user_id = (select id from users where auth_user_id = auth.uid() limit 1));

alter publication supabase_realtime add table pm_completions;
