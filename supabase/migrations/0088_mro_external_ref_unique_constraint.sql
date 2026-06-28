-- Migration 0088 — fix external_ref dedup target.
--
-- 0087 used a PARTIAL unique index, which PostgREST/Postgres can't use as
-- an ON CONFLICT target — the dedup-upsert failed with "no unique or
-- exclusion constraint matching the ON CONFLICT specification". Replace it
-- with a plain unique CONSTRAINT: a standard unique on a nullable column
-- still allows unlimited NULLs (NULLs compare distinct), so charges
-- without a Document id are unaffected, and ON CONFLICT (external_ref)
-- now resolves.

drop index if exists mro_card_charges_external_ref_key;

alter table mro_card_charges
  add constraint mro_card_charges_external_ref_key unique (external_ref);
