-- Migration 0150 — drop the two unnamed chiller rows.
--
-- User 2026-10-13: "remove 350 and 65" — the pasted list had those
-- buildings with no chiller name; they were seeded as placeholders in
-- 0149. Also noted the same day: "rat race" is the chemical run on a
-- closed chiller (a treatment step, not a fault) — a display matter, no
-- schema change.

delete from public.chillers
 where name is null
   and building_code in ('350', '65');
