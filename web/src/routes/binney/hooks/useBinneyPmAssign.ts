// Assign a Cove PM to an engineer from the Binney manager page (0156).
//
// The browser cannot write to Cove (the session lives on the VM), so this
// is a queue: insert a pm_assign_requests row, and the VM's
// pm_assign_watcher.py (per-minute timer) runs Cove's UpdatePMTask for it
// and stamps done / error. While anything is pending we poll every 4 s so
// the row's status chip moves on its own.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../../lib/supabase';

export type PmAssignStatus = 'pending' | 'running' | 'done' | 'error';

export type PmAssignRequest = {
  id: string;
  cove_task_id: string;
  task_no: string | null;
  task_name: string | null;
  assignee_user_id: string | null;
  assignee_cove_id: string;
  assignee_name: string | null;
  previous_assignee_name: string | null;
  requested_by: string | null;
  requested_at: string;
  finished_at: string | null;
  status: PmAssignStatus;
  detail: string | null;
};

export const KEY_PM_ASSIGN = ['binney_pm_assign_requests'];
const SITE = 'binney';

/** Requests from the last `hoursBack` hours, newest first. */
export function usePmAssignRequests(hoursBack: number = 48) {
  return useQuery({
    queryKey: [...KEY_PM_ASSIGN, hoursBack],
    queryFn: async (): Promise<PmAssignRequest[]> => {
      const since = new Date(Date.now() - hoursBack * 3_600_000).toISOString();
      const { data, error } = await supabase
        .from('pm_assign_requests')
        .select('id, cove_task_id, task_no, task_name, assignee_user_id, assignee_cove_id, assignee_name, previous_assignee_name, requested_by, requested_at, finished_at, status, detail')
        .eq('site_code', SITE)
        .gte('requested_at', since)
        .order('requested_at', { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []) as PmAssignRequest[];
    },
    refetchInterval: (query) => {
      const rows = query.state.data ?? [];
      return rows.some((r) => r.status === 'pending' || r.status === 'running') ? 4000 : 60_000;
    },
    staleTime: 2000,
  });
}

export type PmAssignInput = {
  cove_task_id: string;
  task_no: string | null;
  task_name: string | null;
  assignee_user_id: string;
  assignee_cove_id: string;
  assignee_name: string;
  previous_assignee_name: string | null;
  requested_by: string | null;
};

export function useRequestPmAssign() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: PmAssignInput) => {
      const { error } = await supabase
        .from('pm_assign_requests')
        .insert({ ...input, site_code: SITE });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY_PM_ASSIGN }),
  });
}

/** Bulk: one insert of many requests (the month-start hand-out). */
export function useRequestPmAssignMany() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (inputs: PmAssignInput[]) => {
      if (inputs.length === 0) return;
      const { error } = await supabase
        .from('pm_assign_requests')
        .insert(inputs.map((i) => ({ ...i, site_code: SITE })));
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY_PM_ASSIGN }),
  });
}
