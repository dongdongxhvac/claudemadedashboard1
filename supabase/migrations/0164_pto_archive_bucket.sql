-- Migration 0164 — private bucket for archived PTO records.
--
-- (user, 2026-11-18) The old OnTheClock PTO summaries (one .xlsx per UPark
-- engineer, exported 2026-11-18) are kept as one zip the manager can
-- download from the PTO panel ("otc old records", next to the pending
-- count). They are personnel records and this repository is public, so the
-- file lives in a PRIVATE storage bucket — never in web/public — and is
-- served through a short-lived signed URL.
--
-- Read + write: managers / admins / directors only (current_user_is_manager).
-- Path convention: <site>/<file>, e.g. upark/otc-old-records.zip.

insert into storage.buckets (id, name, public, file_size_limit)
values ('pto-archive', 'pto-archive', false, 52428800)
on conflict (id) do nothing;

drop policy if exists pto_archive_read   on storage.objects;
drop policy if exists pto_archive_insert on storage.objects;
drop policy if exists pto_archive_update on storage.objects;
drop policy if exists pto_archive_delete on storage.objects;

create policy pto_archive_read on storage.objects
  for select to authenticated
  using (bucket_id = 'pto-archive' and current_user_is_manager());

create policy pto_archive_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'pto-archive' and current_user_is_manager());

create policy pto_archive_update on storage.objects
  for update to authenticated
  using      (bucket_id = 'pto-archive' and current_user_is_manager())
  with check (bucket_id = 'pto-archive' and current_user_is_manager());

create policy pto_archive_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'pto-archive' and current_user_is_manager());
