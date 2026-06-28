-- Migration 0089 — receipt-level tagging for the pool.
--
-- Field techs tag a receipt at capture: which building (or UPark site-wide),
-- a simplified category, whether it's a stocked part, and a short item
-- label ("wifi router", "actuator"...). Shown as an overlay on the receipt
-- card. Distinct from the charge's mep_category (which drives billing) —
-- this is the tech's at-the-truck annotation.
--
-- "UPark (site-wide)" = site_wide=true, building_id null. A specific
-- building = building_id set, site_wide=false. Untagged = both empty.

alter table mro_receipts
  add column if not exists building_id uuid references buildings(id) on delete set null,
  add column if not exists site_wide   boolean not null default false,
  add column if not exists category    text check (category in ('HVAC','Plumbing','Electrical','Control','Other')),
  add column if not exists is_stock    boolean,
  add column if not exists item_label  text;
