import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

export type Building = {
  id: string;
  code: string;          // full address-like code, joins pm_rows.building_code
  short_code: string | null;
  name: string;
  address: string | null;
  client_company: string | null;
  active: boolean;
};

const KEY = ['buildings'];

export function useBuildings() {
  return useQuery({
    queryKey: KEY,
    queryFn: async (): Promise<Building[]> => {
      const { data, error } = await supabase
        .from('buildings')
        .select('id, code, short_code, name, address, client_company, active')
        .eq('active', true)
        .order('short_code', { ascending: true, nullsFirst: false });
      if (error) throw error;
      return (data ?? []) as Building[];
    },
    staleTime: 5 * 60_000,
  });
}

export function useBuildingsRealtime() {
  const qc = useQueryClient();
  useEffect(() => {
    const channel = supabase
      .channel(`buildings-changes-${crypto.randomUUID()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'buildings' }, () => {
        qc.invalidateQueries({ queryKey: KEY });
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [qc]);
}

export function useUpdateBuilding() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      id: string;
      patch: Partial<Pick<Building, 'short_code' | 'name' | 'address' | 'client_company' | 'active'>>;
    }) => {
      const { error, data } = await supabase
        .from('buildings')
        .update({ ...input.patch, updated_at: new Date().toISOString() })
        .eq('id', input.id)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}
