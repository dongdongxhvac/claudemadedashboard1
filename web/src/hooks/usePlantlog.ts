// Phase 6.7 — plantlog read hooks.
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

export type PlantlogBuildingDay = {
  building: string;
  et_day: string;     // YYYY-MM-DD (ET-anchored)
  entries: number;
};

export type PlantlogUserBuildingDay = {
  user_name: string;
  building: string;
  et_day: string;
  entries: number;
};

/** Per-building daily entry counts. */
export function usePlantlogBuildingDaily(daysBack: number = 14) {
  return useQuery({
    queryKey: ['plantlog_building_daily', daysBack],
    queryFn: async (): Promise<PlantlogBuildingDay[]> => {
      const since = new Date();
      since.setDate(since.getDate() - daysBack);
      const sinceStr = since.toISOString().slice(0, 10);
      const { data, error } = await supabase
        .from('v_plantlog_building_daily')
        .select('*')
        .gte('et_day', sinceStr);
      if (error) throw error;
      return (data ?? []) as PlantlogBuildingDay[];
    },
    staleTime: 60_000,
  });
}

/** Per-user × per-building × per-day drill-down. */
export function usePlantlogUserBuildingDaily(daysBack: number = 14) {
  return useQuery({
    queryKey: ['plantlog_user_building_daily', daysBack],
    queryFn: async (): Promise<PlantlogUserBuildingDay[]> => {
      const since = new Date();
      since.setDate(since.getDate() - daysBack);
      const sinceStr = since.toISOString().slice(0, 10);
      const { data, error } = await supabase
        .from('v_plantlog_user_building_daily')
        .select('*')
        .gte('et_day', sinceStr);
      if (error) throw error;
      return (data ?? []) as PlantlogUserBuildingDay[];
    },
    staleTime: 60_000,
  });
}
