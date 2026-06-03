-- Migration 0063 — Parent/child equipment relationships.
--
-- Big equipment has serviceable components: a chiller has compressors,
-- a condenser, a cooling tower; an AHU has supply/return fans, VFDs,
-- coils, freeze stats; a boiler has burners, pumps, sensors. Before this
-- migration each piece was a flat row, forcing engineers to either:
--   (a) put "Compressor 2 fault" in the parent's issue detail (loses the
--       per-component history), or
--   (b) create a flat "Chiller 1 Compressor 2" row with no link to the
--       parent (loses the rollup view).
--
-- After: building_equipment.parent_equipment_id is a self-FK. UI displays
-- children indented under their parent. Counts roll up — the parent's
-- card shows the WORST of its OWN open issues and its descendants'.
--
-- Cycle prevention: handled in app code (the parent dropdown excludes
-- self + descendants). A DB-level cycle check would need a recursive CTE
-- in a trigger, which is overkill given the form is the only writer.
--
-- ON DELETE SET NULL: if a parent is soft-deleted (active=false) or
-- hard-deleted, children stay around as orphaned top-level rows. They
-- don't get cascaded out — too easy to lose history that way.

alter table building_equipment
  add column if not exists parent_equipment_id uuid
    references building_equipment(id) on delete set null;

-- Index for the "list children of X" query path used by the parent rollup.
create index if not exists building_equipment_parent_idx
  on building_equipment(parent_equipment_id)
  where active;
