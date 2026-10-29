-- Migration 0155 — Binney cluster role: round engineer / floater / BMS.
--
-- Don (2026-10-29): the profile's Cluster + Dedicated manager pickers become
-- ONE dropdown — East · Ed Nardone, East Floater · Ed Nardone, East BMS ·
-- Ed Nardone, West · Andrew Balbo, West Floater · Andrew Balbo, West BMS ·
-- Andrew Balbo — and the cluster mark reads E / EF / EB / W / WF / WB.
-- The manager still lands in engineer_profiles.manager_user_id (set by the
-- picker from the cluster's manager); the role is the new column here.
--
-- Seed from the rounds sheet + weekend PM plan: floaters = Angelo, Danjel,
-- Pedro, Peyton (East), Colin, Bob Knowlton, Imtiyaz, Justin McGaffigan
-- (West); BMS = Richard Fidler, Ed Twyman (East BMS), John Nardone, Alberto
-- Pires (West BMS). Everyone else stays 'round' (the default).
--
-- Rollback: alter table engineer_profiles drop column cluster_role;

begin;

alter table engineer_profiles
  add column if not exists cluster_role text not null default 'round'
    check (cluster_role in ('round', 'floater', 'bms'));

comment on column engineer_profiles.cluster_role is
  'Binney: round (walks building rounds), floater (PMs, no round), bms. Badge suffix F / B.';

do $$
declare
  v_site uuid;
begin
  select id into v_site from sites where code = 'binney';
  if v_site is null then
    raise notice 'sites.code=binney not found — skipping Binney seed';
    return;
  end if;

  update engineer_profiles ep
     set cluster_role = v.role, updated_at = now()
    from (values
      ('Angelo Furtado',    'floater'),
      ('Danjel Sallaku',    'floater'),
      ('Pedro Cuevas',      'floater'),
      ('Peyton McGaffigan', 'floater'),
      ('Colin Reilly',      'floater'),
      ('Robert Knowlton',   'floater'),
      ('Imtiyaz Khalifa',   'floater'),
      ('Justin McGaffigan', 'floater'),
      ('Richard Fidler',    'bms'),
      ('Edward Twyman',     'bms'),
      ('John Nardone',      'bms'),
      ('Alberto Pires',     'bms')
    ) as v(full_name, role)
    join users u on lower(u.full_name) = lower(v.full_name)
   where ep.user_id = u.id
     and ep.home_site_id = v_site;
end $$;

commit;
