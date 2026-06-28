-- Migration 0085 — MRO Billing module, Phase 1: schema + RLS.
--
-- Reimbursable MRO purchases on a cost-plus contract: company-card charges
-- + receipt photos, reclassed to a contracted building + MEP category,
-- marked up, billed to the client. Tables use the dashboard's domain-prefix
-- convention (mro_*) and REUSE the existing public.buildings table.
-- Access: admin + manager only (per setup decision).

-- Billing-role gate (admin OR manager). One place so policies stay aligned.
create or replace function public.mro_can_bill()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from users u
    where u.auth_user_id = auth.uid() and u.active
      and (u.role in ('admin','manager') or coalesce(u.is_manager, false))
  );
$$;

-- import_batches
create table mro_import_batches (
  id           uuid primary key default gen_random_uuid(),
  source       text,
  period_start date,
  period_end   date,
  created_by   text,
  created_at   timestamptz not null default now()
);

-- receipts
create table mro_receipts (
  id                 uuid primary key default gen_random_uuid(),
  storage_path       text not null,
  image_mime         text,
  uploaded_by        text,
  uploaded_at        timestamptz not null default now(),
  extracted_merchant text,
  extracted_total    numeric(12,2),
  extracted_date     date,
  extracted_last4    text,
  extracted_auth     text,
  ocr_legibility     text check (ocr_legibility in ('clear','partial','poor')),
  ocr_confidence     jsonb,
  ocr_raw            jsonb,
  ocr_status         text not null default 'pending'
                       check (ocr_status in ('pending','done','failed'))
);
create index mro_receipts_ocr_status_idx on mro_receipts(ocr_status);

-- card_charges
create table mro_card_charges (
  id               uuid primary key default gen_random_uuid(),
  import_batch_id  uuid references mro_import_batches(id) on delete set null,
  txn_date         date,
  post_date        date,
  merchant         text,
  amount           numeric(12,2) not null,
  cardholder       text,
  card_last4       text,
  building_id      uuid references buildings(id) on delete set null,
  mep_category     text check (mep_category in (
                     'Mechanical','Electrical','Plumbing',
                     'Fire / Life Safety','Controls / BMS','General / Other')),
  receipt_id       uuid references mro_receipts(id) on delete set null,
  note             text,
  status           text not null default 'unreviewed'
                     check (status in ('unreviewed','verified','exception')),
  exception_reason text check (exception_reason in (
                     'missing-receipt','freight-delta','tax-credit-pending',
                     'split-shipment','orphan-receipt','needs-research')),
  match_confidence numeric,
  amount_delta     numeric(12,2),
  verified_by      text,
  verified_at      timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint mro_exception_needs_reason
    check (status <> 'exception' or exception_reason is not null),
  constraint mro_delta_needs_reason
    check (amount_delta is null or amount_delta = 0 or exception_reason is not null)
);
create index mro_card_charges_batch_idx    on mro_card_charges(import_batch_id);
create index mro_card_charges_building_idx on mro_card_charges(building_id);
create index mro_card_charges_status_idx   on mro_card_charges(status);
create index mro_card_charges_receipt_idx  on mro_card_charges(receipt_id);

-- RLS: admin + manager full access; nobody else
alter table mro_import_batches enable row level security;
alter table mro_receipts       enable row level security;
alter table mro_card_charges   enable row level security;

create policy mro_import_batches_billing on mro_import_batches
  for all to authenticated using (mro_can_bill()) with check (mro_can_bill());
create policy mro_receipts_billing on mro_receipts
  for all to authenticated using (mro_can_bill()) with check (mro_can_bill());
create policy mro_card_charges_billing on mro_card_charges
  for all to authenticated using (mro_can_bill()) with check (mro_can_bill());

alter publication supabase_realtime add table mro_import_batches;
alter publication supabase_realtime add table mro_receipts;
alter publication supabase_realtime add table mro_card_charges;
