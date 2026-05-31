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

/** plantlog_username -> { full_name, user_id } for the engineers who've
 *  been mapped via the User Profiles admin tab. Lets the §06 panel show
 *  "Bjorn Gonzalez (Bgonzalez)" instead of just the plantlog handle. */
export function usePlantlogUserMap() {
  return useQuery({
    queryKey: ['plantlog_user_map'],
    queryFn: async (): Promise<Map<string, { full_name: string; user_id: string }>> => {
      const { data, error } = await supabase
        .from('users')
        .select('id, full_name, engineer_profiles!inner(plantlog_username)')
        .not('engineer_profiles.plantlog_username', 'is', null);
      if (error) throw error;
      type Row = { id: string; full_name: string; engineer_profiles: { plantlog_username: string | null } | { plantlog_username: string | null }[] };
      const map = new Map<string, { full_name: string; user_id: string }>();
      for (const r of (data ?? []) as Row[]) {
        const ep = Array.isArray(r.engineer_profiles) ? r.engineer_profiles[0] : r.engineer_profiles;
        const u = ep?.plantlog_username;
        if (u) map.set(u, { full_name: r.full_name, user_id: r.id });
      }
      return map;
    },
    staleTime: 5 * 60_000,
  });
}

export type PlantlogWeeklyTest = {
  test_type: 'generator' | 'water';
  log_name: string;
  activity_name: string | null;
  last_done_utc: string;
  days_ago: number;
  last_by_user: string | null;
  building: string | null;
};

/** Latest completion per weekly compliance test (generator + water). */
export function usePlantlogWeeklyTests() {
  return useQuery({
    queryKey: ['plantlog_weekly_tests'],
    queryFn: async (): Promise<PlantlogWeeklyTest[]> => {
      const { data, error } = await supabase
        .from('v_plantlog_weekly_tests_status')
        .select('*');
      if (error) throw error;
      return (data ?? []) as PlantlogWeeklyTest[];
    },
    staleTime: 60_000,
  });
}

export type PlantlogMonthlyMeter = {
  log_name: string;
  activity_name: string | null;
  last_done_utc: string;
  days_ago: number;
  last_by_user: string | null;
  building: string | null;
};

export type PlantlogMeterReadingItem = {
  item: string;
  unit: string | null;
  value: string;
};

export type PlantlogMonthlyMeterLatestReading = {
  log_name: string;
  building_prefix: string | null;
  building: string | null;
  completed_at_utc: string;
  completed_by_user: string | null;
  activity_name: string | null;
  note: string | null;
  readings: PlantlogMeterReadingItem[];
};

/** Latest monthly water meter readings per building. One row per prefixed
 *  log (i.e. one per building that's been renamed in plantlog with a
 *  building-number prefix). `readings` is the JSONB array of per-meter
 *  items captured at the latest completion. */
export function usePlantlogMonthlyMeterLatestReadings() {
  return useQuery({
    queryKey: ['plantlog_monthly_meter_latest_readings'],
    queryFn: async (): Promise<PlantlogMonthlyMeterLatestReading[]> => {
      const { data, error } = await supabase
        .from('v_plantlog_monthly_water_meter_latest_readings')
        .select('*');
      if (error) throw error;
      return (data ?? []) as PlantlogMonthlyMeterLatestReading[];
    },
    staleTime: 60_000,
  });
}

export type PlantlogDailyMeterLatestReading = {
  building: string;
  log_name: string;
  completed_at_utc: string;
  completed_by_user: string | null;
  activity_name: string | null;
  note: string | null;
  readings: PlantlogMeterReadingItem[];
  attribution_source: 'direct' | 'inferred' | 'log_prefix' | null;
};

/** Latest daily-round meter readings per (building, log_name). Each row
 *  is the most recent completion of one meter log at one building — e.g.
 *  "CT Meters (Always)" at 26 Landsdowne St with its current Cubic Feet
 *  values. Building comes from building_inferred via a join to
 *  plantlog_log_records (already populated by cluster inference for
 *  daily rounds). */
export function usePlantlogDailyMeterLatestReadings() {
  return useQuery({
    queryKey: ['plantlog_daily_meter_latest_readings'],
    queryFn: async (): Promise<PlantlogDailyMeterLatestReading[]> => {
      const { data, error } = await supabase
        .from('v_plantlog_daily_meter_latest_readings')
        .select('*');
      if (error) throw error;
      return (data ?? []) as PlantlogDailyMeterLatestReading[];
    },
    staleTime: 60_000,
  });
}

/** Latest completion per monthly water meter reading log. Compliance window
 *  is the first 6 days of each calendar month (computed client-side in the
 *  §07 panel). Separate from the weekly view so the weekly compliance path
 *  stays untouched. */
export function usePlantlogMonthlyWaterMeters() {
  return useQuery({
    queryKey: ['plantlog_monthly_water_meters'],
    queryFn: async (): Promise<PlantlogMonthlyMeter[]> => {
      const { data, error } = await supabase
        .from('v_plantlog_monthly_water_meters_status')
        .select('*');
      if (error) throw error;
      return (data ?? []) as PlantlogMonthlyMeter[];
    },
    staleTime: 60_000,
  });
}

export type PlantlogUserDailySpan = {
  user_name: string;
  et_day: string;
  first_entry_utc: string;
  last_entry_utc: string;
  entries: number;
  span_seconds: number;
};

/** Per-user × per-day round efficiency: first/last entry, count, span.
 *  Excludes water treatment + weekly/monthly rounds so spans reflect
 *  daily-round effort only. */
export function usePlantlogUserDailySpan(daysBack: number = 14) {
  return useQuery({
    queryKey: ['plantlog_user_daily_span', daysBack],
    queryFn: async (): Promise<PlantlogUserDailySpan[]> => {
      const since = new Date();
      since.setDate(since.getDate() - daysBack);
      const sinceStr = since.toISOString().slice(0, 10);
      const { data, error } = await supabase
        .from('v_plantlog_user_daily_span')
        .select('*')
        .gte('et_day', sinceStr);
      if (error) throw error;
      return (data ?? []) as PlantlogUserDailySpan[];
    },
    staleTime: 60_000,
  });
}

/** Per-user × per-day × per-building visit-roll-up. Each row = an engineer's
 *  total time at one building on one day, computed from contiguous "visits"
 *  (same building + < 30 min gap = same visit). Used to show how long an
 *  engineer spent at each building. Same exclusion set as the span view so
 *  the per-building totals reconcile with the engineer's daily span. */
export type PlantlogUserBuildingVisit = {
  user_name: string;
  et_day: string;
  building: string;
  visits: number;             // visit count (e.g. "went back to A twice")
  entries: number;            // total entry rows
  first_entry_utc: string;
  last_entry_utc: string;
  total_visit_seconds: number; // sum of all visit spans for this building
};
export function usePlantlogUserBuildingDailyVisits(daysBack: number = 14) {
  return useQuery({
    queryKey: ['plantlog_user_building_daily_visits', daysBack],
    queryFn: async (): Promise<PlantlogUserBuildingVisit[]> => {
      const since = new Date();
      since.setDate(since.getDate() - daysBack);
      const sinceStr = since.toISOString().slice(0, 10);
      const { data, error } = await supabase
        .from('v_plantlog_user_building_daily_visits')
        .select('*')
        .gte('et_day', sinceStr);
      if (error) throw error;
      return (data ?? []) as PlantlogUserBuildingVisit[];
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
