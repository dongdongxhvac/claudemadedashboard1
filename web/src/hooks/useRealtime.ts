// Subscribes to Supabase realtime events on the snapshots table.
// Whenever the watcher inserts a new snapshot, we invalidate every "current_*"
// query so React Query refetches and the UI re-renders without a page reload.
import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

const KEYS_TO_REFRESH = [
  ['current_pm_snapshot'],
  ['current_labor_snapshot'],
  ['current_wo_snapshot'],
];

export function useSnapshotRealtime() {
  const qc = useQueryClient();

  useEffect(() => {
    const channel = supabase
      .channel(`snapshots-changes-${crypto.randomUUID()}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'snapshots' },
        () => {
          for (const key of KEYS_TO_REFRESH) {
            qc.invalidateQueries({ queryKey: key });
          }
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [qc]);
}
