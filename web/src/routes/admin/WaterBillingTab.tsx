// Water Meter Tenant Billing — admin tab.
//
// Pick a date range; get one billing line per (building, meter): the
// meter state at each boundary (latest in-person reading at-or-before
// the boundary), the delta, ×multiplier, and usage in the meter's unit.
// Readings are irregular (engineers read in person at month end/start,
// some buildings skip a month, some get 2+ visits) so every line shows
// the ACTUAL reading dates used — the math never assumes calendar
// alignment.
//
// Data: Jan-Apr 2026 backfilled from PlantLog Excel exports; May 2026
// onward flows live from the plantlog poller. Manual entries can be
// added below for anything missed.
import { useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useCanAccessAdmin } from '../../hooks/useMe';
import { useBuildings } from '../../hooks/useBuildings';
import {
  useWaterMeterReadings,
  useAddWaterReading,
  useDeleteWaterReading,
  useWaterMetersRealtime,
  computeBilling,
  etNoonIso,
  type WaterReading,
  type MeterBillingLine,
  type BillingFlag,
} from '../../hooks/useWaterMeters';

// ───────────────────────── date helpers

function iso(d: Date): string {
  return d.toLocaleDateString('en-CA');
}

function lastMonthRange(): [string, string] {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const end = new Date(now.getFullYear(), now.getMonth(), 0);
  return [iso(start), iso(end)];
}
function thisMonthRange(): [string, string] {
  const now = new Date();
  return [iso(new Date(now.getFullYear(), now.getMonth(), 1)), iso(now)];
}
function last3MonthsRange(): [string, string] {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth() - 3, 1);
  const end = new Date(now.getFullYear(), now.getMonth(), 0);
  return [iso(start), iso(end)];
}
function ytdRange(): [string, string] {
  const now = new Date();
  return [iso(new Date(now.getFullYear(), 0, 1)), iso(now)];
}

function fmtDate(ts: string): string {
  return new Date(ts).toLocaleDateString('en-US', {
    timeZone: 'America/New_York', month: 'short', day: 'numeric',
  });
}

function fmtNum(n: number): string {
  return n.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

const FLAG_LABEL: Record<BillingFlag, { text: string; tone: 'bad' | 'warn' | 'muted' }> = {
  negative_delta:        { text: 'negative — meter reset/replaced? verify',       tone: 'bad' },
  no_start_before_range: { text: 'partial — first reading inside period',         tone: 'warn' },
  single_reading:        { text: 'insufficient readings for usage',                tone: 'muted' },
  stale_end:             { text: 'no recent reading near period end',              tone: 'warn' },
  no_reading_in_range:   { text: 'no reading this period — last known shown',      tone: 'warn' },
};

export function WaterBillingTab() {
  useWaterMetersRealtime();
  const canEdit = useCanAccessAdmin();
  const readingsQ = useWaterMeterReadings();
  const buildingsQ = useBuildings();
  const del = useDeleteWaterReading();

  const [defStart, defEnd] = useMemo(() => lastMonthRange(), []);
  const [rangeStart, setRangeStart] = useState(defStart);
  const [rangeEnd, setRangeEnd] = useState(defEnd);
  // Tenant billing covers MAIN water meters only by default — CT /
  // submeter / irrigation / HW-makeup meters are operational, not
  // billable. Toggle exposes everything for ops use.
  const [mainOnly, setMainOnly] = useState(true);
  const [showReadings, setShowReadings] = useState(false);
  const [addingReading, setAddingReading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Email-report state — address persists across sessions so the monthly
  // billing run is one click.
  const [emailTo, setEmailTo] = useState<string>(
    () => localStorage.getItem('water_billing_email_to') ?? '',
  );
  const [emailState, setEmailState] = useState<'idle' | 'sending' | 'sent'>('idle');

  const readings = readingsQ.data ?? [];

  const scopedReadings = useMemo(
    () => mainOnly
      ? readings.filter((r) => r.meter_label.toLowerCase().includes('main'))
      : readings,
    [readings, mainOnly],
  );

  const buildingName = useMemo(() => {
    const m = new Map<string, string>();
    for (const b of buildingsQ.data ?? []) {
      const code = b.short_code ?? b.code;
      if (code) m.set(code, b.name);
    }
    return m;
  }, [buildingsQ.data]);

  const lines = useMemo(
    () => computeBilling(scopedReadings, rangeStart, rangeEnd),
    [scopedReadings, rangeStart, rangeEnd],
  );

  // Group lines by building for tenant-billing presentation.
  const byBuilding = useMemo(() => {
    const m = new Map<string, MeterBillingLine[]>();
    for (const l of lines) {
      const arr = m.get(l.building) ?? [];
      arr.push(l);
      m.set(l.building, arr);
    }
    return Array.from(m.entries());
  }, [lines]);

  const setPreset = (fn: () => [string, string]) => {
    const [s, e] = fn();
    setRangeStart(s);
    setRangeEnd(e);
  };

  // Shared report rows (typed — numbers stay numbers so Excel can sum).
  const buildReportAoa = (): (string | number)[][] => [
    ['Water Meter Tenant Billing'],
    [
      `Period ${rangeStart} → ${rangeEnd}`,
      mainOnly ? 'Main meters only' : 'All meters',
      `Generated ${new Date().toLocaleString('en-US', { timeZone: 'America/New_York' })} ET`,
    ],
    [],
    ['Building', 'Meter', 'Prior reading', 'Prior date', 'Current reading', 'Current date', 'Days', 'Delta (raw)', 'Multiplier', 'Usage', 'Unit', 'Flags'],
    ...lines.map((l): (string | number)[] => [
      l.building,
      l.meter_label,
      l.startReading ? l.startReading.value : '',
      l.startReading ? fmtDate(l.startReading.reading_at) : '',
      l.endReading ? l.endReading.value : '',
      l.endReading ? fmtDate(l.endReading.reading_at) : '',
      l.daysSpanned ?? '',
      l.deltaRaw ?? '',
      l.multiplier,
      l.usage ?? '',
      l.unit,
      l.flags.map((f) => FLAG_LABEL[f].text).join('; '),
    ]),
  ];

  const emailReport = async () => {
    setError(null);
    const to = emailTo.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
      setError('Enter a valid email address first.');
      return;
    }
    if (lines.length === 0) {
      setError('Nothing to send — no billing lines in this period.');
      return;
    }
    setEmailState('sending');
    try {
      // SheetJS loads on demand — keeps it out of the main bundle.
      const XLSX = await import('xlsx');
      const ws = XLSX.utils.aoa_to_sheet(buildReportAoa());
      ws['!cols'] = [
        { wch: 8 }, { wch: 38 }, { wch: 14 }, { wch: 10 }, { wch: 14 },
        { wch: 10 }, { wch: 6 }, { wch: 12 }, { wch: 9 }, { wch: 12 },
        { wch: 10 }, { wch: 44 },
      ];
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Water Billing');
      const attachment_base64 = XLSX.write(wb, { type: 'base64', bookType: 'xlsx' }) as string;

      const filename = `water-billing_${rangeStart}_${rangeEnd}.xlsx`;
      const { data, error: fnError } = await supabase.functions.invoke('email-report', {
        body: {
          to,
          subject: `Water Meter Tenant Billing — ${rangeStart} → ${rangeEnd}`,
          text:
            `Water Meter Tenant Billing report attached.\n\n` +
            `Period: ${rangeStart} → ${rangeEnd}\n` +
            `Scope: ${mainOnly ? 'main water meters only' : 'all meters'}\n` +
            `Lines: ${lines.length} across ${byBuilding.length} buildings\n\n` +
            `Generated from the UPark Operations Dashboard (Admin → Water Billing).`,
          filename,
          attachment_base64,
        },
      });
      if (fnError) {
        // FunctionsHttpError hides the response body behind .context —
        // surface the function's actual { error } message, not the
        // generic "non-2xx status code" text.
        let msg = fnError.message;
        const ctx = (fnError as { context?: Response }).context;
        if (ctx && typeof ctx.json === 'function') {
          try {
            const j = await ctx.json();
            if (j?.error) msg = String(j.error);
          } catch { /* body not json — keep generic message */ }
        }
        throw new Error(msg);
      }
      if (data?.error) throw new Error(String(data.error));
      localStorage.setItem('water_billing_email_to', to);
      setEmailState('sent');
      setTimeout(() => setEmailState('idle'), 4000);
    } catch (e) {
      setEmailState('idle');
      setError(e instanceof Error ? e.message : 'Send failed.');
    }
  };

  const exportCsv = () => {
    const rows = [
      ['Building', 'Meter', 'Prior reading', 'Prior date', 'Current reading', 'Current date', 'Days', 'Delta (raw)', 'Multiplier', 'Usage', 'Unit', 'Flags'],
      ...lines.map((l) => [
        l.building,
        l.meter_label,
        l.startReading ? String(l.startReading.value) : '',
        l.startReading ? fmtDate(l.startReading.reading_at) : '',
        l.endReading ? String(l.endReading.value) : '',
        l.endReading ? fmtDate(l.endReading.reading_at) : '',
        l.daysSpanned !== null ? String(l.daysSpanned) : '',
        l.deltaRaw !== null ? String(l.deltaRaw) : '',
        String(l.multiplier),
        l.usage !== null ? String(l.usage) : '',
        l.unit,
        l.flags.map((f) => FLAG_LABEL[f].text).join('; '),
      ]),
    ];
    const csv = rows
      .map((r) => r.map((c) => /[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c).join(','))
      .join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `water-billing_${rangeStart}_${rangeEnd}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 flex-wrap mb-1">
        <div>
          <h2 className="t-section-title">Water Meter Tenant Billing</h2>
          <p className="t-small t-muted">
            main water meters only (billing scope) · usage between in-person readings ·
            boundaries snap to the nearest reading within ±6 days (else latest before) ·
            Jan–Apr from Excel backfill, May→ live from plantlog
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <input
            type="email"
            value={emailTo}
            onChange={(e) => setEmailTo(e.target.value)}
            placeholder="email address"
            style={{
              padding: '5px 10px', borderRadius: 4,
              border: '1px solid var(--color-border)',
              background: 'var(--color-card)', color: 'var(--color-text)',
              font: 'inherit', fontSize: '0.8rem', width: 220,
            }}
          />
          <button
            type="button"
            onClick={emailReport}
            disabled={lines.length === 0 || emailState === 'sending'}
            className="t-small t-accent"
            style={{
              padding: '6px 14px', border: '1px solid var(--color-accent)',
              borderRadius: 4, background: 'var(--color-card)',
              opacity: emailState === 'sending' ? 0.6 : 1,
            }}
            title="Generates the current report as an .xlsx and emails it to the address"
          >
            {emailState === 'sending' ? 'Sending…'
              : emailState === 'sent' ? '✓ Sent'
              : '✉ Email report (.xlsx)'}
          </button>
          <button
            type="button"
            onClick={exportCsv}
            disabled={lines.length === 0}
            className="t-small t-accent"
            style={{
              padding: '6px 14px', border: '1px solid var(--color-accent)',
              borderRadius: 4, background: 'var(--color-card)',
            }}
          >
            ⤓ CSV
          </button>
        </div>
      </div>

      {/* Range controls */}
      <div className="flex items-center gap-2 flex-wrap mb-4" style={{ fontSize: '0.8rem' }}>
        <span className="t-small t-muted uppercase tracking-wider">Period</span>
        <input
          type="date"
          value={rangeStart}
          onChange={(e) => setRangeStart(e.target.value)}
          style={dateInputStyle}
        />
        <span className="t-muted">→</span>
        <input
          type="date"
          value={rangeEnd}
          onChange={(e) => setRangeEnd(e.target.value)}
          style={dateInputStyle}
        />
        <span style={{ width: 8 }} />
        <Preset label="Last month" onClick={() => setPreset(lastMonthRange)} />
        <Preset label="This month" onClick={() => setPreset(thisMonthRange)} />
        <Preset label="Last 3 mo" onClick={() => setPreset(last3MonthsRange)} />
        <Preset label="YTD" onClick={() => setPreset(ytdRange)} />
        <span className="t-small t-muted uppercase tracking-wider ml-3">Meters</span>
        <Preset label="Main only" onClick={() => setMainOnly(true)} active={mainOnly} />
        <Preset label="All" onClick={() => setMainOnly(false)} active={!mainOnly} />
      </div>

      {error && <p className="t-small mb-2" style={{ color: 'var(--color-danger)' }}>{error}</p>}

      {readingsQ.isLoading ? (
        <p className="t-text t-muted">Loading readings…</p>
      ) : readingsQ.error ? (
        <p className="t-text t-danger">Error: {(readingsQ.error as Error).message}</p>
      ) : lines.length === 0 ? (
        <p className="t-text t-muted">No meter readings in or before this period.</p>
      ) : (
        byBuilding.map(([bld, blines]) => (
          <div key={bld} className="mb-5">
            <div className="flex items-baseline gap-2 mb-1">
              <span
                className="t-mono"
                style={{
                  padding: '1px 8px', borderRadius: 4,
                  background: 'var(--color-accent)', color: 'white',
                  fontWeight: 700, fontSize: '0.78rem',
                }}
              >
                {bld}
              </span>
              <span className="t-small t-muted">{buildingName.get(bld) ?? ''}</span>
            </div>
            <table className="t-mono t-small w-full" style={{ borderCollapse: 'collapse' }}>
              <thead>
                <tr className="t-muted">
                  <th className="text-left pb-1 pr-3">Meter</th>
                  <th className="text-right pb-1 px-2">Prior</th>
                  <th className="text-left pb-1 pr-3" style={{ fontWeight: 400 }}>date</th>
                  <th className="text-right pb-1 px-2">Current</th>
                  <th className="text-left pb-1 pr-3" style={{ fontWeight: 400 }}>date</th>
                  <th className="text-right pb-1 px-2" title="days between the two readings used">Days</th>
                  <th className="text-right pb-1 px-2">Δ raw</th>
                  <th className="text-right pb-1 px-2">×</th>
                  <th className="text-right pb-1 px-2">Usage</th>
                  <th className="text-left pb-1 pl-2">Unit / flags</th>
                </tr>
              </thead>
              <tbody>
                {blines.map((l) => {
                  const neg = l.flags.includes('negative_delta');
                  return (
                    <tr
                      key={`${l.building}|${l.meter_label}|${l.unit}`}
                      style={{ borderTop: '1px solid var(--color-border-soft)' }}
                    >
                      <td className="py-1 pr-3" style={{ color: 'var(--color-text)', maxWidth: 270, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={l.meter_label}>
                        {l.meter_label}
                      </td>
                      <td className="text-right px-2 py-1">
                        {l.startReading ? fmtNum(l.startReading.value) : '—'}
                      </td>
                      <td className="py-1 pr-3 t-muted" style={{ fontSize: '0.7rem' }}>
                        {l.startReading ? fmtDate(l.startReading.reading_at) : ''}
                      </td>
                      <td className="text-right px-2 py-1">
                        {l.endReading ? fmtNum(l.endReading.value) : '—'}
                      </td>
                      <td className="py-1 pr-3 t-muted" style={{ fontSize: '0.7rem' }}>
                        {l.endReading ? fmtDate(l.endReading.reading_at) : ''}
                      </td>
                      <td className="text-right px-2 py-1 t-muted">{l.daysSpanned ?? '—'}</td>
                      <td className="text-right px-2 py-1" style={{ color: neg ? 'var(--color-danger)' : undefined }}>
                        {l.deltaRaw !== null ? fmtNum(l.deltaRaw) : '—'}
                      </td>
                      <td className="text-right px-2 py-1 t-muted">{l.multiplier !== 1 ? `×${l.multiplier}` : ''}</td>
                      <td className="text-right px-2 py-1 font-semibold" style={{ color: neg ? 'var(--color-danger)' : 'var(--color-text)' }}>
                        {l.usage !== null ? fmtNum(l.usage) : '—'}
                      </td>
                      <td className="py-1 pl-2">
                        <span className="t-muted" style={{ fontSize: '0.7rem' }}>
                          {l.unit === 'Cubic Feet' ? 'ft³' : l.unit.toLowerCase()}
                        </span>
                        {l.flags.map((f) => {
                          const fl = FLAG_LABEL[f];
                          const color =
                            fl.tone === 'bad' ? 'var(--color-danger)' :
                            fl.tone === 'warn' ? 'var(--color-warn, #d97706)' :
                            'var(--color-text-muted)';
                          return (
                            <span
                              key={f}
                              className="ml-2"
                              style={{ fontSize: '0.68rem', color, fontWeight: fl.tone === 'bad' ? 700 : 400 }}
                            >
                              ⚠ {fl.text}
                            </span>
                          );
                        })}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ))
      )}

      {/* Manual entry + readings browser */}
      <div className="mt-6 flex items-center gap-3 flex-wrap">
        {canEdit && !addingReading && (
          <button
            type="button"
            onClick={() => setAddingReading(true)}
            className="t-small"
            style={{
              background: 'none', border: '1px dashed var(--color-border)',
              borderRadius: 4, padding: '5px 12px',
              color: 'var(--color-text-muted)', cursor: 'pointer',
            }}
          >
            <span style={{ color: 'var(--color-accent)', fontWeight: 700 }}>+</span> Add manual reading
          </button>
        )}
        <button
          type="button"
          onClick={() => setShowReadings((v) => !v)}
          className="t-small t-muted"
          style={{ background: 'none', border: 'none', cursor: 'pointer' }}
        >
          {showReadings ? '▾ Hide' : '▸ Show'} all readings ({readings.length})
        </button>
      </div>

      {addingReading && (
        <AddReadingForm
          readings={readings}
          onClose={() => setAddingReading(false)}
          onError={setError}
        />
      )}

      {showReadings && (
        <ReadingsBrowser
          readings={readings}
          canEdit={canEdit}
          onDelete={(id, source) => {
            const what = source === 'excel_backfill'
              ? 'this BACKFILLED reading (imported from the Excel history)'
              : 'this manual reading';
            if (!confirm(`Remove ${what}? Soft delete — billing math for periods touching it will change.`)) return;
            del.mutate(id, { onError: (e) => setError((e as Error).message) });
          }}
        />
      )}
    </div>
  );
}

// ───────────────────────── manual entry

function AddReadingForm({
  readings, onClose, onError,
}: {
  readings: WaterReading[];
  onClose: () => void;
  onError: (m: string | null) => void;
}) {
  const add = useAddWaterReading();
  const [building, setBuilding] = useState('');
  const [label, setLabel] = useState('');
  const [unit, setUnit] = useState('Cubic Feet');
  const [value, setValue] = useState('');
  const [date, setDate] = useState(iso(new Date()));

  const buildings = useMemo(
    () => Array.from(new Set(readings.map((r) => r.building)))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true })),
    [readings],
  );
  const labelsForBuilding = useMemo(
    () => Array.from(new Set(readings.filter((r) => r.building === building).map((r) => r.meter_label))).sort(),
    [readings, building],
  );

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    onError(null);
    const v = Number(value);
    if (!building.trim() || !label.trim() || !date || !Number.isFinite(v)) {
      onError('Building, meter label, date, and a numeric value are required.');
      return;
    }
    try {
      await add.mutateAsync({
        building: building.trim(),
        meter_label: label.trim(),
        unit,
        value: v,
        // Noon ET (DST-correct) — manual entries are date-precision;
        // noon avoids any boundary ambiguity at midnight.
        reading_at: etNoonIso(date),
      });
      onClose();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Save failed.');
    }
  };

  return (
    <form
      onSubmit={submit}
      className="t-card mt-3"
      style={{ padding: 12, display: 'grid', gap: 8, maxWidth: 720, borderLeft: '3px solid var(--color-accent)' }}
    >
      <div className="t-small t-muted uppercase tracking-wider" style={{ fontSize: '0.65rem' }}>
        Add manual reading
      </div>
      <div className="grid gap-2" style={{ gridTemplateColumns: '90px 1fr 130px 130px 140px' }}>
        <label className="block">
          <div className="t-small t-muted" style={{ fontSize: '0.68rem', marginBottom: 2 }}>Bldg</div>
          <input type="text" value={building} onChange={(e) => setBuilding(e.target.value)}
            list="wm-buildings" className="t-mono" style={inputStyle} />
          <datalist id="wm-buildings">{buildings.map((b) => <option key={b} value={b} />)}</datalist>
        </label>
        <label className="block">
          <div className="t-small t-muted" style={{ fontSize: '0.68rem', marginBottom: 2 }}>Meter label (match existing for continuity)</div>
          <input type="text" value={label} onChange={(e) => setLabel(e.target.value)}
            list="wm-labels" style={inputStyle} placeholder='e.g. "Main Meter High (x10) (Water Room)"' />
          <datalist id="wm-labels">{labelsForBuilding.map((l) => <option key={l} value={l} />)}</datalist>
        </label>
        <label className="block">
          <div className="t-small t-muted" style={{ fontSize: '0.68rem', marginBottom: 2 }}>Unit</div>
          <select value={unit} onChange={(e) => setUnit(e.target.value)} style={inputStyle}>
            <option>Cubic Feet</option>
            <option>Gallons</option>
          </select>
        </label>
        <label className="block">
          <div className="t-small t-muted" style={{ fontSize: '0.68rem', marginBottom: 2 }}>Value</div>
          <input type="number" step="any" value={value} onChange={(e) => setValue(e.target.value)}
            className="t-mono" style={inputStyle} />
        </label>
        <label className="block">
          <div className="t-small t-muted" style={{ fontSize: '0.68rem', marginBottom: 2 }}>Date read</div>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={inputStyle} />
        </label>
      </div>
      <div className="flex gap-2">
        <button type="submit" disabled={add.isPending} className="t-small t-accent"
          style={{ padding: '5px 12px', border: '1px solid var(--color-accent)', borderRadius: 4, background: 'var(--color-card)' }}>
          {add.isPending ? 'Saving…' : 'Add reading'}
        </button>
        <button type="button" onClick={onClose} className="t-small t-muted"
          style={{ padding: '5px 12px', border: '1px solid var(--color-border)', borderRadius: 4, background: 'transparent' }}>
          Cancel
        </button>
      </div>
    </form>
  );
}

// ───────────────────────── readings browser

function ReadingsBrowser({
  readings, canEdit, onDelete,
}: {
  readings: WaterReading[];
  canEdit: boolean;
  onDelete: (manualId: string, source: WaterReading['source']) => void;
}) {
  const [bld, setBld] = useState('');
  const buildings = useMemo(
    () => Array.from(new Set(readings.map((r) => r.building)))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true })),
    [readings],
  );
  const rows = useMemo(() => {
    const filtered = bld ? readings.filter((r) => r.building === bld) : readings;
    return [...filtered].sort((a, b) => Date.parse(b.reading_at) - Date.parse(a.reading_at));
  }, [readings, bld]);

  return (
    <div className="mt-3">
      <div className="flex items-center gap-1.5 flex-wrap mb-2">
        <Preset label="All" onClick={() => setBld('')} active={bld === ''} />
        {buildings.map((b) => (
          <Preset key={b} label={b} onClick={() => setBld(bld === b ? '' : b)} active={bld === b} />
        ))}
      </div>
      <table className="t-mono t-small w-full" style={{ borderCollapse: 'collapse' }}>
        <thead>
          <tr className="t-muted">
            <th className="text-left pb-1 pr-3">Date (ET)</th>
            <th className="text-left pb-1 pr-3">Bldg</th>
            <th className="text-left pb-1 pr-3">Meter</th>
            <th className="text-right pb-1 px-2">Value</th>
            <th className="text-left pb-1 pl-2">Unit</th>
            <th className="text-left pb-1 pl-2">Source</th>
            {canEdit && <th />}
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, 300).map((r) => (
            <tr key={`${r.building}|${r.meter_label}|${r.reading_at}`} style={{ borderTop: '1px solid var(--color-border-soft)' }}>
              <td className="py-0.5 pr-3 t-muted">
                {new Date(r.reading_at).toLocaleString('en-US', {
                  timeZone: 'America/New_York', month: 'short', day: 'numeric', year: 'numeric',
                })}
              </td>
              <td className="py-0.5 pr-3">{r.building}</td>
              <td className="py-0.5 pr-3" style={{ maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.meter_label}>
                {r.meter_label}
              </td>
              <td className="text-right px-2 py-0.5">{fmtNum(r.value)}</td>
              <td className="py-0.5 pl-2 t-muted" style={{ fontSize: '0.7rem' }}>
                {r.unit === 'Cubic Feet' ? 'ft³' : 'gal'}
              </td>
              <td className="py-0.5 pl-2">
                <span
                  className="uppercase"
                  style={{
                    fontSize: '0.6rem', fontWeight: 600, letterSpacing: '0.05em',
                    color: r.source === 'plantlog' ? 'var(--color-ok, #10b981)'
                      : r.source === 'manual' ? 'var(--color-accent)'
                      : 'var(--color-text-muted)',
                  }}
                >
                  {r.source === 'excel_backfill' ? 'backfill' : r.source}
                </span>
              </td>
              {canEdit && (
                <td className="text-right py-0.5">
                  {r.manual_id && (
                    <button
                      type="button"
                      onClick={() => onDelete(r.manual_id!, r.source)}
                      title={r.source === 'excel_backfill'
                        ? 'Soft-delete this backfilled reading'
                        : 'Soft-delete this manual reading'}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-danger)', fontSize: '0.75rem' }}
                    >
                      ✕
                    </button>
                  )}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > 300 && (
        <p className="t-small t-muted mt-1">Showing newest 300 of {rows.length}.</p>
      )}
    </div>
  );
}

// ───────────────────────── atoms

function Preset({ label, onClick, active }: { label: string; onClick: () => void; active?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="t-small"
      style={{
        padding: '2px 10px',
        borderRadius: 10,
        border: '1px solid',
        borderColor: active ? 'var(--color-accent)' : 'var(--color-border)',
        background: active ? 'var(--color-accent)' : 'transparent',
        color: active ? 'white' : 'var(--color-text-muted)',
        fontWeight: active ? 700 : 400,
        cursor: 'pointer',
        fontSize: '0.72rem',
      }}
    >
      {label}
    </button>
  );
}

const dateInputStyle: React.CSSProperties = {
  padding: '4px 8px',
  borderRadius: 4,
  border: '1px solid var(--color-border)',
  background: 'var(--color-card)',
  color: 'var(--color-text)',
  font: 'inherit',
  fontSize: '0.8rem',
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '5px 8px',
  borderRadius: 4,
  border: '1px solid var(--color-border)',
  background: 'var(--color-card)',
  color: 'var(--color-text)',
  font: 'inherit',
  fontSize: '0.8rem',
};
