// Year-end PTO close-out drawer (migration 0135). Shared by the UPark and
// Binney manager PTO panels — each passes its own site-scoped roster and
// summaries, so a manager only ever closes out their own building.
//
// Per engineer: sick carries at most 2 days and the rest is paid out;
// vacation is the manager's call (carry +/−, lose, or custom hours).
// Floating holiday never carries. Every run is written to
// pto_year_end_closeouts; a re-run or undo voids the prior row, so the log
// below keeps the whole history.
import { Fragment, useMemo, useRef, useState } from 'react';
import type { PtoSummary } from '../hooks/usePto';
import {
  usePtoCloseouts, usePtoDailyHoursMap, useClosePtoYear, useUndoPtoCloseout, useMarkPayoutPaid,
  sickCloseoutPreview, vacationCloseoutPreview, VACATION_ACTION_LABELS, SICK_CARRY_MAX_DAYS,
  type PtoCloseout, type VacationAction,
} from '../hooks/usePtoYearEnd';

type Roster = { user_id: string; full_name: string | null }[];

function fmtH(n: number): string {
  const v = Math.round(Number(n) * 100) / 100;
  return `${v}h`;
}

function fmtDate(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()}/${String(d.getFullYear()).slice(2)}`;
}

function csvCell(v: unknown): string {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function PtoYearEndModal({
  fromYear, summaries, roster, siteDefaultDaily, siteLabel, onClose,
}: {
  fromYear: number;
  /** Site-scoped v_pto_summary rows (any year — filtered here). */
  summaries: PtoSummary[];
  /** Active engineers of this site. */
  roster: Roster;
  /** Site default hours per day (UPark 8, Binney 10). */
  siteDefaultDaily: number;
  siteLabel: string;
  onClose: () => void;
}) {
  const closeoutsQ = usePtoCloseouts(fromYear);
  const dailyQ     = usePtoDailyHoursMap();
  const close      = useClosePtoYear();
  const undo       = useUndoPtoCloseout();
  const markPaid   = useMarkPayoutPaid();

  const [actions, setActions] = useState<Record<string, VacationAction>>({});
  const [customs, setCustoms] = useState<Record<string, string>>({});
  const [busy, setBusy]       = useState<string | null>(null);
  const [err, setErr]         = useState<string | null>(null);
  // Set by Cancel so a running "close out all" stops after the current one.
  const cancelRef = useRef(false);
  const [bulkRunning, setBulkRunning] = useState(false);

  const rosterIds = useMemo(() => new Set(roster.map((r) => r.user_id)), [roster]);
  const nameOf = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of roster) m.set(r.user_id, r.full_name ?? '?');
    for (const s of summaries) if (s.user_full_name) m.set(s.user_id, s.user_full_name);
    return m;
  }, [roster, summaries]);

  const byUser = useMemo(() => {
    const m = new Map<string, PtoSummary>();
    for (const s of summaries) if (s.year === fromYear) m.set(s.user_id, s);
    return m;
  }, [summaries, fromYear]);

  // Site-scoped log (closeouts table isn't site-aware; the roster is).
  const siteLog = useMemo(
    () => (closeoutsQ.data ?? []).filter((c) => rosterIds.has(c.user_id)),
    [closeoutsQ.data, rosterIds],
  );
  const activeByUser = useMemo(() => {
    const m = new Map<string, PtoCloseout>();
    for (const c of siteLog) if (!c.voided_at) m.set(c.user_id, c);
    return m;
  }, [siteLog]);

  const rows = roster
    .slice()
    .sort((a, b) => (a.full_name ?? '').localeCompare(b.full_name ?? ''))
    .map((r) => {
      const s = byUser.get(r.user_id);
      const override = dailyQ.data?.get(r.user_id);
      const daily = override != null ? override : siteDefaultDaily;
      const vacRem = Number(s?.vacation_remaining ?? 0);
      const sickRem = Number(s?.sick_remaining ?? 0);
      const active = activeByUser.get(r.user_id) ?? null;
      const action: VacationAction = actions[r.user_id] ?? active?.vacation_action ?? 'carry';
      const customStr = customs[r.user_id]
        ?? (active?.vacation_action === 'custom' ? String(active.vacation_carryover_hours) : '');
      const custom = customStr === '' ? null : Number(customStr);
      return {
        user_id: r.user_id,
        name: r.full_name ?? '?',
        hasBalance: !!s,
        daily, vacRem, sickRem, active, action, customStr, custom,
        sick: sickCloseoutPreview(sickRem, daily),
        vac: vacationCloseoutPreview(vacRem, action, custom),
      };
    });

  const runOne = async (row: typeof rows[number]) => {
    if (row.action === 'custom' && (row.custom == null || Number.isNaN(row.custom))) {
      setErr(`${row.name}: enter the custom vacation hours to carry.`);
      return;
    }
    setErr(null);
    setBusy(row.user_id);
    try {
      await close.mutateAsync({
        user_id: row.user_id,
        from_year: fromYear,
        vacation_action: row.action,
        vacation_custom: row.action === 'custom' ? row.custom : null,
      });
    } catch (e) {
      setErr(`${row.name}: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  const openRows = rows.filter((r) => !r.active);
  const runAllOpen = async () => {
    if (!confirm(`Close out ${openRows.length} engineer(s) for ${fromYear} with the choices shown?`)) return;
    cancelRef.current = false;
    setBulkRunning(true);
    try {
      for (const r of openRows) {
        if (cancelRef.current) break;
        await runOne(r);
      }
    } finally {
      setBulkRunning(false);
    }
  };

  // Cancel: close without saving the unsaved vacation choices. Mid-run it
  // stops the batch instead — anyone already closed out stays (undo per row).
  const onCancel = () => {
    if (bulkRunning) {
      cancelRef.current = true;
      setErr('Stopped — anyone already closed out stays closed (use undo on their row).');
      return;
    }
    onClose();
  };

  const downloadCsv = () => {
    const head = [
      'Engineer', 'From year', 'To year', 'Closed', 'Status',
      'Vacation left', 'Vacation decision', 'Vacation carried', 'Vacation forfeited',
      'Sick left', 'Sick carry cap', 'Sick carried', 'Sick payout', 'Payout paid',
      'Floater forfeited', 'Notes',
    ];
    const lines = siteLog.map((c) => [
      nameOf.get(c.user_id) ?? c.user_id, c.from_year, c.to_year, fmtDate(c.closed_at),
      c.voided_at ? `voided ${fmtDate(c.voided_at)}` : 'active',
      c.vacation_remaining, VACATION_ACTION_LABELS[c.vacation_action],
      c.vacation_carryover_hours, c.vacation_forfeit_hours,
      c.sick_remaining, c.sick_carry_cap, c.sick_carryover_hours, c.sick_payout_hours,
      c.payout_paid_at ? fmtDate(c.payout_paid_at) : '',
      c.holiday_forfeit_hours, c.notes ?? '',
    ].map(csvCell).join(','));
    const blob = new Blob([[head.join(','), ...lines].join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `PTO_${siteLabel}_closeout_${fromYear}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const now = new Date();
  const early = now.getFullYear() === fromYear && now.getMonth() < 11;
  const totalPayout = rows.reduce((t, r) => t + (r.active ? Number(r.active.sick_payout_hours) : 0), 0);
  const migrationMissing = !!closeoutsQ.error;

  const th = 'py-1 px-1.5 text-right';
  const td = 'py-1 px-1.5 text-right t-mono align-top';
  const sep = { borderLeft: '1px solid var(--color-border-soft)' };

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.25)',
        display: 'flex', justifyContent: 'flex-end', zIndex: 50,
      }}
    >
      <div
        className="t-card"
        style={{
          width: 'min(1060px, 98vw)', height: '100%', overflow: 'auto', padding: '1.25rem',
          borderLeft: '1px solid var(--color-border)', boxShadow: '-8px 0 24px rgba(0,0,0,0.25)',
        }}
      >
        <div className="flex items-center justify-between mb-2">
          <h3 className="t-section-title">{siteLabel} · {fromYear} → {fromYear + 1} year-end close-out</h3>
          <button onClick={onCancel} className="t-small t-muted" title="Cancel">✕</button>
        </div>

        <p className="t-small t-muted mb-1">
          <strong>Sick:</strong> up to {SICK_CARRY_MAX_DAYS} days carry into {fromYear + 1}; anything over is paid out.{' '}
          <strong>Vacation:</strong> your call per engineer — carry the balance (even if negative), lose it, or carry a custom amount.{' '}
          <strong>Floating holiday</strong> doesn’t carry.
        </p>
        <p className="t-small t-muted mb-3">
          Each close-out is logged. You can re-run or undo one any time — the old entry is kept as “voided”.
        </p>

        {early && (
          <p className="t-small mb-3" style={{ color: '#b45309' }}>
            It’s still {now.toLocaleString('en-US', { month: 'long' })} — {fromYear} balances can change before 12/31. Closing now is fine; just re-run anyone whose balance moves.
          </p>
        )}
        {migrationMissing && (
          <p className="t-small t-danger mb-3">
            Close-out tables aren’t in the database yet (migration 0135). Previews below are accurate, but nothing can be saved until it’s applied.
          </p>
        )}

        <table className="t-text t-small border-collapse" style={{ width: '100%' }}>
          <thead>
            <tr className="t-muted text-left" style={{ borderBottom: '1px solid var(--color-border-soft)' }}>
              <th className="py-1 pr-2">Engineer</th>
              <th className={th} style={sep}>Vac left</th>
              <th className="py-1 px-1.5">Vacation decision</th>
              <th className={th}>Carries</th>
              <th className={th}>Forfeit</th>
              <th className={th} style={sep}>Sick left</th>
              <th className={th}>Carries</th>
              <th className={th}>Payout</th>
              <th className="py-1 pl-2" style={sep}></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.user_id} style={{ borderBottom: '1px solid var(--color-border-soft)' }}>
                <td className="py-1 pr-2 align-top">
                  <div className="font-medium">{r.name}</div>
                  {!r.hasBalance && <div className="t-muted" style={{ fontSize: '0.7rem' }}>no {fromYear} balance</div>}
                  {r.active && (
                    <div className="t-muted" style={{ fontSize: '0.7rem' }}>
                      closed {fmtDate(r.active.closed_at)}
                    </div>
                  )}
                </td>
                <td className={td} style={{ ...sep, color: r.vacRem < 0 ? 'var(--color-danger)' : undefined }}>{fmtH(r.vacRem)}</td>
                <td className="py-1 px-1.5 align-top" style={{ whiteSpace: 'nowrap' }}>
                  <select
                    value={r.action}
                    onChange={(e) => setActions((a) => ({ ...a, [r.user_id]: e.target.value as VacationAction }))}
                    className="border rounded px-1 py-0.5 t-small"
                    style={{ borderColor: 'var(--color-border)', background: 'var(--color-card)' }}
                  >
                    {(Object.keys(VACATION_ACTION_LABELS) as VacationAction[]).map((k) => (
                      <option key={k} value={k}>{VACATION_ACTION_LABELS[k]}</option>
                    ))}
                  </select>
                  {r.action === 'custom' && (
                    <input
                      type="number" step={0.5} value={r.customStr} placeholder="h"
                      onChange={(e) => setCustoms((c) => ({ ...c, [r.user_id]: e.target.value }))}
                      className="border rounded px-1 py-0.5 t-small t-mono ml-1"
                      style={{ width: 64, borderColor: 'var(--color-border)', background: 'var(--color-card)' }}
                      title="Hours to carry — can be negative"
                    />
                  )}
                </td>
                <td className={td} style={{ color: r.vac.carry < 0 ? 'var(--color-danger)' : undefined }}>{fmtH(r.vac.carry)}</td>
                <td className={`${td} t-muted`}>{r.vac.forfeit === 0 ? '—' : fmtH(r.vac.forfeit)}</td>
                <td className={td} style={{ ...sep, color: r.sickRem < 0 ? 'var(--color-danger)' : undefined }}>{fmtH(r.sickRem)}</td>
                <td className={td} title={`Max ${SICK_CARRY_MAX_DAYS} days × ${r.daily}h = ${r.sick.cap}h`}>{fmtH(r.sick.carry)}</td>
                <td className={td}>
                  {r.sick.payout > 0 ? <strong>{fmtH(r.sick.payout)}</strong> : <span className="t-muted">—</span>}
                  {r.active && Number(r.active.sick_payout_hours) > 0 && (
                    <label className="block t-muted" style={{ fontSize: '0.7rem', whiteSpace: 'nowrap' }}>
                      <input
                        type="checkbox"
                        checked={!!r.active.payout_paid_at}
                        onChange={(e) => markPaid.mutate({ id: r.active!.id, paid: e.target.checked })}
                        style={{ marginRight: 3 }}
                      />
                      {r.active.payout_paid_at ? `paid ${fmtDate(r.active.payout_paid_at)}` : 'paid?'}
                    </label>
                  )}
                </td>
                <td className="py-1 pl-2 text-right align-top" style={{ ...sep, whiteSpace: 'nowrap' }}>
                  <button
                    onClick={() => runOne(r)}
                    disabled={busy !== null || migrationMissing}
                    className="t-small px-2 py-0.5 rounded font-medium disabled:opacity-50"
                    style={r.active
                      ? { border: '1px solid var(--color-border)' }
                      : { background: 'var(--color-accent)', color: '#fff' }}
                  >
                    {busy === r.user_id ? '…' : r.active ? 'Re-run' : 'Close out'}
                  </button>
                  {r.active && (
                    <button
                      onClick={() => {
                        if (confirm(`Undo ${r.name}'s ${fromYear} close-out? Their ${fromYear + 1} carryover goes back to 0.`)) {
                          undo.mutate({ user_id: r.user_id, from_year: fromYear }, {
                            onError: (e) => setErr((e as Error).message),
                          });
                        }
                      }}
                      className="t-small t-muted hover:underline ml-2"
                    >
                      undo
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {err && <p className="t-small t-danger mt-2">{err}</p>}

        <div className="flex items-center justify-between gap-2 mt-3 flex-wrap">
          <span className="t-small t-muted">
            {rows.length - openRows.length} of {rows.length} closed
            {totalPayout > 0 && <> · sick payout logged: <strong>{fmtH(totalPayout)}</strong></>}
          </span>
          <div className="flex gap-2">
            <button
              onClick={onCancel}
              className="t-small px-3 py-1 rounded border"
              style={{ borderColor: 'var(--color-border)' }}
              title={bulkRunning
                ? 'Stop after the current engineer'
                : 'Close without saving — nothing changes for rows you haven’t closed out'}
            >
              {bulkRunning ? 'Stop' : 'Cancel'}
            </button>
            <button
              onClick={runAllOpen}
              disabled={openRows.length === 0 || busy !== null || migrationMissing}
              className="t-small px-3 py-1 rounded font-medium text-white disabled:opacity-50"
              style={{ background: 'var(--color-accent)' }}
            >
              Close out all remaining ({openRows.length})
            </button>
          </div>
        </div>

        {/* Record / log */}
        <div className="mt-5">
          <div className="flex items-baseline justify-between mb-1">
            <div className="t-small t-muted uppercase tracking-wider">Close-out log · {fromYear}</div>
            {siteLog.length > 0 && (
              <button onClick={downloadCsv} className="t-small t-accent hover:underline">⤓ CSV (payroll)</button>
            )}
          </div>
          {siteLog.length === 0 ? (
            <p className="t-small t-muted italic">Nothing closed out for {fromYear} yet.</p>
          ) : (
            <table className="t-text t-small border-collapse" style={{ width: '100%' }}>
              <thead>
                <tr className="t-muted text-left" style={{ borderBottom: '1px solid var(--color-border-soft)' }}>
                  <th className="py-1 pr-2">When</th>
                  <th className="py-1 pr-2">Engineer</th>
                  <th className="py-1 pr-2">Vacation</th>
                  <th className="py-1 pr-2">Sick</th>
                  <th className="py-1 pr-2">Floater</th>
                  <th className="py-1 pr-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {siteLog.map((c) => (
                  <Fragment key={c.id}>
                    <tr
                      style={{
                        borderBottom: '1px solid var(--color-border-soft)',
                        opacity: c.voided_at ? 0.5 : 1,
                        textDecoration: c.voided_at ? 'line-through' : undefined,
                      }}
                    >
                      <td className="py-1 pr-2 t-mono">{fmtDate(c.closed_at)}</td>
                      <td className="py-1 pr-2">{nameOf.get(c.user_id) ?? '?'}</td>
                      <td className="py-1 pr-2">
                        {fmtH(c.vacation_remaining)} left · {VACATION_ACTION_LABELS[c.vacation_action].toLowerCase()} → carried {fmtH(c.vacation_carryover_hours)}
                        {Number(c.vacation_forfeit_hours) !== 0 && <>, forfeited {fmtH(c.vacation_forfeit_hours)}</>}
                      </td>
                      <td className="py-1 pr-2">
                        {fmtH(c.sick_remaining)} left → carried {fmtH(c.sick_carryover_hours)}
                        {Number(c.sick_payout_hours) > 0 && <>, <strong>paid out {fmtH(c.sick_payout_hours)}</strong></>}
                      </td>
                      <td className="py-1 pr-2">{Number(c.holiday_forfeit_hours) > 0 ? `${fmtH(c.holiday_forfeit_hours)} lost` : '—'}</td>
                      <td className="py-1 pr-2 t-muted">
                        {c.voided_at ? `voided ${fmtDate(c.voided_at)}` : 'active'}
                        {!c.voided_at && Number(c.sick_payout_hours) > 0 && (c.payout_paid_at ? ' · paid' : ' · payout pending')}
                      </td>
                    </tr>
                  </Fragment>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
