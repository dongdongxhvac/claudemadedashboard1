-- Migration 0087 — MRO Billing Phase 4: card-charge external reference.
--
-- The card portal's Document / transaction id (e.g. TXN02832185) uniquely
-- identifies a statement line. Storing it lets CSV re-imports skip charges
-- already loaded (idempotent import) without ever deduping on amount —
-- two identical charges with different Document ids are kept as distinct.
-- (NOTE: the partial unique index here is superseded by 0088 — partial
--  indexes can't be an ON CONFLICT target.)

alter table mro_card_charges add column if not exists external_ref text;

create unique index if not exists mro_card_charges_external_ref_key
  on mro_card_charges(external_ref)
  where external_ref is not null;
