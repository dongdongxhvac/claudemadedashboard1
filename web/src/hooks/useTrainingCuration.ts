import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useMe } from './useMe';
import { supabase } from '../lib/supabase';

// Training-view curation = the supervisor's personal "pick what to show" state.
// Stored under users.preferences.training (jsonb). Reads piggyback on the
// existing ['me'] cache — useMe is NOT modified. Writes go through the
// set_my_preferences RPC (migration 0073), because `users` is admin-only-write.
//
// PROMOTABLE: every read/write of curation goes through this one module. To
// promote to a shared org-wide curated set later, swap the internals here for a
// training_curated_items table — no component changes. The data shape mirrors
// that future table 1:1.

export const ALL_SECTIONS = ['buildings', 'roster', 'mirrors', 'drafts'] as const;
export type TrainingSectionKey = (typeof ALL_SECTIONS)[number];

export const SECTION_LABELS: Record<TrainingSectionKey, string> = {
  buildings: 'Curated buildings',
  roster: 'Curated techs',
  mirrors: 'Site mirrors',
  drafts: 'Template drafts',
};

export type TrainingCuration = {
  pinnedBuildingIds: string[];
  pinnedEquipmentIds: string[];
  pinnedTechIds: string[];
  visibleSections: string[];
};

export const DEFAULT_CURATION: TrainingCuration = {
  pinnedBuildingIds: [],
  pinnedEquipmentIds: [],
  pinnedTechIds: [],
  visibleSections: [...ALL_SECTIONS],
};

function coerce(raw: unknown): TrainingCuration {
  const t = (raw ?? {}) as Partial<TrainingCuration>;
  return {
    pinnedBuildingIds: Array.isArray(t.pinnedBuildingIds) ? t.pinnedBuildingIds : [],
    pinnedEquipmentIds: Array.isArray(t.pinnedEquipmentIds) ? t.pinnedEquipmentIds : [],
    pinnedTechIds: Array.isArray(t.pinnedTechIds) ? t.pinnedTechIds : [],
    visibleSections: Array.isArray(t.visibleSections)
      ? t.visibleSections
      : [...ALL_SECTIONS],
  };
}

/** Current curation, derived from the cached ['me'] row. */
export function useTrainingCuration(): { curation: TrainingCuration; isLoading: boolean } {
  const me = useMe();
  const raw = (me.data?.preferences as Record<string, unknown> | undefined)?.training;
  return { curation: coerce(raw), isLoading: me.isLoading };
}

/** Persist the full curation object. Callers should spread the latest curation
 *  and override only their own fields, so concurrent edits (e.g. the picker vs.
 *  an inline equipment pin) don't clobber each other. */
export function useSaveTrainingCuration() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (next: TrainingCuration) => {
      const { data, error } = await supabase.rpc('set_my_preferences', {
        p_patch: { training: next },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['me'] }),
  });
}

/** Toggle membership of `id` in a string array (pure helper for pins). */
export function toggleId(list: string[], id: string): string[] {
  return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
}
