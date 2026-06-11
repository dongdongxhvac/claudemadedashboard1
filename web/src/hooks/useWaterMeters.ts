// Water meter readings — tenant billing data layer.
//
// Source of truth is v_water_meter_readings_all (migration 0077), which
// unions two streams on one timeline:
//   * water_meter_readings table — Jan-Apr 2026 Excel backfill + any
//     manual entries added through the Water Billing tab
//   * plantlog_latest_readings   — live extraction from May 2026 onward;
//     new monthly readings appear automatically as the poller syncs
//
// Readings are taken in person on an irregular cadence (month end/start,
// sometimes skipped, sometimes 2+ in a month), so all billing math is
// done against ACTUAL reading dates — see computeBilling below.
import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

export type WaterReading = {
  building: string;
  meter_label: string;
  unit: string;            // 'Cubic Feet' | 'Gallons'
  value: number;
  reading_at: string;      // timestamptz
  multiplier: number;      // parsed from (x10)/(10)/(x100) in the label
  source: 'excel_backfill' | 'plantlog' | 'manual';
  manual_id: string | null; // non-null = row lives in water_meter_readings (deletable)
};

const KEY = ['water_meter_readings_all'];

export function useWaterMeterReadings() {
  return useQuery({
    queryKey: KEY,
    queryFn: async (): Promise<WaterReading[]> => {
      const { data, error } = await supabase
        .from('v_water_meter_readings_all')
        .select('*')
        .order('reading_at', { ascending: true });
      if (error) throw error;
      return (data ?? []).map((r) => ({
        ...r,
        value: Number(r.value),
        multiplier: Number(r.multiplier),
      })) as WaterReading[];
    },
    staleTime: 60_000,
  });
}

/** Manual reading entry (admin/lead only via RLS). */
export function useAddWaterReading() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      building: string;
      meter_label: string;
      unit: string;
      value: number;
      reading_at: string;   // ISO
      note?: string | null;
    }) => {
      const { data, error } = await supabase
        .from('water_meter_readings')
        .insert({ ...input, source: 'manual' })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

/** Soft-delete a manual/backfill row (plantlog-sourced rows can't be
 *  deleted here — they're owned by the plantlog pipeline). */
export function useDeleteWaterReading() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (manualId: string) => {
      const { error } = await supabase
        .from('water_meter_readings')
        .update({ active: false, updated_at: new Date().toISOString() })
        .eq('id', manualId);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useWaterMetersRealtime() {
  const qc = useQueryClient();
  useEffect(() => {
    const channel = supabase
      .channel(`wmr-${crypto.randomUUID()}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'water_meter_readings' },
        () => qc.invalidateQueries({ queryKey: KEY }),
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'plantlog_latest_readings' },
        () => qc.invalidateQueries({ queryKey: KEY }),
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [qc]);
}

// ---------------------------------------------------------------------------
// Billing computation
// ---------------------------------------------------------------------------

export type MeterBillingLine = {
  building: string;
  meter_label: string;
  unit: string;
  multiplier: number;
  /** Reading that establishes the period-start meter state — the latest
   *  reading at-or-before the range start. Null when none exists (meter
   *  first appears inside the range; line is flagged partial). */
  startReading: WaterReading | null;
  /** Null when the meter has NO reading inside the range (skipped visit)
   *  — line carries 'no_reading_in_range' and shows last-known state. */
  endReading: WaterReading | null;
  /** end - start, raw register units. Null when not computable. */
  deltaRaw: number | null;
  /** deltaRaw × multiplier, in `unit`. */
  usage: number | null;
  /** Days between the two readings actually used. */
  daysSpanned: number | null;
  flags: BillingFlag[];
};

export type BillingFlag =
  | 'no_start_before_range'   // first reading is inside the range — partial period
  | 'single_reading'          // only one usable reading — no delta possible
  | 'negative_delta'          // meter reset / rollover / misread — needs review
  | 'stale_end'               // newest usable reading is >40 days before range end
  | 'no_reading_in_range';    // meter skipped this period — last known state shown

/** For a date range [startIso, endIso] (YYYY-MM-DD, inclusive), compute one
 *  billing line per (building, meter) from raw readings.
 *
 *  Boundary semantics: the "state of the meter at boundary B" is the
 *  latest reading taken at-or-before B. Start boundary = start date
 *  00:00 ET; end boundary = end date 23:59:59 ET. This matches how the
 *  readings are actually taken (end of month / start of next month)
 *  without assuming any calendar alignment. */
export function computeBilling(
  readings: WaterReading[],
  startIso: string,
  endIso: string,
): MeterBillingLine[] {
  // ET boundaries expressed as instants. We compare timestamptz strings
  // numerically via Date.parse.
  const startMs = etBoundaryMs(startIso, false);
  const endMs = etBoundaryMs(endIso, true);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return [];

  const byMeter = new Map<string, WaterReading[]>();
  for (const r of readings) {
    const k = `${r.building}|${r.meter_label}|${r.unit}`;
    const arr = byMeter.get(k) ?? [];
    arr.push(r);
    byMeter.set(k, arr);
  }

  const out: MeterBillingLine[] = [];
  for (const arr of byMeter.values()) {
    arr.sort((a, b) => Date.parse(a.reading_at) - Date.parse(b.reading_at));
    const upToEnd = arr.filter((r) => Date.parse(r.reading_at) <= endMs);
    if (upToEnd.length === 0) continue;             // meter not yet in existence for this range
    const endReading = upToEnd[upToEnd.length - 1];

    // Newest reading predates the range entirely. Two distinct cases:
    //   * Within 90 days of range start — almost certainly a skipped
    //     in-person visit ("some buildings skip a month"). Surface the
    //     meter with its last-known state + an explicit flag, so a
    //     missing visit is VISIBLE instead of silently absent.
    //   * Older than 90 days — historical/retired label (e.g. renamed
    //     meters from before the plantlog log restructure); hide it.
    if (Date.parse(endReading.reading_at) < startMs) {
      if (startMs - Date.parse(endReading.reading_at) <= 90 * 86_400_000) {
        out.push({
          building: endReading.building,
          meter_label: endReading.meter_label,
          unit: endReading.unit,
          multiplier: endReading.multiplier,
          startReading: endReading,     // last known state
          endReading: null,
          deltaRaw: null,
          usage: null,
          daysSpanned: null,
          flags: ['no_reading_in_range'],
        });
      }
      continue;
    }

    const flags: BillingFlag[] = [];
    const beforeStart = upToEnd.filter((r) => Date.parse(r.reading_at) <= startMs);
    let startReading: WaterReading | null = null;
    if (beforeStart.length > 0) {
      startReading = beforeStart[beforeStart.length - 1];
    } else {
      // First reading for this meter falls inside the range.
      flags.push('no_start_before_range');
      const inRange = upToEnd.filter((r) => Date.parse(r.reading_at) > startMs);
      startReading = inRange.length > 1 ? inRange[0] : null;
    }

    let deltaRaw: number | null = null;
    let usage: number | null = null;
    let daysSpanned: number | null = null;
    if (startReading && startReading !== endReading) {
      deltaRaw = endReading.value - startReading.value;
      usage = deltaRaw * endReading.multiplier;
      daysSpanned = Math.round(
        (Date.parse(endReading.reading_at) - Date.parse(startReading.reading_at)) / 86_400_000,
      );
      if (deltaRaw < 0) flags.push('negative_delta');
    } else {
      flags.push('single_reading');
    }

    if (endMs - Date.parse(endReading.reading_at) > 40 * 86_400_000) {
      flags.push('stale_end');
    }

    out.push({
      building: endReading.building,
      meter_label: endReading.meter_label,
      unit: endReading.unit,
      multiplier: endReading.multiplier,
      startReading,
      endReading,
      deltaRaw,
      usage,
      daysSpanned,
      flags,
    });
  }

  // Numeric-aware building sort, then meter label. localeCompare with
  // numeric:true handles both pure-numeric codes (20 < 88 < 300) and any
  // future alphanumeric ones without NaN surprises.
  out.sort((a, b) =>
    a.building.localeCompare(b.building, undefined, { numeric: true }) ||
    a.meter_label.localeCompare(b.meter_label),
  );
  return out;
}

// Structured ET wall-clock decomposition — Intl.formatToParts gives us
// fields directly, with no locale-string parsing (which would be parsed
// in the BROWSER's timezone and break for non-US users).
const ET_PARTS_FMT = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hour12: false,
});

function etWall(ms: number): { m: number; d: number; h: number } {
  const parts: Record<string, string> = {};
  for (const p of ET_PARTS_FMT.formatToParts(ms)) parts[p.type] = p.value;
  // hour12:false can emit "24" for midnight in some engines — normalize.
  return { m: Number(parts.month), d: Number(parts.day), h: Number(parts.hour) % 24 };
}

/** YYYY-MM-DD → epoch ms of that date's 00:00 (start) or 23:59:59.999
 *  (end) in America/New_York, DST-correct on any client timezone. */
function etBoundaryMs(dateIso: string, endOfDay: boolean): number {
  const [y, m, d] = dateIso.split('-').map(Number);
  if (!y || !m || !d) return NaN;
  const wallH = endOfDay ? 23 : 0;
  const wallMin = endOfDay ? 59 : 0;
  const wallSec = endOfDay ? 59 : 0;
  // ET is UTC-4 (EDT) or UTC-5 (EST); try both candidate instants and
  // keep the one whose ET wall clock matches the intended time.
  for (const offset of [4, 5]) {
    const ms = Date.UTC(y, m - 1, d, wallH + offset, wallMin, wallSec, endOfDay ? 999 : 0);
    const w = etWall(ms);
    if (w.d === d && w.m === m && w.h === wallH) return ms;
  }
  // Unreachable except during the spring-forward gap — EST is the safe pick.
  return Date.UTC(y, m - 1, d, wallH + 5, wallMin, wallSec, endOfDay ? 999 : 0);
}

/** YYYY-MM-DD → ISO instant for NOON Eastern on that date, DST-correct.
 *  Used for manual reading entries (date precision; noon avoids any
 *  midnight boundary ambiguity in the billing math). */
export function etNoonIso(dateIso: string): string {
  const [y, m, d] = dateIso.split('-').map(Number);
  for (const offset of [4, 5]) {
    const ms = Date.UTC(y, m - 1, d, 12 + offset);
    const w = etWall(ms);
    if (w.d === d && w.m === m && w.h === 12) return new Date(ms).toISOString();
  }
  return new Date(Date.UTC(y, m - 1, d, 17)).toISOString();
}
