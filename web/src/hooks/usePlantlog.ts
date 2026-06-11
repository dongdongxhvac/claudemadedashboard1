// Phase 6.7 — plantlog read hooks.
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

/** Short_code starts (or street-name prefixes) the user wants excluded
 *  from §06 compliance checks. Building names like "20 Sidney St" /
 *  "80 Landsdowne St" / "55 Franklin St" don't have plant log rounds. */
const EXCLUDED_LEADING_NUMBERS = new Set(['20', '55', '80']);

function leadingDigits(s: string): string {
  let out = '';
  for (const ch of s.trim()) {
    if (ch >= '0' && ch <= '9') out += ch;
    else break;
  }
  return out;
}

function isExcludedBuilding(building: string | null): boolean {
  if (!building) return true;
  return EXCLUDED_LEADING_NUMBERS.has(leadingDigits(building));
}

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

// ---------------------------------------------------------------------------
// §06 AM / PM compliance heartbeat
// ---------------------------------------------------------------------------

export type PlantlogComplianceWindow = {
  key: 'am' | 'pm';
  /** "10:30 AM" / "5:55 PM" — pretty label for the chip tooltip. */
  deadlineLabel: string;
  /** Whether the deadline has already passed in ET today. */
  deadlinePassed: boolean;
  /** Buildings expected today (after exclusion list). */
  expected: string[];
  /** Buildings with at least one log entry today before the deadline. */
  synced: string[];
  /** Expected minus synced — what's late or missing. */
  missing: string[];
};

export type PlantlogComplianceState = {
  isWeekend: boolean;
  /** AM = 7am crew rounds, must be in by 10:30 AM ET. */
  am: PlantlogComplianceWindow;
  /** PM = 9:30am crew rounds, must be in by 5:55 PM ET. */
  pm: PlantlogComplianceWindow;
};

/** Today's plantlog compliance — drives the §06 AM/PM heartbeat chips.
 *  Reads raw plantlog_log_records for today only (small set) so we can
 *  filter by performed_at_local <= deadline. Hidden on weekends. */
export function usePlantlogTodayCompliance() {
  return useQuery({
    queryKey: ['plantlog_today_compliance'],
    queryFn: async (): Promise<PlantlogComplianceState> => {
      // Anchor on Eastern Time — UPark schedule.
      const etNow = new Date(
        new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }),
      );
      const dow = etNow.getDay();   // 0=Sun..6=Sat
      const isWeekend = dow === 0 || dow === 6;
      const etDay = etNow.toLocaleDateString('en-CA');  // YYYY-MM-DD

      // Expected = distinct buildings seen in last 30d (excluding 20/55/80).
      // Done as a separate query so adding a new building to plantlog
      // doesn't require a code change.
      const since = new Date();
      since.setDate(since.getDate() - 30);
      const sinceStr = since.toISOString().slice(0, 10);
      const [expRes, todayRes] = await Promise.all([
        supabase
          .from('plantlog_log_records')
          .select('building_inferred')
          .gte('performed_on', sinceStr)
          .limit(50_000),
        supabase
          .from('plantlog_log_records')
          .select('building_inferred, performed_at_local')
          .eq('performed_on', etDay)
          .limit(10_000),
      ]);
      if (expRes.error) throw expRes.error;
      if (todayRes.error) throw todayRes.error;

      const expectedSet = new Set<string>();
      for (const r of (expRes.data ?? []) as { building_inferred: string | null }[]) {
        const b = r.building_inferred;
        if (b && !isExcludedBuilding(b)) expectedSet.add(b);
      }
      const expected = Array.from(expectedSet).sort();

      const buildWindow = (
        key: 'am' | 'pm',
        deadlineHHMM: string,
        deadlineLabel: string,
      ): PlantlogComplianceWindow => {
        const synced = new Set<string>();
        for (const r of (todayRes.data ?? []) as { building_inferred: string | null; performed_at_local: string | null }[]) {
          const b = r.building_inferred;
          const t = r.performed_at_local;
          if (!b || !t) continue;
          if (isExcludedBuilding(b)) continue;
          // PostgREST returns 'HH:MM:SS'. Compare as zero-padded string.
          if (String(t).slice(0, 8) <= deadlineHHMM) synced.add(b);
        }
        const syncedList = expected.filter((b) => synced.has(b));
        const missing = expected.filter((b) => !synced.has(b));
        const [hh, mm] = deadlineHHMM.split(':').map(Number);
        const cur = etNow.getHours() * 60 + etNow.getMinutes();
        const deadlineMin = hh * 60 + mm;
        return {
          key,
          deadlineLabel,
          deadlinePassed: cur >= deadlineMin,
          expected,
          synced: syncedList,
          missing,
        };
      };

      return {
        isWeekend,
        am: buildWindow('am', '10:30:00', '10:30 AM'),
        pm: buildWindow('pm', '17:55:00', '5:55 PM'),
      };
    },
    // Refresh once a minute — deadlines are 30-min granularity and the
    // hourly poller refreshes the data underneath.
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
}

// ---------------------------------------------------------------------------
// Plantlog poller heartbeat — last successful sync time, for the BMS strip
// on /tv and the §06 panel meta indicator.
// ---------------------------------------------------------------------------

export type PlantlogPollHeartbeat = {
  /** UTC timestamp of the last successful plantlog_records ingestion. */
  last_ok_utc: string | null;
  hours_since: number | null;
};

/** Latest successful plantlog poll timestamp. Drives the /tv heartbeat dot
 *  for plantlog alongside the BMS vendors. */
export function usePlantlogPollHeartbeat() {
  return useQuery({
    queryKey: ['plantlog_poll_heartbeat'],
    queryFn: async (): Promise<PlantlogPollHeartbeat> => {
      const { data, error } = await supabase
        .from('ingestion_log')
        .select('at')
        .eq('kind', 'plantlog_records')
        .eq('status', 'ok')
        .order('at', { ascending: false })
        .limit(1);
      if (error) throw error;
      const row = (data ?? [])[0] as { at: string } | undefined;
      if (!row?.at) return { last_ok_utc: null, hours_since: null };
      const hours = (Date.now() - new Date(row.at).getTime()) / 3_600_000;
      return { last_ok_utc: row.at, hours_since: hours };
    },
    staleTime: 60_000,
    refetchInterval: 60_000,
  });
}

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

export type PlantlogDailyAmPm = {
  et_day: string;
  am_buildings: number;
  pm_buildings: number;
};

/** Per-day AM / PM building counts (v_plantlog_daily_ampm, migration 0080).
 *  By round START time per building: AM = first entry of the day before
 *  11:30 ET; PM = first afternoon entry (noon+) at/after 15:00 ET. */
export function usePlantlogDailyAmPm(daysBack: number = 14) {
  return useQuery({
    queryKey: ['plantlog_daily_ampm', daysBack],
    queryFn: async (): Promise<PlantlogDailyAmPm[]> => {
      const since = new Date();
      since.setDate(since.getDate() - daysBack);
      const sinceStr = since.toISOString().slice(0, 10);
      const { data, error } = await supabase
        .from('v_plantlog_daily_ampm')
        .select('*')
        .gte('et_day', sinceStr);
      if (error) throw error;
      return (data ?? []).map((r) => ({
        ...r,
        am_buildings: Number(r.am_buildings),
        pm_buildings: Number(r.pm_buildings),
      })) as PlantlogDailyAmPm[];
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
  /** Sum of per-building visit durations (active building time). Independent
   *  of mid-round gaps — when an engineer interleaves a weekly/monthly task
   *  in the middle of the daily round, span widens but active stays put. */
  active_seconds: number;
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
