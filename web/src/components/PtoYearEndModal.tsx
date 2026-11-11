// Year-end PTO close-out drawer (migration 0135). Shared by the UPark and
// Binney manager PTO panels — each passes its own site-scoped roster and
// summaries, so a manager only ever closes out their own building.
//
// Per engineer: sick carries at most 10 days and the rest is paid out;
// vacation never carries — lost by default, with a small "pay out" override
// for the rare special case (e.g. out on FMLA to year-end); floating holiday
// is use-it-or-lose-it (no carry, no payout). Every run is written to
// pto_year_end_closeouts; a re-run or undo voids the prior row, so the log
// below keeps the whole history.
import { Fragment, useMemo, useState } from 'react';
import type { PtoSummary } from '../hooks/usePto';
import {
  usePtoCloseouts, usePtoDailyHoursMap, useClosePtoYear, useUndoPtoCloseout, useMarkPayoutPaid,
  sickCloseoutPreview, vacationCloseoutPreview, VACATION_ACTION_LABELS, SICK_CARRY_MAX_DAYS,
  floaterDays, fmtDays, cbaAllotment,
  type PtoCloseout, type VacationAction,
} from '../hooks/usePtoYearEnd';

type Roster = { user_id: string; full_name: string | null; hire_date?: string | null }[];

function fmtH(n: number): string {
  const v = Math.round(Number(n) * 100) / 100;
  return `${v}h`;
}

function fmtDate(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()}/${String(d.getFullYear()).slice(2)}`;
}

/** Total hours owed to the engineer: sick over the cap + any vacation payout. */
function payoutOf(c: PtoCloseout): number {
  return Number(c.sick_payout_hours) + Number(c.vacation_payout_hours ?? 0);
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
  // Rows whose next-year projection is open ("Calculate" → review → "Close out").
  const [calcOpen, setCalcOpen] = useState<Set<string>>(new Set());
  const toggleCalc = (uid: string) => setCalcOpen((cur) => {
    const next = new Set(cur);
    if (next.has(uid)) next.delete(uid); else next.add(uid);
    return next;
  });
  // Manager edits to the projected allotment, per engineer. Vacation and
  // sick in hours, floater in days. Unset fields fall back to the CBA rule.
  const [allotEdits, setAllotEdits] = useState<Record<string, { vacation?: string; sick?: string; holiday?: string }>>({});
  const setAllot = (uid: string, k: 'vacation' | 'sick' | 'holiday', v: string) =>
    setAllotEdits((m) => ({ ...m, [uid]: { ...m[uid], [k]: v } }));
  const [busy, setBusy]       = useState<string | null>(null);
  const [err, setErr]         = useState<string | null>(null);

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

  // Next year's rows — an allotment the manager already set wins over the
  // CBA rule in the projection.
  const nextByUser = useMemo(() => {
    const m = new Map<string, PtoSummary>();
    for (const s of summaries) if (s.year === fromYear + 1) m.set(s.user_id, s);
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
      // Floater: use it or lose it — whatever is left is lost.
      const floaterLost = Math.max(Number(s?.holiday_remaining ?? 0), 0);
      const active = activeByUser.get(r.user_id) ?? null;
      // Default is always "lose"; "payout" only when the manager picks it
      // (or an earlier close-out of this engineer already chose it).
      const picked = actions[r.user_id] ?? (active?.vacation_action === 'payout' ? 'payout' : 'lose');
      const action: VacationAction = vacRem > 0 ? picked : 'lose';
      const sick = sickCloseoutPreview(sickRem, daily);
      const vac = vacationCloseoutPreview(vacRem, action);
      // Next-year projection: allotment (already set, else the CBA rule by
      // hire date) plus what this close-out carries in.
      const next = nextByUser.get(r.user_id);
      const nextSet = !!next && (
        Number(next.vacation_alloted) > 0 || Number(next.sick_alloted) > 0 || Number(next.holiday_alloted) > 0
      );
      const cba = cbaAllotment(r.hire_date, fromYear + 1, daily, s ? Number(s.holiday_alloted) : null);
      // CBA rule values (0 / last year's floater when there's no hire date).
      const rule = {
        vacation: cba?.vacation ?? 0,
        sick: cba?.sick ?? 0,
        holiday: cba?.holiday ?? (s ? Number(s.holiday_alloted) : daily),
      };
      const ed = allotEdits[r.user_id] ?? {};
      const num = (v: string | undefined, fallback: number) =>
        v === undefined ? fallback : (Number(v) || 0);
      const allot = nextSet
        ? { vacation: Number(next!.vacation_alloted), sick: Number(next!.sick_alloted), holiday: Number(next!.holiday_alloted) }
        : {
            vacation: num(ed.vacation, rule.vacation),
            sick: num(ed.sick, rule.sick),
            holiday: ed.holiday === undefined ? rule.holiday : (Number(ed.holiday) || 0) * daily,
          };
      const proj = {
        source: nextSet ? 'set' as const : 'cba' as const,
        basis: cba?.basis ?? null,
        rule,
        allot,
        vacation: allot.vacation + vac.carry,
        sick: allot.sick + sick.carry,
        floater: floaterDays(allot.holiday, daily),
      };
      return {
        proj,
        user_id: r.user_id,
        name: r.full_name ?? '?',
        hasBalance: !!s,
        daily, vacRem, sickRem, floaterLost, active, action, sick, vac,
        payout: sick.payout + vac.payout,
      };
    });

  const runOne = async (row: typeof rows[number]) => {
    setErr(null);
    setBusy(row.user_id);
    try {
      await close.mutateAsync({
        user_id: row.user_id,
        from_year: fromYear,
        vacation_action: row.action,
        // Saves next year's allotment with the close-out unless one is set.
        allot: row.proj.source === 'set' ? null : row.proj.allot,
      });
    } catch (e) {
      setErr(`${row.name}: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  const closedCount = rows.filter((r) => r.active).length;

  // Cancel: close the drawer. Vacation choices not yet closed out are
  // dropped; anyone already closed out stays (undo per row).
  const onCancel = () => onClose();

  const downloadCsv = () => {
    const head = [
      'Engineer', 'From year', 'To year', 'Closed', 'Status',
      'Vacation left', 'Vacation decision', 'Vacation lost', 'Vacation payout', 'Vacation owed (deducted next year)',
      'Sick left', 'Sick carry cap', 'Sick carried', 'Sick payout', 'Total payout', 'Payout paid',
      'Floater lost (days)',
      'Next-year vacation allotment saved', 'Next-year sick allotment saved', 'Next-year floater saved (days)', 'Notes',
    ];
    const lines = siteLog.map((c) => [
      nameOf.get(c.user_id) ?? c.user_id, c.from_year, c.to_year, fmtDate(c.closed_at),
      c.voided_at ? `voided ${fmtDate(c.voided_at)}` : 'active',
      c.vacation_remaining, VACATION_ACTION_LABELS[c.vacation_action] ?? c.vacation_action,
      c.vacation_forfeit_hours, c.vacation_payout_hours,
      Number(c.vacation_carryover_hours) < 0 ? -Number(c.vacation_carryover_hours) : 0,
      c.sick_remaining, c.sick_carry_cap, c.sick_carryover_hours, c.sick_payout_hours,
      payoutOf(c),
      c.payout_paid_at ? fmtDate(c.payout_paid_at) : '',
      floaterDays(c.holiday_forfeit_hours, Number(c.daily_hours)),
      c.next_vacation_alloted ?? '', c.next_sick_alloted ?? '',
      c.next_holiday_alloted != null ? floaterDays(c.next_holiday_alloted, Number(c.daily_hours)) : '',
      c.notes ?? '',
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
  const totalPayout = rows.reduce((t, r) => t + (r.active ? payoutOf(r.active) : 0), 0);
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
          <strong>Vacation:</strong> doesn’t carry — unused hours are lost. In a special case (e.g. out on FMLA to year-end) switch that engineer to “pay out”. Over-used (negative) vacation is deducted from {fromYear + 1}.{' '}
          <strong>Floating holiday:</strong> use it or lose it — no carry, no payout.
        </p>
        <p className="t-small t-muted mb-3">
          Click <strong>Calculate</strong> on an engineer to see their projected {fromYear + 1} balances, then <strong>Close out</strong> on that row to confirm. Closing out also saves the {fromYear + 1} allotment shown (CBA rule — adjust it first if needed), unless one is already set. Each close-out is logged; you can redo or undo one any time — the old entry is kept as “voided”.
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
              <th className={th}>Unused vacation</th>
              <th className={th} style={sep}>Sick left</th>
              <th className={th}>Carries</th>
              <th className={th} style={sep}>Floater</th>
              <th className={th} style={sep}>Payout</th>
              <th className="py-1 pl-2" style={sep}></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <Fragment key={r.user_id}>
              <tr style={{ borderBottom: calcOpen.has(r.user_id) ? 'none' : '1px solid var(--color-border-soft)' }}>
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
                <td className={td} style={{ whiteSpace: 'nowrap' }}>
                  {r.vacRem > 0 ? (
                    <>
                      {r.action === 'payout'
                        ? <strong>{fmtH(r.vac.payout)}</strong>
                        : <span className="t-muted">{fmtH(r.vac.forfeit)}</span>}
                      {/* Deliberately small + muted: paying vacation out is the rare exception. */}
                      <select
                        value={r.action}
                        onChange={(e) => setActions((a) => ({ ...a, [r.user_id]: e.target.value as VacationAction }))}
                        className="rounded ml-1"
                        style={{
                          fontSize: '0.68rem', padding: '0 2px', height: 18,
                          border: '1px solid ' + (r.action === 'payout' ? 'var(--color-accent)' : 'var(--color-border-soft)'),
                          background: 'transparent',
                          color: r.action === 'payout' ? 'var(--color-accent)' : 'var(--color-text-muted)',
                        }}
                        title="Unused vacation is lost. Pay out only in a special case (e.g. out on FMLA to year-end)."
                      >
                        <option value="lose">lost</option>
                        <option value="payout">pay out</option>
                      </select>
                    </>
                  ) : r.vacRem < 0 ? (
                    <span
                      style={{ color: 'var(--color-danger)' }}
                      title={`Over-used vacation: ${fmtH(-r.vac.carry)} comes off the ${fromYear + 1} vacation balance`}
                    >
                      −{fmtH(-r.vac.carry)} off {fromYear + 1}
                    </span>
                  ) : (
                    <span className="t-muted">—</span>
                  )}
                </td>
                <td className={td} style={{ ...sep, color: r.sickRem < 0 ? 'var(--color-danger)' : undefined }}>{fmtH(r.sickRem)}</td>
                <td className={td} title={`Max ${SICK_CARRY_MAX_DAYS} days × ${r.daily}h = ${r.sick.cap}h`}>{fmtH(r.sick.carry)}</td>
                <td className={`${td} t-muted`} style={sep} title="Floating holiday: use it or lose it — no carry, no payout">
                  {r.floaterLost > 0 ? `${fmtDays(floaterDays(r.floaterLost, r.daily))} lost` : '—'}
                </td>
                <td
                  className={td}
                  style={sep}
                  title={r.payout > 0 ? `Sick ${fmtH(r.sick.payout)} + vacation ${fmtH(r.vac.payout)}` : undefined}
                >
                  {r.payout > 0 ? <strong>{fmtH(r.payout)}</strong> : <span className="t-muted">—</span>}
                  {r.active && payoutOf(r.active) > 0 && (
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
                  {/* Step 1: Calculate shows the next-year projection under the
                      name; step 2 (Close out) lives on that projection row. */}
                  <button
                    onClick={() => toggleCalc(r.user_id)}
                    className="t-small px-2 py-0.5 rounded font-medium"
                    style={r.active || calcOpen.has(r.user_id)
                      ? { border: '1px solid var(--color-border)' }
                      : { background: 'var(--color-accent)', color: '#fff' }}
                    title={`Show ${r.name}'s projected ${fromYear + 1} balances before closing out`}
                  >
                    {calcOpen.has(r.user_id) ? 'Hide' : r.active ? 'Recalculate' : 'Calculate'}
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
              {calcOpen.has(r.user_id) && (
                <tr style={{ borderBottom: '1px solid var(--color-border-soft)', background: 'rgba(0,0,0,0.025)' }}>
                  <td colSpan={7} className="py-1.5 pr-2" style={{ paddingLeft: 12 }}>
                    <div className="t-small">
                      <span className="t-muted uppercase tracking-wider" style={{ fontSize: '0.68rem' }}>
                        {fromYear + 1} projection
                      </span>
                      {' · '}Vacation <strong style={{ color: r.proj.vacation < 0 ? 'var(--color-danger)' : undefined }}>{fmtH(r.proj.vacation)}</strong>
                      <span className="t-muted">
                        {' '}({fmtH(r.proj.allot.vacation)} allotment{r.vac.carry < 0 ? ` − ${fmtH(-r.vac.carry)} over-used in ${fromYear}` : ''})
                      </span>
                      {' · '}Sick <strong style={{ color: r.proj.sick < 0 ? 'var(--color-danger)' : undefined }}>{fmtH(r.proj.sick)}</strong>
                      <span className="t-muted">
                        {' '}({fmtH(r.proj.allot.sick)} allotment
                        {r.sick.carry > 0 ? ` + ${fmtH(r.sick.carry)} carried` : r.sick.carry < 0 ? ` − ${fmtH(-r.sick.carry)} over-used in ${fromYear}` : ''})
                      </span>
                      {' · '}Floater <strong>{fmtDays(r.proj.floater)}</strong>
                    </div>
                    {r.proj.source === 'set' ? (
                      <div className="t-small t-muted" style={{ fontSize: '0.7rem' }}>
                        {fromYear + 1} allotment is already set — close-out keeps it and only adds the carry-over. Change it with “edit” in Balances.
                      </div>
                    ) : (
                      <div className="t-small flex items-center flex-wrap" style={{ gap: 8, marginTop: 3 }}>
                        <span className="t-muted" style={{ fontSize: '0.7rem' }}>{fromYear + 1} allotment to save:</span>
                        {([
                          ['vacation', 'Vacation', 'h', r.proj.rule.vacation, r.proj.allot.vacation],
                          ['sick', 'Sick', 'h', r.proj.rule.sick, r.proj.allot.sick],
                          ['holiday', 'Floater', 'days', floaterDays(r.proj.rule.holiday, r.daily), floaterDays(r.proj.allot.holiday, r.daily)],
                        ] as const).map(([k, label, unit, ruleVal, cur]) => (
                          <label key={k} className="t-muted" style={{ fontSize: '0.7rem', whiteSpace: 'nowrap' }}>
                            {label}{' '}
                            <input
                              type="number" min={0} step={1}
                              value={allotEdits[r.user_id]?.[k] ?? String(ruleVal)}
                              onChange={(e) => setAllot(r.user_id, k, e.target.value)}
                              className="border rounded px-1 t-mono text-right"
                              style={{
                                width: 56, height: 20, fontSize: '0.72rem', background: 'var(--color-card)',
                                borderColor: cur !== ruleVal ? 'var(--color-accent)' : 'var(--color-border)',
                              }}
                              title={cur !== ruleVal ? `CBA rule: ${ruleVal} ${unit} — you changed it` : 'CBA rule value — edit to override'}
                            />{' '}{unit}
                          </label>
                        ))}
                        <span className="t-muted" style={{ fontSize: '0.7rem' }}>
                          {r.proj.basis ? `CBA rule: ${r.proj.basis}` : 'no hire date on file — enter the allotment by hand'}
                        </span>
                      </div>
                    )}
                    <div className="t-small t-muted" style={{ fontSize: '0.7rem', marginTop: 2 }}>
                      At close-out: {r.payout > 0 ? <strong>{fmtH(r.payout)} paid out</strong> : 'nothing paid out'}
                      {r.vac.forfeit > 0 && ` · ${fmtH(r.vac.forfeit)} vacation lost`}
                      {r.floaterLost > 0 && ` · ${fmtDays(floaterDays(r.floaterLost, r.daily))} floater lost`}
                    </div>
                  </td>
                  <td className="py-1.5 pl-2 text-right align-top" style={{ ...sep, whiteSpace: 'nowrap' }}>
                    <button
                      onClick={() => runOne(r)}
                      disabled={busy !== null || migrationMissing || dailyQ.isLoading}
                      className="t-small px-2 py-0.5 rounded font-medium text-white disabled:opacity-50"
                      style={{ background: 'var(--color-accent)' }}
                      title={r.active ? 'Close out again with the numbers shown — the earlier entry is kept as voided' : 'Confirm the projection and close out this engineer'}
                    >
                      {busy === r.user_id ? '…' : r.active ? 'Close out again' : 'Close out'}
                    </button>
                  </td>
                </tr>
              )}
              </Fragment>
            ))}
          </tbody>
        </table>

        {err && <p className="t-small t-danger mt-2">{err}</p>}

        <div className="flex items-center justify-between gap-2 mt-3 flex-wrap">
          <span className="t-small t-muted">
            {closedCount} of {rows.length} closed
            {totalPayout > 0 && <> · payout logged: <strong>{fmtH(totalPayout)}</strong></>}
          </span>
          <div className="flex gap-2 items-center">
            <button
              onClick={() => setCalcOpen(calcOpen.size === rows.length ? new Set() : new Set(rows.map((r) => r.user_id)))}
              className="t-small t-accent hover:underline"
              title={`Show or hide every engineer's ${fromYear + 1} projection`}
            >
              {calcOpen.size === rows.length ? 'Hide all projections' : 'Calculate all'}
            </button>
            <button
              onClick={onCancel}
              className="t-small px-3 py-1 rounded border"
              style={{ borderColor: 'var(--color-border)' }}
              title="Close without saving — nothing changes for rows you haven’t closed out"
            >
              Cancel
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
                        {fmtH(c.vacation_remaining)} left
                        {Number(c.vacation_payout_hours ?? 0) > 0
                          ? <> → <strong>paid out {fmtH(c.vacation_payout_hours)}</strong></>
                          : Number(c.vacation_remaining) > 0 ? ' → lost'
                          : Number(c.vacation_carryover_hours) < 0
                            ? ` → ${fmtH(-Number(c.vacation_carryover_hours))} deducted from ${c.to_year}`
                          : ''}
                      </td>
                      <td className="py-1 pr-2">
                        {fmtH(c.sick_remaining)} left → carried {fmtH(c.sick_carryover_hours)}
                        {Number(c.sick_payout_hours) > 0 && <>, <strong>paid out {fmtH(c.sick_payout_hours)}</strong></>}
                      </td>
                      <td className="py-1 pr-2">{Number(c.holiday_forfeit_hours) > 0 ? `${fmtDays(floaterDays(c.holiday_forfeit_hours, Number(c.daily_hours)))} lost` : '—'}</td>
                      <td className="py-1 pr-2 t-muted">
                        {c.next_vacation_alloted != null && (
                          <>{c.to_year} allotment saved: {fmtH(c.next_vacation_alloted)} vac, {fmtH(c.next_sick_alloted ?? 0)} sick, {fmtDays(floaterDays(c.next_holiday_alloted ?? 0, Number(c.daily_hours)))} floater · </>
                        )}
                        {c.voided_at ? `voided ${fmtDate(c.voided_at)}` : 'active'}
                        {!c.voided_at && payoutOf(c) > 0 && (c.payout_paid_at ? ' · paid' : ' · payout pending')}
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
