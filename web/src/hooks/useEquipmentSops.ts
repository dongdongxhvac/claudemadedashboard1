import { useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

// Equipment SOP spine (migration 0074). An equipment SOP = an `equipment_tasks`
// row (equipment x facet x task) plus its equipment-level `sops` row. This hook
// reads/writes BOTH as one flat row shape so the editor stays simple, and is the
// real (DB-backed) replacement for the per-equipment localStorage SOP draft.
// Write RLS = current_user_can_edit_kb() (admin OR lead).

export type SopFacet = 'pm' | 'reset' | 'support' | 'knowledge';
export const SOP_FACETS: { value: SopFacet; label: string }[] = [
  { value: 'pm', label: 'PM' },
  { value: 'reset', label: 'Reset' },
  { value: 'support', label: 'Support' },
  { value: 'knowledge', label: 'Knowledge' },
];

export type SopLoto = 'rloto' | 'gloto' | 'isoto' | 'na';
export const SOP_LOTO: { value: SopLoto; label: string }[] = [
  { value: 'rloto', label: 'rLOTO' },
  { value: 'gloto', label: 'gLOTO' },
  { value: 'isoto', label: 'ISOTO' },
  { value: 'na', label: 'N/A' },
];

/** One task + its equipment-level SOP, flattened for the editor. */
export type EquipmentSopRow = {
  taskId: string;
  facet: SopFacet;
  name: string;
  sortOrder: number;
  sopId: string | null;
  body: string;
  tools: string;
  frequency: string;
  safetyLoto: SopLoto | null;
};

/** An editor working-copy row (taskId/sopId null = not yet persisted). */
export type EditableSopRow = {
  taskId: string | null;
  sopId: string | null;
  facet: SopFacet;
  name: string;
  body: string;
  tools: string;
  frequency: string;
  safetyLoto: SopLoto | null;
  sortOrder: number;
};

const key = (equipmentId: string) => ['equipment_sops', equipmentId];

type TaskRow = { id: string; facet: SopFacet; name: string; sort_order: number };
type SopRow = {
  id: string; equipment_task_id: string | null;
  body: string | null; tools: string | null;
  frequency: string | null; safety_loto: SopLoto | null;
};

export function useEquipmentSops(equipmentId: string | null | undefined) {
  return useQuery({
    queryKey: key(equipmentId ?? ''),
    enabled: !!equipmentId,
    queryFn: async (): Promise<EquipmentSopRow[]> => {
      if (!equipmentId) return [];
      const tasksRes = await supabase
        .from('equipment_tasks')
        .select('id, facet, name, sort_order')
        .eq('equipment_id', equipmentId)
        .eq('active', true)
        .order('facet', { ascending: true })
        .order('sort_order', { ascending: true });
      if (tasksRes.error) throw tasksRes.error;
      const tasks = (tasksRes.data ?? []) as TaskRow[];
      if (tasks.length === 0) return [];

      const sopsRes = await supabase
        .from('sops')
        .select('id, equipment_task_id, body, tools, frequency, safety_loto')
        .in('equipment_task_id', tasks.map((t) => t.id))
        .eq('active', true);
      if (sopsRes.error) throw sopsRes.error;
      const sopByTask = new Map<string, SopRow>();
      for (const s of (sopsRes.data ?? []) as SopRow[]) {
        if (s.equipment_task_id && !sopByTask.has(s.equipment_task_id)) sopByTask.set(s.equipment_task_id, s);
      }

      return tasks.map((t) => {
        const s = sopByTask.get(t.id);
        return {
          taskId: t.id,
          facet: t.facet,
          name: t.name,
          sortOrder: t.sort_order,
          sopId: s?.id ?? null,
          body: s?.body ?? '',
          tools: s?.tools ?? '',
          frequency: s?.frequency ?? '',
          safetyLoto: s?.safety_loto ?? null,
        } satisfies EquipmentSopRow;
      });
    },
    staleTime: 60_000,
  });
}

/** Invalidate the equipment SOP cache on any task/sop change. Unique channel
 *  per mount (crypto.randomUUID) per the realtime convention. */
export function useEquipmentSopsRealtime(equipmentId: string | null | undefined) {
  const qc = useQueryClient();
  useEffect(() => {
    if (!equipmentId) return;
    const channel = supabase
      .channel(`eqsop-${equipmentId}-${crypto.randomUUID()}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'equipment_tasks', filter: `equipment_id=eq.${equipmentId}` },
        () => qc.invalidateQueries({ queryKey: key(equipmentId) }),
      )
      .on(
        // sops have no equipment_id column (they hang off the task), so this
        // listens broadly and invalidates the per-equipment key — cheap at this scale.
        'postgres_changes',
        { event: '*', schema: 'public', table: 'sops' },
        () => qc.invalidateQueries({ queryKey: key(equipmentId) }),
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [equipmentId, qc]);
}

/** Persist the whole editor working-copy: upsert each task + its equipment SOP,
 *  delete removed tasks (cascade removes their sops). Blank-named rows skipped. */
export function useSaveEquipmentSops() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      equipmentId: string;
      rows: EditableSopRow[];
      deletedTaskIds: string[];
    }) => {
      // One atomic transaction (migration 0075 `save_equipment_sops`) — any error
      // rolls back the WHOLE save, so a mid-save failure never leaves a partial or
      // duplicated state. Also stamps updated_by + handles clear-to-empty.
      const { error } = await supabase.rpc('save_equipment_sops', {
        p_equipment_id: input.equipmentId,
        p_rows: input.rows,
        p_deleted: input.deletedTaskIds,
      });
      if (error) throw error;
    },
    onSuccess: (_d, vars) => qc.invalidateQueries({ queryKey: key(vars.equipmentId) }),
  });
}

/** Map a loaded row to an editor row. */
export function toEditable(r: EquipmentSopRow): EditableSopRow {
  return {
    taskId: r.taskId, sopId: r.sopId, facet: r.facet, name: r.name,
    body: r.body, tools: r.tools, frequency: r.frequency,
    safetyLoto: r.safetyLoto, sortOrder: r.sortOrder,
  };
}

export function blankEditable(): EditableSopRow {
  return { taskId: null, sopId: null, facet: 'pm', name: '', body: '', tools: '', frequency: '', safetyLoto: null, sortOrder: 0 };
}
