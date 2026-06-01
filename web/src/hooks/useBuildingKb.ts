// Phase 14 — Building Knowledge Base read/write hooks.
//
// Two tables: building_section_notes (free-form per-category text) and
// building_equipment (structured per-asset records). All authenticated
// users SELECT; admin OR is_lead INSERT/UPDATE/DELETE — server-side via
// RLS using current_user_can_edit_kb().
import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

export const SECTION_KEYS = [
  'overview',
  'mechanical',
  'control',
  'electrical',
  'plumbing',
  'inventory',
  'access',
  'troubleshooting',
] as const;
export type SectionKey = (typeof SECTION_KEYS)[number];

/** Friendly labels for the tab strip. */
export const SECTION_LABELS: Record<SectionKey, string> = {
  overview:        'Overview',
  mechanical:      'Mechanical',
  control:         'Control',
  electrical:      'Electrical',
  plumbing:        'Plumbing',
  inventory:       'Inventory',
  access:          'Access',
  troubleshooting: 'Troubleshooting',
};

export type BuildingSectionNote = {
  building_id: string;
  section_key: SectionKey;
  body: string;
  updated_at: string;
  updated_by: string | null;
};

export const EQUIPMENT_CATEGORIES = [
  'chiller_plant',
  'boiler_plant',
  'compressed_air',
  'vacuum_air',
  'rodi',
  'plumbing',
  'control',
  'electrical',
] as const;
export type EquipmentCategory = (typeof EQUIPMENT_CATEGORIES)[number];

/** Friendly labels for the category dropdown. Match the wording the
 *  engineer uses in the field, not the slug. */
export const EQUIPMENT_CATEGORY_LABELS: Record<EquipmentCategory, string> = {
  chiller_plant:  'Chiller plant',
  boiler_plant:   'Boiler plant',
  compressed_air: 'cAIR',
  vacuum_air:     'vAir',
  rodi:           'RODI',
  plumbing:       'Plumbing',
  control:        'Control',
  electrical:     'Electrical',
};

export const EQUIPMENT_STATUSES = [
  'operational',
  'standby_auto',
  'defaulted',
  'off_pm',
  'down_cm',
] as const;
export type EquipmentStatus = (typeof EQUIPMENT_STATUSES)[number];

export const EQUIPMENT_STATUS_LABELS: Record<EquipmentStatus, string> = {
  operational:  'Operational',
  standby_auto: 'Standby auto',
  defaulted:    'Defaulted',
  off_pm:       'Off — PM',
  down_cm:      'Down — CM',
};

/** Color band for the equipment row. Green = good, amber = degraded but
 *  running, red = needs attention. Drives row tint + status pill color
 *  + §10.1 / TV alarm panel inclusion. */
export function equipmentStatusTone(s: EquipmentStatus): 'good' | 'warn' | 'bad' {
  if (s === 'operational' || s === 'standby_auto') return 'good';
  if (s === 'defaulted') return 'warn';
  return 'bad';   // off_pm, down_cm
}

export type BuildingEquipment = {
  id: string;
  building_id: string;
  full_name: string;
  short_name: string | null;
  category: EquipmentCategory | null;
  location_note: string | null;
  parts_notes: string | null;
  common_issues: string | null;
  troubleshooting: string | null;
  photo_url: string | null;
  status: EquipmentStatus;
  status_detail: string | null;
  status_date: string | null;     // YYYY-MM-DD
  wo_number: string | null;
  rsp: string | null;
  last_status_change_at: string;  // timestamptz
  active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
  updated_by: string | null;
};

export type BuildingEquipmentStatusRow = {
  id: string;
  building_id: string;
  building_short_code: string | null;
  building_name: string;
  full_name: string;
  short_name: string | null;
  category: EquipmentCategory | null;
  status: EquipmentStatus;
  status_detail: string | null;
  status_date: string | null;
  wo_number: string | null;
  rsp: string | null;
  last_status_change_at: string;
};

export const PART_TYPES = ['filter','belt','oil','seal','bearing','fuse','sensor','other'] as const;
export type PartType = (typeof PART_TYPES)[number];

export type BuildingPart = {
  id: string;
  building_id: string;
  equipment_id: string | null;
  name: string;
  part_type: PartType | null;
  spec: string | null;
  quantity: number | null;
  location_note: string | null;
  sort_order: number;
  active: boolean;
  created_at: string;
  updated_at: string;
  updated_by: string | null;
};

export const VISIT_TYPES = ['escort','PM','CM'] as const;
export type VisitType = (typeof VISIT_TYPES)[number];

export type BuildingVendorVisit = {
  id: string;
  building_id: string;
  vendor_name: string;
  visit_type: VisitType;
  visit_date: string;     // YYYY-MM-DD
  note: string | null;
  logged_by: string | null;
  created_at: string;
};

export type KbSearchHit = {
  building_id: string;
  building_short_code: string | null;
  building_name: string;
  kind: 'equipment' | 'part' | 'section';
  entity_id: string | null;
  title: string;
  body: string | null;
};

const sectionKey = (buildingId: string) => ['building_section_notes', buildingId];
const equipmentKey = (buildingId: string) => ['building_equipment', buildingId];

/** Fetch all section notes for a building. Returns whatever rows exist —
 *  missing sections are treated as empty strings client-side. */
export function useBuildingSections(buildingId: string | null | undefined) {
  return useQuery({
    queryKey: sectionKey(buildingId ?? ''),
    queryFn: async (): Promise<BuildingSectionNote[]> => {
      if (!buildingId) return [];
      const { data, error } = await supabase
        .from('building_section_notes')
        .select('*')
        .eq('building_id', buildingId);
      if (error) throw error;
      return (data ?? []) as BuildingSectionNote[];
    },
    staleTime: 60_000,
    enabled: !!buildingId,
  });
}

/** Fetch all active equipment for a building, ordered by sort_order. */
export function useBuildingEquipment(buildingId: string | null | undefined) {
  return useQuery({
    queryKey: equipmentKey(buildingId ?? ''),
    queryFn: async (): Promise<BuildingEquipment[]> => {
      if (!buildingId) return [];
      const { data, error } = await supabase
        .from('building_equipment')
        .select('*')
        .eq('building_id', buildingId)
        .eq('active', true)
        .order('sort_order', { ascending: true })
        .order('name', { ascending: true });
      if (error) throw error;
      return (data ?? []) as BuildingEquipment[];
    },
    staleTime: 60_000,
    enabled: !!buildingId,
  });
}

/** Realtime: invalidate both queries on any change to the KB tables for
 *  this building. Unique channel name per hook instance to avoid the
 *  "cannot add postgres_changes callbacks after subscribe()" crash. */
export function useBuildingKbRealtime(buildingId: string | null | undefined) {
  const qc = useQueryClient();
  useEffect(() => {
    if (!buildingId) return;
    const channel = supabase
      .channel(`bkb-${buildingId}-${crypto.randomUUID()}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'building_section_notes', filter: `building_id=eq.${buildingId}` },
        () => qc.invalidateQueries({ queryKey: sectionKey(buildingId) }),
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'building_equipment', filter: `building_id=eq.${buildingId}` },
        () => qc.invalidateQueries({ queryKey: equipmentKey(buildingId) }),
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [qc, buildingId]);
}

/** Upsert one section's body. Server RLS rejects if user lacks edit rights. */
export function useUpsertBuildingSection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { building_id: string; section_key: SectionKey; body: string }) => {
      const { data, error } = await supabase
        .from('building_section_notes')
        .upsert(
          {
            building_id: input.building_id,
            section_key: input.section_key,
            body: input.body,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'building_id,section_key' },
        )
        .select()
        .single();
      if (error) throw error;
      return data as BuildingSectionNote;
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: sectionKey(vars.building_id) });
    },
  });
}

/** Insert OR update a building_equipment row. Pass id to update, omit to insert. */
export function useUpsertBuildingEquipment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (
      input: Partial<BuildingEquipment> & { building_id: string; full_name: string },
    ) => {
      const row = { ...input, updated_at: new Date().toISOString() };
      const { data, error } = await supabase
        .from('building_equipment')
        .upsert(row, { onConflict: 'id' })
        .select()
        .single();
      if (error) throw error;
      return data as BuildingEquipment;
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: equipmentKey(vars.building_id) });
    },
  });
}

/** Equipment currently in off_pm or down_cm status, joined with the
 *  parent building for compact rendering. Drives §10.1 (manager view)
 *  + the equipment-down stripe on the TV BMS alarms panel. */
export function useBuildingEquipmentDown() {
  return useQuery({
    queryKey: ['building_equipment_status_down'],
    queryFn: async (): Promise<BuildingEquipmentStatusRow[]> => {
      const { data, error } = await supabase
        .from('v_building_equipment_status')
        .select('*')
        .order('last_status_change_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as BuildingEquipmentStatusRow[];
    },
    staleTime: 30_000,
  });
}

/** Realtime: invalidate the equipment-down list whenever ANY building_equipment
 *  row changes (status updates can drop rows in/out of the view). */
export function useBuildingEquipmentDownRealtime() {
  const qc = useQueryClient();
  useEffect(() => {
    const channel = supabase
      .channel(`be-down-${crypto.randomUUID()}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'building_equipment' },
        () => qc.invalidateQueries({ queryKey: ['building_equipment_status_down'] }),
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [qc]);
}

/** Soft-delete: flip active=false so historical references survive. */
export function useDeleteBuildingEquipment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; building_id: string }) => {
      const { error } = await supabase
        .from('building_equipment')
        .update({ active: false, updated_at: new Date().toISOString() })
        .eq('id', input.id);
      if (error) throw error;
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: equipmentKey(vars.building_id) });
    },
  });
}

// ----- Parts --------------------------------------------------------------

const partsKey = (buildingId: string) => ['building_parts', buildingId];

export function useBuildingParts(buildingId: string | null | undefined) {
  return useQuery({
    queryKey: partsKey(buildingId ?? ''),
    queryFn: async (): Promise<BuildingPart[]> => {
      if (!buildingId) return [];
      const { data, error } = await supabase
        .from('building_parts')
        .select('*')
        .eq('building_id', buildingId)
        .eq('active', true)
        .order('sort_order', { ascending: true })
        .order('name', { ascending: true });
      if (error) throw error;
      return (data ?? []) as BuildingPart[];
    },
    staleTime: 60_000,
    enabled: !!buildingId,
  });
}

export function useUpsertBuildingPart() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (
      input: Partial<BuildingPart> & { building_id: string; name: string },
    ) => {
      const row = { ...input, updated_at: new Date().toISOString() };
      const { data, error } = await supabase
        .from('building_parts')
        .upsert(row, { onConflict: 'id' })
        .select()
        .single();
      if (error) throw error;
      return data as BuildingPart;
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: partsKey(vars.building_id) });
    },
  });
}

export function useDeleteBuildingPart() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; building_id: string }) => {
      const { error } = await supabase
        .from('building_parts')
        .update({ active: false, updated_at: new Date().toISOString() })
        .eq('id', input.id);
      if (error) throw error;
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: partsKey(vars.building_id) });
    },
  });
}

// ----- Vendor visits ------------------------------------------------------

const visitsKey = (buildingId: string) => ['building_vendor_visits', buildingId];

export function useBuildingVendorVisits(buildingId: string | null | undefined, daysBack = 90) {
  return useQuery({
    queryKey: [...visitsKey(buildingId ?? ''), daysBack],
    queryFn: async (): Promise<BuildingVendorVisit[]> => {
      if (!buildingId) return [];
      const since = new Date();
      since.setDate(since.getDate() - daysBack);
      const sinceStr = since.toISOString().slice(0, 10);
      const { data, error } = await supabase
        .from('building_vendor_visits')
        .select('*')
        .eq('building_id', buildingId)
        .gte('visit_date', sinceStr)
        .order('visit_date', { ascending: false })
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as BuildingVendorVisit[];
    },
    staleTime: 60_000,
    enabled: !!buildingId,
  });
}

/** Distinct vendor names across ALL buildings (last 180d), used as a
 *  type-ahead source for the vendor pre-fill dropdown. */
export function useVendorNameSuggestions() {
  return useQuery({
    queryKey: ['vendor_name_suggestions'],
    queryFn: async (): Promise<string[]> => {
      const since = new Date();
      since.setDate(since.getDate() - 180);
      const sinceStr = since.toISOString().slice(0, 10);
      const { data, error } = await supabase
        .from('building_vendor_visits')
        .select('vendor_name')
        .gte('visit_date', sinceStr)
        .limit(2000);
      if (error) throw error;
      const seen = new Set<string>();
      for (const r of (data ?? []) as { vendor_name: string }[]) {
        const v = (r.vendor_name ?? '').trim();
        if (v) seen.add(v);
      }
      return Array.from(seen).sort((a, b) => a.localeCompare(b));
    },
    staleTime: 5 * 60_000,
  });
}

export function useInsertVendorVisit() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      building_id: string;
      vendor_name: string;
      visit_type: VisitType;
      visit_date: string;
      note?: string | null;
    }) => {
      // Pull the caller's users row id to stamp logged_by.
      const { data: auth } = await supabase.auth.getUser();
      let logged_by: string | null = null;
      if (auth.user) {
        const { data: u } = await supabase
          .from('users')
          .select('id')
          .eq('auth_user_id', auth.user.id)
          .maybeSingle();
        logged_by = u?.id ?? null;
      }
      const { data, error } = await supabase
        .from('building_vendor_visits')
        .insert({
          building_id: input.building_id,
          vendor_name: input.vendor_name.trim(),
          visit_type: input.visit_type,
          visit_date: input.visit_date,
          note: input.note?.trim() || null,
          logged_by,
        })
        .select()
        .single();
      if (error) throw error;
      return data as BuildingVendorVisit;
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: visitsKey(vars.building_id) });
      qc.invalidateQueries({ queryKey: ['vendor_name_suggestions'] });
    },
  });
}

export function useDeleteVendorVisit() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; building_id: string }) => {
      const { error } = await supabase
        .from('building_vendor_visits')
        .delete()
        .eq('id', input.id);
      if (error) throw error;
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: visitsKey(vars.building_id) });
    },
  });
}

// ----- Cross-building search ---------------------------------------------

export function useKbSearch(query: string, enabled = true) {
  return useQuery({
    queryKey: ['kb_search', query],
    queryFn: async (): Promise<KbSearchHit[]> => {
      const q = query.trim();
      if (q.length < 2) return [];
      // PostgREST: ilike with %wrap% on title OR body. We can't do a single
      // OR across two columns trivially in the query string, so two queries
      // unioned client-side keeps the wire-level query simple.
      const wrap = `%${q.replace(/[%_]/g, (m) => `\\${m}`)}%`;
      const [a, b] = await Promise.all([
        supabase.from('v_buildings_kb_search').select('*').ilike('title', wrap).limit(40),
        supabase.from('v_buildings_kb_search').select('*').ilike('body',  wrap).limit(40),
      ]);
      if (a.error) throw a.error;
      if (b.error) throw b.error;
      const seen = new Set<string>();
      const rows: KbSearchHit[] = [];
      for (const r of [...(a.data ?? []), ...(b.data ?? [])] as KbSearchHit[]) {
        const key = `${r.kind}|${r.entity_id ?? r.title}|${r.building_id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        rows.push(r);
      }
      return rows.slice(0, 60);
    },
    staleTime: 30_000,
    enabled: enabled && query.trim().length >= 2,
  });
}

// ----- Photo upload helpers ----------------------------------------------

/** Upload a file to the building-kb-photos bucket. Returns the public URL.
 *  Path layout: equipment/{equipment_id}/{timestamp}-{filename}. */
export async function uploadEquipmentPhoto(
  equipmentId: string,
  file: File,
): Promise<string> {
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const path = `equipment/${equipmentId}/${Date.now()}-${safeName}`;
  const { error } = await supabase.storage
    .from('building-kb-photos')
    .upload(path, file, {
      cacheControl: '31536000',
      upsert: false,
      contentType: file.type || undefined,
    });
  if (error) throw error;
  const { data } = supabase.storage
    .from('building-kb-photos')
    .getPublicUrl(path);
  return data.publicUrl;
}
