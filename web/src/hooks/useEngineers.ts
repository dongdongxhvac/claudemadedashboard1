import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

export type Discipline = 'M' | 'E' | 'P' | 'BMS' | 'FLS';
export const DISCIPLINES: { value: Discipline; label: string }[] = [
  { value: 'M',   label: 'Mechanical' },
  { value: 'E',   label: 'Electrical' },
  { value: 'P',   label: 'Plumbing' },
  { value: 'BMS', label: 'Building Mgmt System' },
  { value: 'FLS', label: 'Fire / Life Safety' },
];

export type Role = 'engineer' | 'manager' | 'client' | 'admin';
export const ROLES: { value: Role; label: string }[] = [
  { value: 'engineer', label: 'Engineer' },
  { value: 'manager',  label: 'Manager' },
  { value: 'client',   label: 'Client' },
  { value: 'admin',    label: 'Admin' },
];

export type EngineerRow = {
  user_id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  hiring_date: string | null;
  auth_user_id: string | null;
  active: boolean;
  role: Role;
  cmms_assignee_name: string | null;
  discipline: Discipline | null;
  level: number;
  xp: number;
  visible_to_self: boolean;
  notes: string | null;
  title: string | null;
  shift_id: string | null;
  is_lead: boolean;
  updated_at: string;
};

const KEY_ENGINEERS = ['engineers'];
const KEY_ALL_USERS = ['users_all'];

async function fetchUsers(roleFilter: Role | null): Promise<EngineerRow[]> {
  let q = supabase
    .from('users')
    .select(`
      id, full_name, email, phone, hiring_date, auth_user_id, active, role,
      engineer_profiles!inner (
        cmms_assignee_name, discipline, level, xp,
        visible_to_self, notes, title, shift_id, is_lead, updated_at
      )
    `);
  if (roleFilter) q = q.eq('role', roleFilter);
  const { data, error } = await q.order('full_name');
  if (error) throw error;
  type Profile = {
    cmms_assignee_name: string | null; discipline: Discipline | null;
    level: number; xp: number; visible_to_self: boolean;
    notes: string | null; title: string | null;
    shift_id: string | null; is_lead: boolean;
    updated_at: string;
  };
  type Joined = {
    id: string; full_name: string; email: string | null; phone: string | null;
    hiring_date: string | null;
    auth_user_id: string | null; active: boolean; role: Role;
    engineer_profiles: Profile | Profile[] | null;
  };
  return (data as unknown as Joined[])
    .map((r) => {
      const ep = Array.isArray(r.engineer_profiles)
        ? r.engineer_profiles[0]
        : r.engineer_profiles;
      if (!ep) return null;
      return {
        user_id: r.id,
        full_name: r.full_name,
        email: r.email,
        phone: r.phone,
        hiring_date: r.hiring_date,
        auth_user_id: r.auth_user_id,
        active: r.active,
        role: r.role,
        cmms_assignee_name: ep.cmms_assignee_name,
        discipline: ep.discipline,
        level: ep.level,
        xp: ep.xp,
        visible_to_self: ep.visible_to_self,
        notes: ep.notes,
        title: ep.title,
        shift_id: ep.shift_id,
        is_lead: ep.is_lead,
        updated_at: ep.updated_at,
      } satisfies EngineerRow;
    })
    .filter((r): r is EngineerRow => r !== null);
}

/** All users (any role). Used by the User Profiles admin tab. */
export function useAllUsers() {
  return useQuery({
    queryKey: KEY_ALL_USERS,
    queryFn: () => fetchUsers(null),
    staleTime: 30_000,
  });
}

/** Active or inactive engineers only. Used by BuildingsTab, OncallTab,
 *  EngineerMobile/PC/TV, etc. — places that should never list managers/admins. */
export function useEngineers() {
  return useQuery({
    queryKey: KEY_ENGINEERS,
    queryFn: () => fetchUsers('engineer'),
    staleTime: 30_000,
  });
}

function invalidateUserQueries(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: KEY_ENGINEERS });
  qc.invalidateQueries({ queryKey: KEY_ALL_USERS });
}

export function useUpdateEngineerProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      user_id: string;
      patch: Partial<Pick<EngineerRow, 'discipline' | 'level' | 'notes' | 'visible_to_self' | 'title' | 'shift_id' | 'is_lead' | 'cmms_assignee_name'>>;
    }) => {
      const { error, data } = await supabase
        .from('engineer_profiles')
        .update({ ...input.patch, updated_at: new Date().toISOString() })
        .eq('user_id', input.user_id)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => invalidateUserQueries(qc),
  });
}

/** Update fields that live on public.users (email + phone + role + active). */
export function useUpdateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      user_id: string;
      patch: Partial<Pick<EngineerRow, 'email' | 'phone' | 'role' | 'active' | 'full_name' | 'hiring_date'>>;
    }) => {
      const cleaned: Partial<EngineerRow> = { ...input.patch };
      if (cleaned.email === '') cleaned.email = null;
      if (cleaned.phone === '') cleaned.phone = null;

      const { error, data } = await supabase
        .from('users')
        .update({ ...cleaned, updated_at: new Date().toISOString() })
        .eq('id', input.user_id)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => invalidateUserQueries(qc),
  });
}

/** Create a new user. Inserts public.users (the trigger auto-creates the
 *  engineer_profiles row) then UPSERTs profile fields. */
export function useAddEngineer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      full_name: string;
      cmms_assignee_name: string;
      email?: string | null;
      phone?: string | null;
      hiring_date?: string | null;
      discipline?: Discipline | null;
      role?: Role;
    }) => {
      const { data: u, error: ue } = await supabase
        .from('users')
        .insert({
          full_name: input.full_name.trim(),
          email: input.email?.trim() || null,
          phone: input.phone?.trim() || null,
          hiring_date: input.hiring_date || null,
          role: input.role ?? 'engineer',
          active: true,
        })
        .select()
        .single();
      if (ue) throw ue;

      // Trigger ensure_engineer_profile_trg has already created an empty
      // engineer_profiles row. Update it with cmms_assignee_name + discipline.
      const { error: pe } = await supabase
        .from('engineer_profiles')
        .update({
          cmms_assignee_name: input.cmms_assignee_name.trim() || null,
          discipline: input.discipline ?? null,
          updated_at: new Date().toISOString(),
        })
        .eq('user_id', (u as { id: string }).id);
      if (pe) {
        // Roll back the user insert so we don't leave a half-configured user.
        await supabase.from('users').delete().eq('id', (u as { id: string }).id);
        throw pe;
      }
      return u;
    },
    onSuccess: () => invalidateUserQueries(qc),
  });
}
