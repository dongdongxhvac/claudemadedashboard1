// Work records — engineers record their own day-to-day; leads verify.
// Backed by migration 0134 (work_records, ot_availability, bucket
// 'work-records'). Read by the engineer profile page (Buildings grid, record
// list, training rows, OT availability) and written from the engineer's own
// page ("My record") or by a lead/manager on the profile.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

export type WorkRecordKind = 'knowledge' | 'skill' | 'problem' | 'major_pm' | 'training';
export type Independence = 'with_lead' | 'solo' | 'solo_clean';
export type WorkRecordStatus = 'self' | 'verified';

export const KIND_LABELS: Record<WorkRecordKind, string> = {
  knowledge: 'Knowledge',
  skill:     'Skill',
  problem:   'Problem solving',
  major_pm:  'Major PM / off-hour repair',
  training:  'Training',
};
export const KIND_ORDER: WorkRecordKind[] = ['knowledge', 'skill', 'problem', 'major_pm', 'training'];

export const INDEPENDENCE_LABELS: Record<Independence, string> = {
  with_lead:  'With lead',
  solo:       'Solo',
  solo_clean: 'Solo, no interruption',
};
export const INDEPENDENCE_ORDER: Independence[] = ['with_lead', 'solo', 'solo_clean'];

/** Kinds that carry an independence mark. Knowledge / training don't. */
export function kindHasIndependence(k: WorkRecordKind): boolean {
  return k === 'skill' || k === 'problem' || k === 'major_pm';
}

/** Fixed task rows the profile grid always shows (plus anything else that
 *  turns up in records). Also the datalist suggestions in the form. */
export const TASK_SUGGESTIONS: Record<WorkRecordKind, string[]> = {
  knowledge: [
    'HVAC mechanical set-up — explained in office (hand drawing)',
    'HVAC mechanical set-up — plant walk with lead',
    'Electrical — MCC, ATS, breakers',
    'Plumbing — RO, sand filters, backflow',
    'BMS — points, schedules, alarms',
  ],
  skill: [
    'Cooling tower cleaning support',
    'Motor & pump rebuild',
    'Motor & pump alignment',
    'BMS operation',
    'Chiller switch-over',
    'Boiler start-up / shutdown',
    'Sand filter isolation',
    'Water treatment test',
    'Generator / load-bank test',
  ],
  problem: [
    'VFD fault troubleshooting',
    'Freezestat trip diagnosis',
    'No-SOP problem solved',
    'Alarm response — found root cause',
  ],
  major_pm: [
    'Major off-hour PM',
    'Off-hour repair',
    'Cold weather coverage',
    'Power outage response',
  ],
  training: [
    'New-hire 8-week program',
    'Cooling tower cleaning & water treatment',
    'Generator / load-bank test SOP',
    'On-call SOP',
    'OSHA 10',
    'EPA 608',
  ],
};

export type WorkRecord = {
  id: string;
  user_id: string;
  occurred_on: string;              // YYYY-MM-DD
  building_id: string | null;
  building_code: string | null;     // short_code ?? code
  building_name: string | null;
  kind: WorkRecordKind;
  task: string;
  independence: Independence | null;
  note: string | null;
  photo_path: string | null;
  status: WorkRecordStatus;
  verified_by: string | null;
  verified_by_name: string | null;
  verified_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

const KEY = (userId: string | undefined) => ['work_records', userId];
const BUCKET = 'work-records';

type Row = Omit<WorkRecord, 'building_code' | 'building_name' | 'verified_by_name'> & {
  building: { id: string; code: string; short_code: string | null; name: string } | { id: string; code: string; short_code: string | null; name: string }[] | null;
  verifier: { full_name: string } | { full_name: string }[] | null;
};
function one<T>(v: T | T[] | null): T | null { return Array.isArray(v) ? (v[0] ?? null) : v; }

export function useWorkRecords(userId: string | undefined) {
  return useQuery({
    queryKey: KEY(userId),
    enabled: !!userId,
    queryFn: async (): Promise<WorkRecord[]> => {
      const { data, error } = await supabase
        .from('work_records')
        .select('*, building:buildings(id, code, short_code, name), verifier:users!work_records_verified_by_fkey(full_name)')
        .eq('user_id', userId!)
        .order('occurred_on', { ascending: false })
        .order('created_at', { ascending: false });
      if (error) throw error;
      return ((data ?? []) as unknown as Row[]).map((r) => {
        const b = one(r.building);
        const v = one(r.verifier);
        const { building: _b, verifier: _v, ...rest } = r;
        void _b; void _v;
        return {
          ...rest,
          building_code: b ? (b.short_code ?? b.code) : null,
          building_name: b?.name ?? null,
          verified_by_name: v?.full_name ?? null,
        };
      });
    },
    staleTime: 15_000,
  });
}

async function myUsersId(): Promise<string> {
  const auth = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from('users').select('id').eq('auth_user_id', auth.data.user?.id ?? '').maybeSingle();
  if (error) throw error;
  if (!data?.id) throw new Error('Your account is not linked to a user row.');
  return data.id as string;
}

export type UpsertWorkRecordInput = {
  id?: string;
  user_id: string;
  occurred_on: string;
  building_id: string | null;
  kind: WorkRecordKind;
  task: string;
  independence: Independence | null;
  note: string | null;
  file?: File | null;
  removePhoto?: boolean;
  /** Lead/manager recording for someone: insert straight to 'verified'. */
  verifyNow?: boolean;
};

export function useUpsertWorkRecord() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: UpsertWorkRecordInput) => {
      const me = await myUsersId();
      let photo_path: string | null | undefined = undefined;
      let oldPath: string | null = null;
      if (input.id) {
        const { data: prev } = await supabase.from('work_records').select('photo_path').eq('id', input.id).maybeSingle();
        oldPath = (prev?.photo_path as string | null) ?? null;
      }
      if (input.file) {
        const ext = (input.file.name.split('.').pop() || 'jpg').toLowerCase();
        const path = `${input.user_id}/${crypto.randomUUID()}.${ext}`;
        const up = await supabase.storage.from(BUCKET).upload(path, input.file, { contentType: input.file.type || undefined, upsert: false });
        if (up.error) throw up.error;
        photo_path = path;
      } else if (input.removePhoto) {
        photo_path = null;
      }
      const base = {
        user_id:      input.user_id,
        occurred_on:  input.occurred_on,
        building_id:  input.building_id,
        kind:         input.kind,
        task:         input.task.trim(),
        independence: kindHasIndependence(input.kind) ? input.independence : null,
        note:         input.note?.trim() || null,
        ...(photo_path !== undefined ? { photo_path } : {}),
      };
      const stamp = input.verifyNow
        ? { status: 'verified' as const, verified_by: me, verified_at: new Date().toISOString() }
        : {};
      if (input.id) {
        const { data, error } = await supabase.from('work_records').update({ ...base, ...stamp }).eq('id', input.id).select('id');
        if (error) throw error;
        if (!data?.length) throw new Error('Not allowed to edit this entry.');
      } else {
        const { data, error } = await supabase.from('work_records')
          .insert({ ...base, created_by: me, ...(input.verifyNow ? stamp : { status: 'self' }) })
          .select('id');
        if (error) throw error;
        if (!data?.length) throw new Error('Not allowed to add this entry.');
      }
      if (oldPath && photo_path !== undefined && oldPath !== photo_path) {
        await supabase.storage.from(BUCKET).remove([oldPath]).catch(() => undefined);
      }
    },
    onSuccess: (_d, v) => qc.invalidateQueries({ queryKey: KEY(v.user_id) }),
  });
}

export function useVerifyWorkRecord() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (r: Pick<WorkRecord, 'id' | 'user_id'> & { verified: boolean }) => {
      const me = await myUsersId();
      const patch = r.verified
        ? { status: 'verified', verified_by: me, verified_at: new Date().toISOString() }
        : { status: 'self', verified_by: null, verified_at: null };
      const { data, error } = await supabase.from('work_records').update(patch).eq('id', r.id).select('id');
      if (error) throw error;
      if (!data?.length) throw new Error('Not allowed to verify this entry.');
    },
    onSuccess: (_d, v) => qc.invalidateQueries({ queryKey: KEY(v.user_id) }),
  });
}

export function useDeleteWorkRecord() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (r: Pick<WorkRecord, 'id' | 'user_id' | 'photo_path'>) => {
      const { data, error } = await supabase.from('work_records').delete().eq('id', r.id).select('id');
      if (error) throw error;
      if (!data?.length) throw new Error('Not allowed to delete this entry.');
      if (r.photo_path) await supabase.storage.from(BUCKET).remove([r.photo_path]).catch(() => undefined);
    },
    onSuccess: (_d, v) => qc.invalidateQueries({ queryKey: KEY(v.user_id) }),
  });
}

/** Signed URL for a record photo (private bucket). */
export function useWorkRecordPhotoUrl(path: string | null | undefined, expiresInSeconds = 600) {
  return useQuery({
    queryKey: ['work_record_photo', path],
    enabled: !!path,
    queryFn: async () => {
      const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path!, expiresInSeconds);
      if (error) throw error;
      return data.signedUrl;
    },
    staleTime: (expiresInSeconds - 60) * 1000,
  });
}

// ── OT availability ───────────────────────────────────────────────────────

export type OtDay = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';
export const OT_DAYS: { key: OtDay; label: string }[] = [
  { key: 'mon', label: 'M' }, { key: 'tue', label: 'Tu' }, { key: 'wed', label: 'W' }, { key: 'thu', label: 'Th' },
  { key: 'fri', label: 'F' }, { key: 'sat', label: 'Sa' }, { key: 'sun', label: 'Su' },
];
export type OtAvailability = {
  user_id: string;
  days: OtDay[];
  nights: boolean;
  early: boolean;
  notice: string | null;
  note: string | null;
  updated_at: string;
};

export function useOtAvailability(userId: string | undefined) {
  return useQuery({
    queryKey: ['ot_availability', userId],
    enabled: !!userId,
    queryFn: async (): Promise<OtAvailability | null> => {
      const { data, error } = await supabase.from('ot_availability').select('*').eq('user_id', userId!).maybeSingle();
      if (error) throw error;
      return (data as OtAvailability | null) ?? null;
    },
    staleTime: 30_000,
  });
}

export function useUpsertOtAvailability() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: Omit<OtAvailability, 'updated_at'>) => {
      const { data, error } = await supabase.from('ot_availability').upsert(input, { onConflict: 'user_id' }).select('user_id');
      if (error) throw error;
      if (!data?.length) throw new Error('Not allowed to change availability.');
    },
    onSuccess: (_d, v) => qc.invalidateQueries({ queryKey: ['ot_availability', v.user_id] }),
  });
}

// ── OT history (from §11 posts + sign-ups) ────────────────────────────────

export type OtHistoryRow = {
  signup_id: string;
  signed_up_at: string;
  post_id: string;
  category: string;
  starts_at: string;
  ends_at: string | null;
  status: string;            // open | closed | cancelled | completed
  building_label: string | null;
  scope: string;
};

export function useOvertimeHistory(userId: string | undefined) {
  return useQuery({
    queryKey: ['ot_history', userId],
    enabled: !!userId,
    queryFn: async (): Promise<OtHistoryRow[]> => {
      const { data, error } = await supabase
        .from('overtime_signups')
        .select('id, signed_up_at, post:overtime_posts(id, category, starts_at, ends_at, status, building_label, scope, building:buildings(code, short_code))')
        .eq('user_id', userId!);
      if (error) throw error;
      type P = { id: string; category: string; starts_at: string; ends_at: string | null; status: string; building_label: string | null; scope: string; building: { code: string; short_code: string | null } | { code: string; short_code: string | null }[] | null };
      const rows = (data ?? []) as unknown as { id: string; signed_up_at: string; post: P | P[] | null }[];
      return rows.flatMap((r) => {
        const p = one(r.post);
        if (!p) return [];
        const b = one(p.building);
        return [{
          signup_id: r.id, signed_up_at: r.signed_up_at, post_id: p.id, category: p.category,
          starts_at: p.starts_at, ends_at: p.ends_at, status: p.status,
          building_label: b ? (b.short_code ?? b.code) : p.building_label, scope: p.scope,
        }];
      }).sort((a, b) => b.starts_at.localeCompare(a.starts_at));
    },
    staleTime: 30_000,
  });
}
