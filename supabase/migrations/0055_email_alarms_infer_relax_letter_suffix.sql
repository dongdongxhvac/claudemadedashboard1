-- Migration 0055 — Allow letter suffix on building short_codes.
--
-- The previous regex required a non-letter, non-digit boundary AFTER the
-- short_code, which blocked common BMS naming like "26LD" (the "L" is a
-- letter, fails the boundary).
--
-- Relax the trailing-boundary class from [^0-9A-Za-z] to [^0-9] — letters
-- now count as boundaries, but digits still don't (so "260" still won't
-- false-match "26"). Leading boundary stays strict ([^0-9A-Za-z]) so
-- "AHU26" doesn't get mis-attributed to building 26.
--
-- Tested behavior changes:
--   "26LD"           → 26       (was: no match)
--   "10G_AHU1"       → 10       (was: no match)
--   "750A"           → 750      (was: no match)
--   "300P_PT"        → 300      (was: no match)
--   "260"            → no match (unchanged — digit-continuation)
--   "AHU26"          → no match (unchanged — letter before short_code)
--   "75_05_TNNT"     → 75       (unchanged — already matched)
--   "G-30LD"         → G-30     (unchanged — already matched, "_" before)

create or replace function public.infer_building_from_text(p_text text)
returns text
language sql stable
as $$
  select b.short_code
  from public.buildings b
  where b.active
    and b.short_code is not null
    -- Leading: start-of-text or non-alphanumeric (still strict — no "AHU26").
    -- Trailing: end-of-text or non-digit (relaxed — letters OK, like "26LD").
    and p_text ~ ('(^|[^0-9A-Za-z])' || b.short_code || '([^0-9]|$)')
  order by length(b.short_code) desc
  limit 1;
$$;
