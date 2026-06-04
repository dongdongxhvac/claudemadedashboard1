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
  type EquipmentIssue,
  type IssueStatus,
} from '../../hooks/useBuildingKb';
import { useEngineers } from '../../hooks/useEngineers';

function todayLocalISO(): string {
  return new Date().toLocaleDateString('en-CA');
}

export function IssueForm({
  equipmentId,
  existing,
  onClose,
}: {
  equipmentId: string;
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
  // LOTO / ISO state — date-only ("by who + when day"). Engineer opens
  // the disclosure and ticks "Applied" to stamp.
  const [lotoApplied, setLotoApplied]   = useState(!!existing?.loto_applied_at);
  const [lotoApplyAt, setLotoApplyAt]   = useState<string>(
    existing?.loto_applied_at ?? todayLocalISO(),
  );
  const [lotoApplyBy, setLotoApplyBy]   = useState(existing?.loto_applied_by ?? '');
  const [showWoDetails, setShowWoDetails] = useState(
    !!(existing?.wo_number || existing?.rsp),
  );
  const [showLoto, setShowLoto]         = useState(!!existing?.loto_applied_at);
  const [error, setError]               = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!detail.trim()) {
      setError('Detail is required — what is wrong / what is being done.');
      return;
    }
    if (lotoApplied && !lotoApplyBy) {
      setError('LOTO / ISO requires the engineer who applied it — pick from the list.');
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
        display: 'grid', gap: 10,
        padding: 12,
        borderRadius: 4,
        border: `1px solid var(--color-danger)`,
        background: 'rgba(239, 68, 68, 0.06)',
        marginBottom: 8,
      }}
    >
      <div className="t-small uppercase tracking-wider" style={{ color: 'var(--color-danger)' }}>
        {existing ? 'Edit issue' : 'New issue'}
      </div>

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

      <Field label="Detail (required)" hint="what's wrong / what's being done">
        <textarea
          value={detail}
          onChange={(e) => setDetail(e.target.value)}
          rows={2}
          autoFocus
          required
          style={{ ...inputStyle, resize: 'vertical' }}
        />
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
          style={{ ...inputStyle, maxWidth: 180 }}
        />
      </Field>

      {/* ──────────────── WO # / RSP disclosure ──────────────── */}
      <button
        type="button"
        onClick={() => setShowWoDetails((v) => !v)}
        style={discloseBtn}
      >
        <span>{showWoDetails ? '▼' : '▶'}</span> WO # / RSP
        {!showWoDetails && (woNumber || rsp) && (
          <span className="t-muted" style={{ marginLeft: 6, fontSize: '0.7rem' }}>
            ({[woNumber && `WO ${woNumber}`, rsp].filter(Boolean).join(' · ')})
          </span>
        )}
      </button>
      {showWoDetails && (
        <div style={discloseBody}>
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
        </div>
      )}

      {/* ──────────────── LOTO / ISO disclosure ──────────────── */}
      <button
        type="button"
        onClick={() => setShowLoto((v) => !v)}
        style={discloseBtn}
      >
        <span>{showLoto ? '▼' : '▶'}</span> LOTO / ISO
        {!showLoto && lotoApplied && (
          <span style={{ marginLeft: 6, fontSize: '0.7rem', color: 'var(--color-danger)' }}>
            🔒 ON
          </span>
        )}
      </button>
      {showLoto && (
        <div style={discloseBody}>
          <label className="t-small" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input
              type="checkbox"
              checked={lotoApplied}
              onChange={(e) => setLotoApplied(e.target.checked)}
            />
            LOTO / ISO applied — equipment is locked or isolated
          </label>
          {lotoApplied && (
            <div className="grid gap-2" style={{ gridTemplateColumns: 'minmax(140px,1fr) minmax(160px,1fr)' }}>
              <Field label="Date">
                <input
                  type="date"
                  value={lotoApplyAt}
                  onChange={(e) => setLotoApplyAt(e.target.value)}
                  style={inputStyle}
                />
              </Field>
              <Field label="By (required)" hint="engineer who placed the lock / isolation">
                <select
                  value={lotoApplyBy}
                  onChange={(e) => setLotoApplyBy(e.target.value)}
                  style={inputStyle}
                  required
                >
                  <option value="">— pick engineer —</option>
                  {engineers.map((e) => (
                    <option key={e.user_id} value={e.user_id}>{e.full_name}</option>
                  ))}
                </select>
              </Field>
            </div>
          )}
          {existing?.loto_removed_at && (
            <div className="t-small t-muted">
              Removed {existing.loto_removed_at}
            </div>
          )}
        </div>
      )}

      {error && (
        <div className="t-small" style={{ color: 'var(--color-danger)' }}>{error}</div>
      )}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={upsert.isPending}
          className="t-small t-accent"
          style={{
            padding: '6px 12px', border: '1px solid var(--color-accent)',
            borderRadius: 4, background: 'var(--color-card)',
          }}
        >
          {upsert.isPending ? 'Saving…' : existing ? 'Save changes' : 'Add issue'}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="t-small t-muted"
          style={{
            padding: '6px 12px', border: '1px solid var(--color-border)',
            borderRadius: 4, background: 'transparent',
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
      <div className="t-small" style={{ color: 'var(--color-text)', marginBottom: 4 }}>
        {label}
        {hint && <span className="t-muted ml-2" style={{ fontSize: '0.7rem' }}>{hint}</span>}
      </div>
      {children}
    </label>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: 8,
  borderRadius: 4,
  border: '1px solid var(--color-border)',
  background: 'var(--color-card)',
  color: 'var(--color-text)',
  font: 'inherit',
};

const discloseBtn: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 6,
  padding: '4px 0',
  background: 'none', border: 'none', cursor: 'pointer',
  font: 'inherit', color: 'var(--color-text)',
  fontSize: '0.85rem',
  textAlign: 'left',
};

const discloseBody: React.CSSProperties = {
  display: 'grid', gap: 8,
  padding: '8px 0 0 16px',
  borderLeft: '2px solid var(--color-border-soft, rgba(0,0,0,0.1))',
  marginLeft: 4,
};
