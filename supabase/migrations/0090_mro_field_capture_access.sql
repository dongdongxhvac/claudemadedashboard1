-- Migration 0090 — field receipt capture for techs (least-privilege).
--
-- Engineers/leads can capture receipts (upload + tag + see/delete THEIR
-- OWN) via the phone page; they never see card charges, billing, or other
-- people's receipts. Admin/manager keep full access (mro_can_bill).
-- Billing tables (mro_card_charges, mro_import_batches) are UNCHANGED.

alter table mro_receipts add column if not exists uploaded_by_user_id uuid references users(id);

create or replace function public.mro_current_user_id()
returns uuid language sql stable security definer set search_path = public as $$
  select id from users where auth_user_id = auth.uid() and active limit 1;
$$;

create or replace function public.mro_can_capture()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from users u
    where u.auth_user_id = auth.uid() and u.active
      and u.role in ('admin', 'manager', 'engineer', 'lead')
  );
$$;

create or replace function public.mro_receipt_is_attached(rid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from mro_card_charges where receipt_id = rid);
$$;

drop policy if exists "mro_receipts_owner_select" on mro_receipts;
drop policy if exists "mro_receipts_owner_insert" on mro_receipts;
drop policy if exists "mro_receipts_owner_update" on mro_receipts;
drop policy if exists "mro_receipts_owner_delete" on mro_receipts;

create policy "mro_receipts_owner_select" on mro_receipts
  for select to authenticated using (uploaded_by_user_id = mro_current_user_id());
create policy "mro_receipts_owner_insert" on mro_receipts
  for insert to authenticated with check (uploaded_by_user_id = mro_current_user_id() and mro_can_capture());
create policy "mro_receipts_owner_update" on mro_receipts
  for update to authenticated
  using (uploaded_by_user_id = mro_current_user_id())
  with check (uploaded_by_user_id = mro_current_user_id());
create policy "mro_receipts_owner_delete" on mro_receipts
  for delete to authenticated
  using (uploaded_by_user_id = mro_current_user_id() and not mro_receipt_is_attached(id));

drop policy if exists "mro_receipts_read"   on storage.objects;
drop policy if exists "mro_receipts_insert" on storage.objects;
drop policy if exists "mro_receipts_update" on storage.objects;
drop policy if exists "mro_receipts_delete" on storage.objects;

create policy "mro_receipts_read" on storage.objects
  for select to authenticated
  using (bucket_id = 'mro-receipts' and (public.mro_can_bill() or owner = auth.uid()));
create policy "mro_receipts_insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'mro-receipts' and (public.mro_can_bill() or public.mro_can_capture()));
create policy "mro_receipts_update" on storage.objects
  for update to authenticated
  using (bucket_id = 'mro-receipts' and (public.mro_can_bill() or owner = auth.uid()))
  with check (bucket_id = 'mro-receipts' and (public.mro_can_bill() or owner = auth.uid()));
create policy "mro_receipts_delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'mro-receipts' and (public.mro_can_bill() or owner = auth.uid()));
