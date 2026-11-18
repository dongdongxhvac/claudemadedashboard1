// "otc old records" link in the UPark PTO panel's Balances header, right
// after "Export .xlsx" (user 2026-11-18). UPark only.
//
// Downloads one zip of the old OnTheClock PTO summaries (a .xlsx per
// engineer, exported 2026-11-18). These are personnel records and the repo
// is public, so the zip is NOT a site file: it sits in the private
// `pto-archive` storage bucket (migration 0164, managers only) and is
// fetched through a 60-second signed URL. Until the zip has been uploaded
// the link offers a manager a file picker to upload it once.
import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

const BUCKET = 'pto-archive';
const FOLDER = 'upark';
const FILE = 'otc-old-records.zip';
const PATH = `${FOLDER}/${FILE}`;
const DOWNLOAD_NAME = 'ontheclock PTO records by Nov 18 2026.zip';
const KEY = ['pto_archive', PATH];

export function OtcOldRecordsLink() {
  const qc = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  // Non-managers get an empty listing (RLS) — the link stays hidden for them.
  const existsQ = useQuery({
    queryKey: KEY,
    queryFn: async (): Promise<boolean> => {
      const { data, error } = await supabase.storage.from(BUCKET).list(FOLDER, { search: FILE });
      if (error) throw error;
      return (data ?? []).some((f) => f.name === FILE);
    },
    staleTime: 5 * 60_000,
    retry: false,
  });

  const download = async () => {
    setBusy(true);
    try {
      const { data, error } = await supabase.storage
        .from(BUCKET).createSignedUrl(PATH, 60, { download: DOWNLOAD_NAME });
      if (error) throw error;
      const a = document.createElement('a');
      a.href = data.signedUrl;
      a.download = DOWNLOAD_NAME;
      a.click();
    } catch (e) {
      alert(`Download failed: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const upload = async (file: File) => {
    setBusy(true);
    try {
      const { error } = await supabase.storage
        .from(BUCKET).upload(PATH, file, { contentType: 'application/zip', upsert: true });
      if (error) throw error;
      await qc.invalidateQueries({ queryKey: KEY });
    } catch (e) {
      alert(`Upload failed: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  // Bucket missing / no access → nothing to show.
  if (existsQ.isLoading || existsQ.error) return null;
  const exists = existsQ.data === true;

  return (
    <>
      <button
        type="button"
        onClick={() => (exists ? download() : inputRef.current?.click())}
        disabled={busy}
        className={`${exists ? 't-accent' : 't-muted'} hover:underline ml-3`}
        style={{ textTransform: 'none', fontWeight: 600, letterSpacing: 0 }}
        title={exists
          ? 'Download the old OnTheClock PTO records (zip, one spreadsheet per engineer, as of Nov 18 2026). Managers only.'
          : 'Not uploaded yet — click to upload the OnTheClock PTO records zip. Managers only.'}
      >
        {busy ? '…' : exists ? '⤓ otc old records' : 'otc old records (upload zip)'}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept=".zip,application/zip"
        style={{ display: 'none' }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) void upload(f);
        }}
      />
    </>
  );
}
