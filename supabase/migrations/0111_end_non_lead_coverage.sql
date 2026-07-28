-- 0111: End all open non-lead coverage assignments.
--
-- Follow-up to the lead-only coverage rule (2026-07-28): the UI now blocks
-- NEW non-lead coverage chips, and the user confirmed the six legacy rows
-- should go too ("still show support buildings on non-lead engineers"):
--   Edwin Sepulveda — 300 Mass Ave, 350 Mass Ave (since 2026-05-18)
--   Evan Sullivan   — 38 Sidney (2026-07-28), 65 Landsdowne (2026-05-26)
--   Jorge Figueroa  — 730 Main, 750 Main (since 2026-05-18)
-- Close-open convention: rows are ENDED (ends_on = today), never deleted,
-- so the history stays queryable. Lead coverage (Sean/Dariusz) untouched.

update building_assignments ba
   set ends_on = current_date
 where ba.ends_on is null
   and ba.role_in_building = 'backup'
   and not exists (select 1 from engineer_profiles ep
                    where ep.user_id = ba.user_id and ep.is_lead);
