-- Migration 0097 — site-aware announcements (focus board).
--
-- The Binney seed exposed that focus_board_items has no site concept, so
-- UPark announcements render on Binney engineers' /engineer/me headers.
-- Adds a nullable site_id: NULL means "all sites" (reachable via SQL only),
-- a BEFORE INSERT trigger stamps UPark when the writer doesn't specify one
-- (today's only composer lives on the UPark manager page), and existing rows
-- are backfilled to UPark. The FocusBoardBanner filters by the viewer's home
-- site (admin/director see everything).
--
-- On-call stays single-site (UPark's rotation) — the OncallBadge is simply
-- hidden for Binney-homed viewers until Binney gets its own rotation.
--
-- Rollback:
--   -- drop trigger if exists focus_items_default_site_trg on focus_board_items;
--   -- drop function if exists tg_focus_items_default_site();
--   -- alter table focus_board_items drop column if exists site_id;

alter table focus_board_items
  add column if not exists site_id uuid references sites(id);

update focus_board_items
  set site_id = (select id from sites where code = 'upark')
  where site_id is null;

create or replace function tg_focus_items_default_site()
returns trigger
language plpgsql
as $$
begin
  if new.site_id is null then
    new.site_id := (select id from sites where code = 'upark');
  end if;
  return new;
end;
$$;

drop trigger if exists focus_items_default_site_trg on focus_board_items;
create trigger focus_items_default_site_trg
  before insert on focus_board_items
  for each row execute function tg_focus_items_default_site();
