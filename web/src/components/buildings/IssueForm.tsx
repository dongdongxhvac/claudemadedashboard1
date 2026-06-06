// Inline form for adding or editing one equipment_issues row. Opened from
// the EquipmentCard "+ Add issue" button or from an existing issue's "Edit"
// link.
//
// Two collapsible disclosures keep the simple case compact:
//   * "WO / RSP details" — the WO #, who created it, responsible party
//   * "LOTO" — when a lockout/tagout was applied + by which engineer.
//     LOTO removal happens via the close dialog or an explicit "Remove
//     LOTO" button on the issue row.
import { useState } from 'react';
import {
  useUpsertEquipmentIssue,
  ISSUE_STATUSES,
  EQUIPMENT_STATUS_LABELS,
  LOTO_TYPES,
  LOTO_TYPE_LABELS,
  type EquipmentIssue,
  type IssueStatus,
  type LotoType,
} from '../../hooks/useBuildingKb';
import { useEngineers } from '../../hooks/useEngineers';

function todayLocalISO(): string {
  return new Date().toLocaleDateString('en-CA');
}

export function IssueForm({
  equipmentId,
  equipmentLabel,
  buildingShortCode,
  buildingName,
  existing,
  onClose,
}: {
  equipmentId: string;
  /** "AHU1.1a" or "HV1 · MAU-boiler" — shown in header so engineer
   *  confirms they're attaching the issue to the right equipment. */
  equipmentLabel?: string;
  buildingShortCode?: string;
  buildingName?: string;
  existing?: EquipmentIssue;
  onClose: () => void;
}) {
  const upsert = useUpsertEquipmentIssue();
  const engineersQ = useEngineers();

  const [status, setStatus]             = useState<IssueStatus>(existing?.status ?? 'down_cm');
  const [detail, setDetail]             = useState(existing?.detail ?? '');
  const [statusDate, setStatusDate]     = useState<string>(
    existing?.status_date ?? todayLocalISO(),
  );
  const [woNumber, setWoNumber]         = useState(existing?.wo_number ?? '');
  const [rsp, setRsp]                   = useState(existing?.rsp ?? '');
  // LOTO / ISO state — type is the gate. Picking rLOTO / gLOTO / ISOTO
  // implies the isolation is active and requires Date + By. Picking N/A
  // means no isolation needed (the safety record still positively says
  // "I thought about it"). Default is N/A.
  const [lotoType, setLotoType]         = useState<LotoType>(
    existing?.loto_type ?? 'na',
  );
  const [lotoApplyAt, setLotoApplyAt]   = useState<string>(
    existing?.loto_applied_at ?? todayLocalISO(),
  );
  const [lotoApplyBy, setLotoApplyBy]   = useState(existing?.loto_applied_by ?? '');
  const lotoApplied = lotoType !== 'na';
  const [error, setError]               = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!detail.trim()) {
      setError('Detail is required — what is wrong / what is being done.');
      return;
    }
    if (lotoApplied && !lotoApplyBy) {
      setError(`${LOTO_TYPE_LABELS[lotoType]} requires the engineer who applied it — pick from the list.`);
      return;
    }
    try {
      await upsert.mutateAsync({
        id: existing?.id,
        equipment_id: equipmentId,
        status,
        detail: detail.trim(),
        status_date: statusDate || null,
        wo_number: woNumber.trim() || null,
        rsp: rsp.trim() || null,
        sort_order: existing?.sort_order ?? 0,
        loto_type: lotoType,
        loto_applied_at: lotoApplied ? lotoApplyAt : null,
        loto_applied_by: lotoApplied ? lotoApplyBy : null,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed.');
    }
  }

  const engineers = engineersQ.data ?? [];

  return (
    <form
      onSubmit={submit}
      style={{
        display: 'grid', gap: 6,
        padding: 10,
        borderRadius: 4,
        border: '1px solid var(--color-danger)',
        background: 'rgba(239, 68, 68, 0.06)',
        marginBottom: 6,
        maxWidth: 720,
      }}
    >
      <div
        style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}
      >
        <span
          className="t-small uppercase tracking-wider"
          style={{ color: 'var(--color-danger)', fontSize: '0.65rem', letterSpacing: '0.1em' }}
        >
          {existing ? 'Edit issue' : 'New issue'}
        </span>
        {equipmentLabel && (
          <>
            <span className="t-muted" style={{ fontSize: '0.7rem' }}>on</span>
            <span style={{ fontSize: '0.78rem', fontWeight: 600 }}>
              {equipmentLabel}
            </span>
          </>
        )}
        {buildingShortCode && (
          <>
            <span className="t-muted" style={{ fontSize: '0.7rem' }}>at</span>
            <span
              className="t-mono"
              style={{
                padding: '1px 7px',
                borderRadius: 3,
                background: 'var(--color-accent)',
                color: 'white',
                fontWeight: 700,
                fontSize: '0.72rem',
              }}
            >
              {buildingShortCode}
            </span>
            {buildingName && (
              <span className="t-muted" style={{ fontSize: '0.7rem' }}>
                {buildingName}
              </span>
            )}
          </>
        )}
      </div>

      {/* Status + Date on one row */}
      <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 6 }}>
        <Field label="Status">
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as IssueStatus)}
            style={inputStyle}
          >
            {ISSUE_STATUSES.map((s) => (
              <option key={s} value={s}>{EQUIPMENT_STATUS_LABELS[s]}</option>
            ))}
          </select>
        </Field>
        <Field label={
          status === 'off_pm'   ? 'Date of off-PM' :
          status === 'down_cm'  ? 'Date of down-CM' :
          status === 'degraded' ? 'Date noticed' :
          status === 'bypass'   ? 'Date bypassed' :
          'Date'
        }>
          <input
            type="date"
            value={statusDate}
            onChange={(e) => setStatusDate(e.target.value)}
            style={inputStyle}
          />
        </Field>
      </div>

      <Field label="Detail *" hint="what's wrong / what's being done">
        <textarea
          value={detail}
          onChange={(e) => setDetail(e.target.value)}
          rows={2}
          autoFocus
          required
          style={{ ...inputStyle, resize: 'vertical', minHeight: 0 }}
        />
      </Field>

      {/* WO # + RSP — always visible (no disclosure). */}
      <div className="grid gap-2" style={{ gridTemplateColumns: 'minmax(140px,1fr) minmax(140px,1fr)' }}>
        <Field label="WO #" hint="pointer to the COVE work order">
          <input
            type="text"
            value={woNumber}
            onChange={(e) => setWoNumber(e.target.value)}
            placeholder='e.g. "PM-1234", "CM-5678"'
            style={inputStyle}
          />
        </Field>
        <Field label="RSP (responsible party)" hint="engineer / vendor / contractor">
          <input
            type="text"
            value={rsp}
            onChange={(e) => setRsp(e.target.value)}
            style={inputStyle}
          />
        </Field>
      </div>

      {/* Isolation — always visible. Type is the gate; Date/By disable when N/A. */}
      <div
        className="grid gap-2"
        style={{ gridTemplateColumns: 'minmax(110px,160px) minmax(120px,1fr) minmax(140px,1fr)' }}
      >
        <Field
          label="Isolation"
          hint="rLOTO = red lock · gLOTO = green lock · ISOTO = tag · N/A = no lock"
        >
          <select
            value={lotoType}
            onChange={(e) => setLotoType(e.target.value as LotoType)}
            style={inputStyle}
          >
            {LOTO_TYPES.map((t) => (
              <option key={t} value={t}>{LOTO_TYPE_LABELS[t]}</option>
            ))}
          </select>
        </Field>
        <Field label="Date" hint={lotoApplied ? '' : '— N/A —'}>
          <input
            type="date"
            value={lotoApplyAt}
            onChange={(e) => setLotoApplyAt(e.target.value)}
            style={inputStyle}
            disabled={!lotoApplied}
          />
        </Field>
        <Field label="By" hint={lotoApplied ? 'engineer who placed it' : '— N/A —'}>
          <select
            value={lotoApplyBy}
            onChange={(e) => setLotoApplyBy(e.target.value)}
            style={inputStyle}
            required={lotoApplied}
            disabled={!lotoApplied}
          >
            <option value="">— pick engineer —</option>
            {engineers.map((e) => (
              <option key={e.user_id} value={e.user_id}>{e.full_name}</option>
            ))}
          </select>
        </Field>
      </div>
      {existing?.loto_removed_at && (
        <div className="t-small t-muted">
          Removed {existing.loto_removed_at}
        </div>
      )}

      {error && (
        <div className="t-small" style={{ color: 'var(--color-danger)' }}>{error}</div>
      )}

      <div className="flex gap-2" style={{ marginTop: 2 }}>
        <button
          type="submit"
          disabled={upsert.isPending}
          className="t-small t-accent"
          style={{
            padding: '5px 12px',
            border: '1px solid var(--color-accent)',
            borderRadius: 4,
            background: 'var(--color-card)',
            fontSize: '0.8rem',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 5,
          }}
        >
          {upsert.isPending ? 'Saving…' : existing ? 'Save changes' : 'Add issue'}
          {!upsert.isPending && buildingShortCode && (
            <span
              className="t-mono"
              style={{
                padding: '0 5px',
                borderRadius: 2,
                background: 'var(--color-accent)',
                color: 'white',
                fontSize: '0.65rem',
                fontWeight: 700,
              }}
            >
              {existing ? 'in' : 'to'} {buildingShortCode}
            </span>
          )}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="t-small t-muted"
          style={{
            padding: '5px 12px',
            border: '1px solid var(--color-border)',
            borderRadius: 4,
            background: 'transparent',
            fontSize: '0.8rem',
          }}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label style={{ display: 'block' }}>
      <div
        className="t-small"
        style={{
          color: 'var(--color-text)',
          marginBottom: 2,
          fontSize: '0.72rem',
          lineHeight: 1.2,
        }}
      >
        {label}
        {hint && (
          <span
            className="t-muted ml-2"
            style={{ fontSize: '0.65rem' }}
          >
            {hint}
          </span>
        )}
      </div>
      {children}
    </label>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '6px 8px',
  borderRadius: 4,
  border: '1px solid var(--color-border)',
  background: 'var(--color-card)',
  color: 'var(--color-text)',
  font: 'inherit',
  fontSize: '0.85rem',
};

