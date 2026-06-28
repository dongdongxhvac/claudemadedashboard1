-- Migration 0086 — MRO Billing Phase 2: private receipt storage bucket.
--
-- Receipts are client billing records → PRIVATE bucket, read only via
-- short-lived signed URLs. Storage access mirrors the table RLS: admin +
-- manager only, via the same mro_can_bill() gate. Image types only, 15 MB
-- cap (phone receipt photos).

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'mro-receipts', 'mro-receipts', false, 15728640,
  array['image/jpeg','image/png','image/webp','image/heic','image/heif']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "mro_receipts_read"   on storage.objects;
drop policy if exists "mro_receipts_insert" on storage.objects;
drop policy if exists "mro_receipts_update" on storage.objects;
drop policy if exists "mro_receipts_delete" on storage.objects;

create policy "mro_receipts_read" on storage.objects
  for select to authenticated
  using (bucket_id = 'mro-receipts' and public.mro_can_bill());

create policy "mro_receipts_insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'mro-receipts' and public.mro_can_bill());

create policy "mro_receipts_update" on storage.objects
  for update to authenticated
  using (bucket_id = 'mro-receipts' and public.mro_can_bill())
  with check (bucket_id = 'mro-receipts' and public.mro_can_bill());

create policy "mro_receipts_delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'mro-receipts' and public.mro_can_bill());
