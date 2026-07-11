import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

export type FocusLevel = 'info' | 'warn' | 'urgent' | 'critical';
export type FocusKind  = 'announcement' | 'alarm' | 'priority' | 'reminder';

export type FocusItem = {
  id: string;
  kind: FocusKind;
  title: string | null;
  body: string;
  level: FocusLevel;
  pinned: boolean;
  starts_at: string | null;
  expires_at: string | null;
  created_by: string | null;
  created_at: string;
  /** Site the announcement belongs to (0097). NULL = all sites. Inserts are
   *  stamped UPark by a DB trigger when unspecified. */
  site_id: string | null;
};

const KEY = ['focus_board_active'];

export function useActiveFocusItems() {
  return useQuery({
    queryKey: KEY,
    queryFn: async (): Promise<FocusItem[]> => {
      const nowIso = new Date().toISOString();
      const { data, error } = await supabase
        .from('focus_board_items')
        .select('*')
        .or(`starts_at.is.null,starts_at.lte.${nowIso}`)
        .or(`expires_at.is.null,expires_at.gt.${nowIso}`)
        .order('pinned', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(20);
      if (error) throw error;
      return (data ?? []) as FocusItem[];
    },
    staleTime: 30_000,
  });
}

export function usePostAnnouncement() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      body: string;
      level: FocusLevel;
      expires_at?: string | null;
      title?: string | null;
      pinned?: boolean;
      /** Site the announcement targets (0097). Omitted/null → the DB trigger
       *  stamps UPark, the historical default. */
      site_id?: string | null;
    }) => {
      const { data: userRes } = await supabase.auth.getUser();
      const payload = {
        kind: 'announcement' as const,
        body: input.body.trim(),
        level: input.level,
        title: input.title ?? null,
        expires_at: input.expires_at ?? null,
        pinned: input.pinned ?? false,
        created_by: userRes.user?.id ?? null,
        site_id: input.site_id ?? null,
      };
      const { error, data } = await supabase
        .from('focus_board_items')
        .insert(payload)
        .select()
        .single();
      if (error) throw error;
      return data as FocusItem;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useDismissFocusItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('focus_board_items')
        .update({ expires_at: new Date().toISOString() })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

/** Realtime: any change to focus_board_items invalidates the active-items query. */
export function useFocusBoardRealtime() {
  const qc = useQueryClient();
  useEffect(() => {
    const channel = supabase
      .channel(`focus-board-changes-${crypto.randomUUID()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'focus_board_items' }, () => {
        qc.invalidateQueries({ queryKey: KEY });
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [qc]);
}
