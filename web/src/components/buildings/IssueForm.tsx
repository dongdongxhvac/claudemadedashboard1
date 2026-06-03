// Inline form for adding or editing one equipment_issues row. Opened from
// the EquipmentCard "+ Add issue" button or from an existing issue's "Edit"
// link. Mirrors the visual shape of the old EquipmentForm's status detail
// popup (red-tinted block) so the UX feels continuous.
import { useState } from 'react';
import {
  useUpsertEquipmentIssue,
  ISSUE_STATUSES,
  EQUIPMENT_STATUS_LABELS,
  type EquipmentIssue,
  type IssueStatus,
} from '../../hooks/useBuildingKb';

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
  const [status, setStatus]       = useState<IssueStatus>(existing?.status ?? 'down_cm');
  const [detail, setDetail]       = useState(existing?.detail ?? '');
  const [statusDate, setStatusDate] = useState<string>(
    existing?.status_date ?? todayLocalISO(),
  );
  const [woNumber, setWoNumber]   = useState(existing?.wo_number ?? '');
  const [rsp, setRsp]             = useState(existing?.rsp ?? '');
  const [error, setError]         = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!detail.trim()) {
      setError('Detail is required — what is wrong / what is being done.');
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
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed.');
    }
  }

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

      <div className="grid gap-2" style={{ gridTemplateColumns: 'minmax(140px,1fr) minmax(140px,1fr)' }}>
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
        <Field label="WO #">
          <input
            type="text"
            value={woNumber}
            onChange={(e) => setWoNumber(e.target.value)}
            placeholder='e.g. "PM-1234", "CM-5678"'
            style={inputStyle}
          />
        </Field>
      </div>

      <Field label="RSP (responsible party)" hint="who's owning this — engineer / vendor / contractor">
        <input
          type="text"
          value={rsp}
          onChange={(e) => setRsp(e.target.value)}
          style={inputStyle}
        />
      </Field>

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
