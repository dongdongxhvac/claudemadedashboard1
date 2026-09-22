// Certifications / licenses per person (migration 0133): the profile's
// Milestones & certifications card and the roster's expiring line. Scanned
// files live in the PRIVATE 'certifications' bucket at <user_id>/<uuid>.<ext>
// (the storage policies resolve the person from that path) and are read via
// short-lived signed URLs, like MRO receipts (useMroBilling.ts).
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useMe } from './useMe';
import type { CertificationRow } from '../lib/careerTimeline';

export const CERT_BUCKET = 'certifications';
const KEY = ['certifications'];
const TIMELINE_KEY = ['career_timeline'];

export function useCertifications(userId: string | undefined) {
  return useQuery({
    queryKey: [...KEY, userId],
    enabled: !!userId,
    staleTime: 30_000,
    queryFn: async (): Promise<CertificationRow[]> => {
      const { data, error } = await supabase
        .from('certifications')
        .select('*')
        .eq('user_id', userId!)
        .order('expires_on', { ascending: true, nullsFirst: false })
        .order('issued_on', { ascending: false });
      if (error) throw error;
      return (data ?? []) as CertificationRow[];
    },
  });
}

/** Every certification the viewer may see (roster: one fetch, grouped by person). */
export function useCertificationsAll() {
  return useQuery({
    queryKey: [...KEY, 'all'],
    staleTime: 60_000,
    queryFn: async (): Promise<Map<string, CertificationRow[]>> => {
      const { data, error } = await supabase.from('certifications').select('*');
      if (error) throw error;
      const m = new Map<string, CertificationRow[]>();
      for (const r of (data ?? []) as CertificationRow[]) {
        const arr = m.get(r.user_id) ?? [];
        arr.push(r);
        m.set(r.user_id, arr);
      }
      return m;
    },
  });
}

function useInvalidate() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: KEY });
    qc.invalidateQueries({ queryKey: TIMELINE_KEY });
  };
}

export type CertificationInput = {
  user_id: string; name: string; issuer?: string | null; number?: string | null;
  issued_on?: string | null; expires_on?: string | null; note?: string | null;
};

const extOf = (file: File) => {
  const fromName = file.name.split('.').pop()?.toLowerCase();
  if (fromName && /^[a-z0-9]{2,5}$/.test(fromName)) return fromName;
  return file.type === 'application/pdf' ? 'pdf' : file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg';
};

/** Insert or update a certification; an attached file replaces the old one. */
export function useUpsertCertification() {
  const inv = useInvalidate();
  const me = useMe().data;
  return useMutation({
    mutationFn: async (input: { id?: string; row: CertificationInput; file?: File | null; removeFile?: boolean }) => {
      const clean = {
        user_id: input.row.user_id,
        name: input.row.name.trim(),
        issuer: input.row.issuer?.trim() || null,
        number: input.row.number?.trim() || null,
        issued_on: input.row.issued_on || null,
        expires_on: input.row.expires_on || null,
        note: input.row.note?.trim() || null,
      };
      if (!clean.name) throw new Error('Name is required.');
      let file_path: string | null | undefined;
      if (input.file) {
        const path = `${clean.user_id}/${crypto.randomUUID()}.${extOf(input.file)}`;
        const up = await supabase.storage.from(CERT_BUCKET).upload(path, input.file, { contentType: input.file.type || undefined, upsert: false });
        if (up.error) throw new Error(`File upload failed: ${up.error.message}`);
        file_path = path;
      } else if (input.removeFile) {
        file_path = null;
      }
      const patch = { ...clean, created_by: me?.id ?? null, ...(file_path !== undefined ? { file_path } : {}) };
      let oldPath: string | null = null;
      if (input.id) {
        if (file_path !== undefined) {
          const { data: prev } = await supabase.from('certifications').select('file_path').eq('id', input.id).maybeSingle();
          oldPath = (prev as { file_path: string | null } | null)?.file_path ?? null;
        }
        const { created_by: _cb, ...upd } = patch;
        void _cb;
        const { data, error } = await supabase.from('certifications').update(upd).eq('id', input.id).select('id');
        if (error) throw error;
        if (!data?.length) throw new Error('Not permitted to edit this certification.');
      } else {
        const { data, error } = await supabase.from('certifications').insert(patch).select('id');
        if (error) throw error;
        if (!data?.length) throw new Error('Not permitted to add certifications for this person.');
      }
      // best-effort cleanup of the replaced / removed file
      if (oldPath && oldPath !== file_path) await supabase.storage.from(CERT_BUCKET).remove([oldPath]).catch(() => undefined);
    },
    onSuccess: inv,
  });
}

export function useDeleteCertification() {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: async (row: { id: string; file_path: string | null }) => {
      const { data, error } = await supabase.from('certifications').delete().eq('id', row.id).select('id');
      if (error) throw error;
      if (!data?.length) throw new Error('Not permitted to delete this certification.');
      if (row.file_path) await supabase.storage.from(CERT_BUCKET).remove([row.file_path]).catch(() => undefined);
    },
    onSuccess: inv,
  });
}

/** Short-lived signed URL for a stored certificate file (null when none). */
export function useCertificationFileUrl(filePath: string | null | undefined, expiresInSeconds = 600) {
  return useQuery({
    queryKey: ['certification_file_url', filePath, expiresInSeconds],
    enabled: !!filePath,
    staleTime: Math.max(0, expiresInSeconds - 60) * 1000,
    queryFn: async (): Promise<string | null> => {
      if (!filePath) return null;
      const { data, error } = await supabase.storage.from(CERT_BUCKET).createSignedUrl(filePath, expiresInSeconds);
      if (error) throw error;
      return data?.signedUrl ?? null;
    },
  });
}
