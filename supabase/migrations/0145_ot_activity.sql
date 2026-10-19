-- Migration 0145 — overtime activity log: who did what, when, on both boards.
--
-- "a user log of activities in manager view and tv kiosk — engineer name,
-- activity, time and date, like Austin withdrew, or event got cancelled"
-- (user 2026-10-19). Two sources feed one feed:
--
--   overtime_activity  — the dashboard's OWN OT posts (§11). Until now a
--                        withdrawal was a plain DELETE on overtime_signups
--                        and left no trace. Triggers now record: signed_up,
--                        withdrew (incl. removed-by-manager), post_added,
--                        post_cancelled, post_restored, post_rescheduled.
--                        SECURITY DEFINER so the trigger can write under an
--                        engineer's RLS (the table has no insert policy).
--   ot_api_job_events  — the OT viewer (Steve's board), already written by
--                        the sync (0144).
--   v_ot_activity      — the union, in one shape, newest first by `at`:
--                        source · kind · person_name · job_title ·
--                        job_start · detail. §11c on the manager page and
--                        the "recent activity" strip on the TV read it.
--
-- Seed: existing sign-ups (signed_up_at) and posts (created_at /
-- cancelled_at) are back-filled so the log has history from day one.

create table if not exists public.overtime_activity (
  id             bigserial primary key,
  at             timestamptz not null default now(),
  kind           text not null check (kind in (
                   'signed_up', 'withdrew', 'post_added', 'post_cancelled',
                   'post_restored', 'post_rescheduled')),
  post_id        uuid,
  user_id        uuid,              -- the engineer the row is about
  actor_id       uuid,              -- who did it (null = unknown / system)
  person_name    text,
  post_label     text,              -- "26 · scope" as the board shows it
  post_starts_at timestamptz,
  detail         jsonb not null default '{}'::jsonb
);

create index if not exists overtime_activity_at_idx on public.overtime_activity (at desc);

alter table public.overtime_activity enable row level security;
drop policy if exists "overtime_activity_auth_select" on public.overtime_activity;
create policy "overtime_activity_auth_select" on public.overtime_activity
  for select to authenticated using (true);
-- No insert/update/delete policies: only the triggers below write.

-- Helpers ------------------------------------------------------------------

create or replace function public.ot_activity_post_label(p public.overtime_posts)
returns text language sql stable set search_path = public as $$
  select trim(both ' · ' from
    coalesce((select coalesce(b.short_code, b.code) from buildings b where b.id = p.building_id), p.building_label, '')
    || ' · ' || coalesce(p.scope, ''));
$$;

create or replace function public.ot_activity_actor()
returns uuid language sql stable set search_path = public as $$
  select u.id from users u where u.auth_user_id = auth.uid() limit 1;
$$;

-- Triggers: sign-ups -------------------------------------------------------

create or replace function public.ot_activity_on_signup()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  p public.overtime_posts;
  v_actor uuid := public.ot_activity_actor();
  v_name  text;
  v_actor_name text;
begin
  if tg_op = 'DELETE' then
    select * into p from overtime_posts where id = old.post_id;
    if p.id is null then return old; end if;   -- post itself being deleted
    select full_name into v_name from users where id = old.user_id;
    select full_name into v_actor_name from users where id = v_actor;
    insert into overtime_activity (kind, post_id, user_id, actor_id, person_name, post_label, post_starts_at, detail)
    values ('withdrew', old.post_id, old.user_id, v_actor, v_name, public.ot_activity_post_label(p), p.starts_at,
            jsonb_build_object('by_self', v_actor is null or v_actor = old.user_id, 'actor_name', v_actor_name));
    return old;
  end if;
  select * into p from overtime_posts where id = new.post_id;
  select full_name into v_name from users where id = new.user_id;
  select full_name into v_actor_name from users where id = coalesce(new.signed_up_by, v_actor);
  insert into overtime_activity (at, kind, post_id, user_id, actor_id, person_name, post_label, post_starts_at, detail)
  values (coalesce(new.signed_up_at, now()), 'signed_up', new.post_id, new.user_id, coalesce(new.signed_up_by, v_actor), v_name,
          public.ot_activity_post_label(p), p.starts_at,
          jsonb_build_object('by_self', coalesce(new.signed_up_by, v_actor) is null or coalesce(new.signed_up_by, v_actor) = new.user_id,
                             'actor_name', v_actor_name));
  return new;
end;
$$;

drop trigger if exists overtime_signups_activity_trg on public.overtime_signups;
create trigger overtime_signups_activity_trg
  after insert or delete on public.overtime_signups
  for each row execute function public.ot_activity_on_signup();

-- Triggers: posts ----------------------------------------------------------

create or replace function public.ot_activity_on_post()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := public.ot_activity_actor();
  v_actor_name text;
begin
  select full_name into v_actor_name from users where id = coalesce(new.created_by, v_actor);
  if tg_op = 'INSERT' then
    insert into overtime_activity (at, kind, post_id, actor_id, person_name, post_label, post_starts_at, detail)
    values (coalesce(new.created_at, now()), 'post_added', new.id, coalesce(new.created_by, v_actor), v_actor_name,
            public.ot_activity_post_label(new), new.starts_at,
            jsonb_build_object('slots', new.slots_needed, 'category', new.category::text));
    return new;
  end if;
  select full_name into v_actor_name from users where id = v_actor;
  if old.status is distinct from new.status then
    if new.status = 'cancelled' then
      insert into overtime_activity (kind, post_id, actor_id, person_name, post_label, post_starts_at, detail)
      values ('post_cancelled', new.id, v_actor, v_actor_name, public.ot_activity_post_label(new), new.starts_at,
              jsonb_build_object('signups', (select count(*) from overtime_signups s where s.post_id = new.id)));
    elsif old.status = 'cancelled' and new.status = 'open' then
      insert into overtime_activity (kind, post_id, actor_id, person_name, post_label, post_starts_at)
      values ('post_restored', new.id, v_actor, v_actor_name, public.ot_activity_post_label(new), new.starts_at);
    end if;
  end if;
  if old.starts_at is distinct from new.starts_at or old.ends_at is distinct from new.ends_at then
    insert into overtime_activity (kind, post_id, actor_id, person_name, post_label, post_starts_at, detail)
    values ('post_rescheduled', new.id, v_actor, v_actor_name, public.ot_activity_post_label(new), new.starts_at,
            jsonb_build_object('from_start', old.starts_at, 'from_end', old.ends_at, 'to_start', new.starts_at, 'to_end', new.ends_at));
  end if;
  return new;
end;
$$;

drop trigger if exists overtime_posts_activity_trg on public.overtime_posts;
create trigger overtime_posts_activity_trg
  after insert or update on public.overtime_posts
  for each row execute function public.ot_activity_on_post();

-- Seed from what already happened ------------------------------------------

insert into public.overtime_activity (at, kind, post_id, actor_id, person_name, post_label, post_starts_at, detail)
select p.created_at, 'post_added', p.id, p.created_by, u.full_name, public.ot_activity_post_label(p), p.starts_at,
       jsonb_build_object('slots', p.slots_needed, 'category', p.category::text, 'seeded', true)
  from public.overtime_posts p left join public.users u on u.id = p.created_by
 where not exists (select 1 from public.overtime_activity a where a.post_id = p.id and a.kind = 'post_added');

insert into public.overtime_activity (at, kind, post_id, user_id, actor_id, person_name, post_label, post_starts_at, detail)
select s.signed_up_at, 'signed_up', s.post_id, s.user_id, s.signed_up_by, u.full_name, public.ot_activity_post_label(p), p.starts_at,
       jsonb_build_object('by_self', s.signed_up_by is null or s.signed_up_by = s.user_id, 'seeded', true)
  from public.overtime_signups s
  join public.overtime_posts p on p.id = s.post_id
  left join public.users u on u.id = s.user_id
 where not exists (select 1 from public.overtime_activity a where a.post_id = s.post_id and a.user_id = s.user_id and a.kind = 'signed_up');

insert into public.overtime_activity (at, kind, post_id, person_name, post_label, post_starts_at, detail)
select p.cancelled_at, 'post_cancelled', p.id, null, public.ot_activity_post_label(p), p.starts_at, jsonb_build_object('seeded', true)
  from public.overtime_posts p
 where p.status = 'cancelled' and p.cancelled_at is not null
   and not exists (select 1 from public.overtime_activity a where a.post_id = p.id and a.kind = 'post_cancelled');

-- One feed ------------------------------------------------------------------

create or replace view public.v_ot_activity
with (security_invoker = true)
as
select 'dashboard'::text as source,
       'd:' || a.id::text  as key,
       a.at,
       a.kind,
       a.person_name,
       a.post_label        as job_title,
       a.post_starts_at    as job_start,
       a.detail
  from public.overtime_activity a
union all
select 'ot_viewer'::text,
       'v:' || e.id::text,
       e.at,
       case e.kind
         when 'volunteer_added'   then 'signed_up'
         when 'volunteer_removed' then 'withdrew'
         when 'added'             then 'post_added'
         when 'removed'           then 'post_cancelled'
         when 'restored'          then 'post_restored'
         when 'rescheduled'       then 'post_rescheduled'
         else e.kind
       end,
       coalesce(e.detail->>'name', e.detail->>'email'),
       e.title,
       e.start_at,
       e.detail
  from public.ot_api_job_events e;

grant select on public.v_ot_activity to authenticated, service_role;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'overtime_activity'
  ) then
    alter publication supabase_realtime add table public.overtime_activity;
  end if;
end $$;
