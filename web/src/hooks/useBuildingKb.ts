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

export type BuildingEquipment = {
  id: string;
  building_id: string;
  name: string;
  category: 'mechanical' | 'control' | 'electrical' | 'plumbing' | 'other' | null;
  location_note: string | null;
  parts_notes: string | null;
  common_issues: string | null;
  troubleshooting: string | null;
  active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
  updated_by: string | null;
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
      input: Partial<BuildingEquipment> & { building_id: string; name: string },
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
