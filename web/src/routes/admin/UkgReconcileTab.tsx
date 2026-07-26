// PTO vs UKG reconciliation — admin tab.
//
// The company didn't buy UKG's PTO module: UKG is payroll-of-record only and
// managers key PTO into it by hand. This tab takes the UKG Excel export
// (one per site), parses it in the browser (SheetJS, dynamic import — same
// pattern as WaterBillingTab), and compares it against dashboard PTO via the
// pure lib web/src/lib/ukgReconcile.ts. Nothing is persisted — point-in-time
// check with CSV export.
//
// Gap colors, in hunt-priority order:
//   red    — approved in dashboard, MISSING from UKG (the payroll error)
//   violet — hours or type mismatch
//   amber  — in UKG, not in dashboard
//   muted  — unmatched names / unknown paycodes / pending-in-window
import { useMemo, useRef, useState } from 'react';
import { usePtoRequests, ptoTypeLabel, type PtoRequest } from '../../hooks/usePto';
import { useAllUsers } from '../../hooks/useEngineers';
import { useSiteUserIds } from '../../components/MyPtoSection';
import type { SiteCode } from '../../hooks/useSiteScope';
import {
  parseUkgAoa, reconcile, SITE_RULE, BINNEY_PTO_CUTOFF, UKG_REQUIRED,
  type ParsedUkg, type UkgField, type ReconcileResult, type ReconRequestInput,
  type RosterEntry, type GapRange, type GapKind,
} from '../../lib/ukgReconcile';

const FIELD_LABELS: Record<UkgField, string> = {
  employee: 'Employee',
  date: 'Date',
  end_date: 'End date',
  paycode: 'Pay code',
  hours: 'Hours',
};
const FIELD_ORDER: UkgField[] = ['employee', 'date', 'end_date', 'paycode', 'hours'];

const KIND_META: Record<GapKind, { title: string; tone: string; hint: string }> = {
  missing_in_ukg: {
    title: 'In dashboard, missing from UKG',
    tone: 'var(--color-danger)',
    hint: 'Approved PTO with no UKG entry — key it into UKG.',
  },
  hours_mismatch: {
    title: 'Hours mismatch',
    tone: '#a78bfa',
    hint: 'Both systems have the day but the hours differ.',
  },
  type_mismatch: {
    title: 'Type mismatch',
    tone: '#a78bfa',
    hint: 'Hours agree but the leave type differs.',
  },
  missing_in_dashboard: {
    title: 'In UKG, not in dashboard',
    tone: '#d97706',
    hint: 'UKG has an entry the dashboard never recorded — backfill the dashboard or question the UKG entry.',
  },
};

function fmtMd(iso: string): string {
  const [, m, d] = iso.split('-').map(Number);
  return `${m}/${d}`;
}
function fmtRange(start: string, end: string): string {
  return start === end ? fmtMd(start) : `${fmtMd(start)}–${fmtMd(end)}`;
}

/** Mounted once per site admin page (UPark admin and Binney admin each have
 *  their own tab) — the site is fixed per mount, matching the one-UKG-report-
 *  per-site workflow. */
export function UkgReconcileTab({ site }: { site: SiteCode }) {
  const [parsed, setParsed] = useState<ParsedUkg | null>(null);
  const [fileName, setFileName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const requestsQ = usePtoRequests();      // unscoped — filtered by site below
  const usersQ = useAllUsers();            // all roles (managers book PTO too)
  const siteIds = useSiteUserIds(site);

  const onFile = async (file: File) => {
    setError(null);
    try {
      const buf = await file.arrayBuffer();
      const head = new Uint8Array(buf.slice(0, 2));
      if (head[0] !== 0x50 || head[1] !== 0x4b) { // "PK" — xlsx is a zip
        setError('That file is not an .xlsx workbook — export the UKG report as Excel and try again.');
        return;
      }
      // SheetJS loads on demand — keeps it out of the main bundle.
      const XLSX = await import('xlsx');
      const wb = XLSX.read(buf, { type: 'array', cellDates: true });
      const ws = wb.Sheets[wb.SheetNames[0]];
      if (!ws) { setError('The workbook has no sheets.'); return; }
      const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true }) as unknown[][];
      const p = parseUkgAoa(aoa);
      setParsed(p);
      setFileName(file.name);
      if (p.headerRowIndex === -1) {
        setError('Could not find a header row (looked for Employee / Date / Hours in the first 10 rows).');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read the file.');
    }
  };

  const result: ReconcileResult | null = useMemo(() => {
    if (!parsed || parsed.entries.length === 0) return null;
    if (!siteIds || !usersQ.data || !requestsQ.data) return null; // wait for scoping — no fail-open here
    const roster: RosterEntry[] = usersQ.data
      .filter((u) => u.active && siteIds.has(u.user_id))
      .map((u) => ({ userId: u.user_id, fullName: u.full_name }));
    const requests: ReconRequestInput[] = (requestsQ.data as PtoRequest[])
      .filter((r) => siteIds.has(r.user_id))
      .map((r) => ({
        id: r.id, user_id: r.user_id, user_full_name: r.user_full_name,
        type: r.type, status: r.status, starts_on: r.starts_on, ends_on: r.ends_on,
        hours: r.hours, out_from: r.out_from, out_until: r.out_until,
      }));
    return reconcile({
      entries: parsed.entries,
      requests,
      roster,
      rule: SITE_RULE[site],
      cutoff: site === 'binney' ? BINNEY_PTO_CUTOFF : null,
    });
  }, [parsed, siteIds, usersQ.data, requestsQ.data, site]);

  const rangesByKind = useMemo(() => {
    const m: Record<GapKind, GapRange[]> = {
      missing_in_ukg: [], hours_mismatch: [], type_mismatch: [], missing_in_dashboard: [],
    };
    for (const r of result?.gapRanges ?? []) m[r.kind].push(r);
    return m;
  }, [result]);

  const exportCsv = () => {
    if (!result) return;
    const esc = (v: string | number | null) => {
      const s = v === null ? '' : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const rows: (string | number | null)[][] = [
      ['Gap', 'Name', 'From', 'To', 'Days', 'Dashboard hours', 'UKG hours', 'Dashboard type', 'UKG paycode'],
      ...result.gapRanges.map((r) => [
        KIND_META[r.kind].title, r.name, r.start, r.end, r.days,
        r.dashHours || null, r.ukgHours || null,
        r.dashTypes.map(ptoTypeLabel).join(' / '), r.ukgPaycodes.join(' / '),
      ]),
      ...result.unmatchedUkgNames.map((u) => [
        'Unmatched UKG name', u.rawName, '', '', u.entryCount, null, u.totalHours, '',
        u.suggestions.length ? `did you mean: ${u.suggestions.join(', ')}` : '',
      ]),
    ];
    const csv = rows.map((r) => r.map(esc).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ukg-reconcile-${site}-${result.window?.start ?? ''}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const scopeReady = !!siteIds && !!usersQ.data && !!requestsQ.data;

  return (
    <div className="space-y-4" style={{ maxWidth: 1100 }}>
      <div className="t-card" style={{ padding: '1rem' }}>
        <div className="flex items-baseline justify-between gap-3 flex-wrap mb-2">
          <div className="t-small t-muted uppercase tracking-wider">
            PTO vs UKG — payroll reconciliation
          </div>
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xls"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); }}
            className="t-small"
          />
        </div>
        <p className="t-small t-muted" style={{ margin: 0 }}>
          UKG is the payroll system of record; managers key PTO into it by hand. Drop the UKG
          Excel export for <b>{site === 'upark' ? 'UPark' : 'Binney St'}</b> to find keying gaps.
          Compare window = the report's own date span. {site === 'upark'
            ? 'UPark counts weekdays only.'
            : `Binney counts all days; dashboard history starts ${BINNEY_PTO_CUTOFF}.`}
          {' '}Nothing is saved — this is a point-in-time check.
        </p>
        {error && <p className="t-small t-danger mt-2 mb-0">{error}</p>}

        {parsed && parsed.headerRowIndex !== -1 && (
          <div className="mt-3">
            <div className="t-small t-muted mb-1">
              {fileName} · {parsed.entries.length} entries
              {parsed.periodStart && <> · {parsed.periodStart} → {parsed.periodEnd}</>}
              {parsed.skippedRows > 0 && <> · {parsed.skippedRows} rows skipped</>}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {FIELD_ORDER.map((f) => {
                const idx = parsed.mapping[f];
                const found = idx !== undefined;
                const required = (UKG_REQUIRED as UkgField[]).includes(f);
                return (
                  <span
                    key={f}
                    className="t-small t-mono"
                    style={{
                      padding: '2px 8px', borderRadius: 4,
                      border: '1px solid var(--color-border)',
                      background: found ? 'var(--color-card)' : 'transparent',
                      color: found ? 'var(--color-text)' : (required ? 'var(--color-danger)' : 'var(--color-text-muted)'),
                    }}
                    title={found ? `${FIELD_LABELS[f]} ← "${parsed.headers[idx!]}"` : `${FIELD_LABELS[f]} not detected`}
                  >
                    {FIELD_LABELS[f]} {found ? `← ${parsed.headers[idx!]}` : (required ? '✗ missing' : '—')}
                  </span>
                );
              })}
            </div>
            {parsed.missingFields.length > 0 && (
              <p className="t-small t-danger mt-2 mb-0">
                Can't compare — required column(s) not detected: {parsed.missingFields.join(', ')}.
                The column detectors were built before a real UKG sample was available; share this
                file's headers so they can be locked in.
              </p>
            )}
            {!scopeReady && parsed.missingFields.length === 0 && (
              <p className="t-small t-muted mt-2 mb-0">Loading roster…</p>
            )}
          </div>
        )}
      </div>

      {result && result.window && (
        <>
          {/* Summary tiles */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <SummaryTile label="Matched days" value={result.summary.matchedDays} />
            <SummaryTile label="Missing in UKG" value={result.summary.missingInUkgDays} tone="var(--color-danger)" />
            <SummaryTile label="Mismatched" value={result.summary.mismatchedDays} tone="#a78bfa" />
            <SummaryTile label="UKG only" value={result.summary.missingInDashboardDays} tone="#d97706" />
            <SummaryTile label="Unmatched names" value={result.unmatchedUkgNames.length} muted />
          </div>
          <p className="t-small t-muted" style={{ margin: 0 }}>
            Window {result.window.start} → {result.window.end}
            {' '}· dashboard {result.summary.dashComparedHours}h vs UKG {result.summary.ukgComparedHours}h compared
            {result.clippedToCutoff && (
              <> · <span style={{ color: '#d97706' }}>
                {result.entriesBeforeCutoff} UKG entr{result.entriesBeforeCutoff === 1 ? 'y' : 'ies'} before {result.clippedToCutoff} not
                compared — dashboard PTO history starts there
              </span></>
            )}
          </p>
          {result.rosterCollisions.length > 0 && (
            <p className="t-small t-danger" style={{ margin: 0 }}>
              Roster name collision (matching skipped for): {result.rosterCollisions.join(', ')}
            </p>
          )}

          {/* Gap sections in hunt order */}
          {(['missing_in_ukg', 'hours_mismatch', 'type_mismatch', 'missing_in_dashboard'] as GapKind[]).map((kind) => {
            const ranges = rangesByKind[kind];
            if (ranges.length === 0) return null;
            const meta = KIND_META[kind];
            return (
              <div key={kind} className="t-card" style={{ padding: '0.75rem 1rem', borderLeft: `3px solid ${meta.tone}` }}>
                <div className="t-small uppercase tracking-wider mb-0.5" style={{ color: meta.tone, fontWeight: 600 }}>
                  {meta.title} ({ranges.length})
                </div>
                <p className="t-small t-muted mb-2" style={{ marginTop: 0 }}>{meta.hint}</p>
                <ul className="space-y-1" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                  {ranges.map((r, i) => (
                    <li key={`${r.userId}-${r.start}-${i}`} className="t-small">
                      <b>{r.name}</b>
                      {' '}· {r.dashTypes.length > 0 ? r.dashTypes.map(ptoTypeLabel).join(' / ') : r.ukgPaycodes.join(' / ') || '—'}
                      {' '}· {fmtRange(r.start, r.end)}{r.days > 1 && ` (${r.days}d)`}
                      {' '}· <span className="t-muted">
                        dashboard {r.dashHours > 0 ? `${r.dashHours}h` : '—'} / UKG {r.ukgHours > 0 ? `${r.ukgHours}h` : '—'}
                      </span>
                      {kind !== 'missing_in_ukg' && r.ukgPaycodes.length > 0 && r.dashTypes.length > 0 && (
                        <span className="t-muted"> · code {r.ukgPaycodes.join('/')}</span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}

          {result.gaps.length === 0 && (
            <div className="t-card" style={{ padding: '1rem', borderLeft: '3px solid #10b981' }}>
              <span className="t-small" style={{ color: '#10b981', fontWeight: 600 }}>
                ✓ No gaps — dashboard and UKG agree for this window.
              </span>
            </div>
          )}

          {/* Unmatched names + unknown paycodes (paycodes come from the parse
              — report-wide, independent of the cutoff clip) */}
          {(result.unmatchedUkgNames.length > 0 || (parsed?.unknownPaycodes.length ?? 0) > 0) && (
            <div className="t-card" style={{ padding: '0.75rem 1rem' }}>
              {result.unmatchedUkgNames.length > 0 && (
                <>
                  <div className="t-small t-muted uppercase tracking-wider mb-1">
                    Unmatched UKG names ({result.unmatchedUkgNames.length}) — not compared
                  </div>
                  <ul className="space-y-1 mb-2" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                    {result.unmatchedUkgNames.map((u) => (
                      <li key={u.rawName} className="t-small">
                        <b>{u.rawName}</b> · {u.entryCount} entr{u.entryCount === 1 ? 'y' : 'ies'} · {u.totalHours}h
                        {u.suggestions.length > 0 && (
                          <span className="t-muted"> · did you mean {u.suggestions.join(', ')}?</span>
                        )}
                      </li>
                    ))}
                  </ul>
                </>
              )}
              {parsed && parsed.unknownPaycodes.length > 0 && (
                <>
                  <div className="t-small t-muted uppercase tracking-wider mb-1">
                    Unknown pay codes — hours compared, type skipped
                  </div>
                  <p className="t-small t-muted" style={{ margin: 0 }}>
                    {parsed.unknownPaycodes.map((u) => `${u.code} (${u.count}× · ${u.totalHours}h)`).join(' · ')}
                    {' '}— add to the paycode map in ukgReconcile.ts if these are real leave codes.
                  </p>
                </>
              )}
            </div>
          )}

          {/* Pending in window */}
          {result.pendingOverlaps.length > 0 && (
            <details className="t-card" style={{ padding: '0.75rem 1rem' }}>
              <summary className="t-small t-muted" style={{ cursor: 'pointer' }}>
                Pending requests in this window ({result.pendingOverlaps.length}) — not expected in UKG yet
              </summary>
              <ul className="space-y-1 mt-2" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                {result.pendingOverlaps.map((p) => (
                  <li key={p.requestId} className="t-small t-muted">
                    {p.name} · {ptoTypeLabel(p.type)} · {fmtRange(p.start, p.end)} · {p.hours}h
                  </li>
                ))}
              </ul>
            </details>
          )}

          <div>
            <button
              type="button"
              onClick={exportCsv}
              className="t-small t-accent"
              style={{
                padding: '6px 14px', border: '1px solid var(--color-accent)', borderRadius: 4,
                background: 'var(--color-card)',
              }}
            >
              Export gaps (CSV)
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function SummaryTile({ label, value, tone, muted }: {
  label: string; value: number; tone?: string; muted?: boolean;
}) {
  return (
    <div className="t-card" style={{ padding: '0.6rem 0.9rem' }}>
      <div className="t-small t-muted uppercase tracking-wider" style={{ fontSize: 10 }}>{label}</div>
      <div style={{
        fontSize: '1.4rem', fontWeight: 700,
        color: value > 0 ? (tone ?? 'var(--color-text)') : (muted ? 'var(--color-text-muted)' : 'var(--color-text)'),
      }}>
        {value}
      </div>
    </div>
  );
}
