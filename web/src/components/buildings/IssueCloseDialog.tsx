// Modal asking for a resolution note when an engineer closes an
// equipment_issues row. Shared by EquipmentList (building detail page)
// and EquipmentDownPanel (§10.1 manager dashboard) so the workflow + UX
// stay identical no matter where you close from.
//
// The resolution text becomes searchable institutional knowledge —
// when the same MAU-boiler freeze-stat fault hits in 6 months, the next
// engineer should be able to pull up "swapped the FzS, calibrated, was
// the wrong PN — ordered xxx from CWS" rather than starting over.
//
// DB CHECK constraint also enforces a non-empty resolution; the form
// guards client-side so users see a friendly error instead of a Postgres
// error message.
import { useState } from 'react';
import {
  useCloseEquipmentIssue,
  EQUIPMENT_STATUS_LABELS,
  lotoTypeLabel,
  type IssueStatus,
  type LotoType,
} from '../../hooks/useBuildingKb';

export type IssueCloseContext = {
  id: string;
  equipment_id: string;
  status: IssueStatus;
  detail: string | null;
  equipment_label: string;        // for the dialog header ("HV1 · MAU-boiler")
  building_label?: string;        // optional bldg short_code/name
  /** If non-null AND loto_removed_at is null, LOTO/ISO is still active. */
  loto_type?: LotoType | null;
  loto_applied_at?: string | null;
  loto_applied_by_name?: string | null;
  loto_removed_at?: string | null;
};

export function IssueCloseDialog({
  ctx,
  onClose,
}: {
  ctx: IssueCloseContext;
  onClose: () => void;
}) {
  const close = useCloseEquipmentIssue();
  const [resolution, setResolution] = useState('');
  const [error, setError] = useState<string | null>(null);

  const lotoActive = !!ctx.loto_applied_at && !ctx.loto_removed_at;
  // "remove" — engineer is physically removing the lock right now
  // "already" — the lock was removed externally (rare; older state not yet updated)
  // null     — engineer hasn't decided yet; submit is blocked
  const [lotoChoice, setLotoChoice] =
    useState<'remove' | 'already' | null>(lotoActive ? null : 'already');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!resolution.trim()) {
      setError('A resolution note is required — describe what fixed it.');
      return;
    }
    if (lotoActive && lotoChoice === null) {
      setError('LOTO is still applied — pick one of the two options below before closing.');
      return;
    }
    try {
      await close.mutateAsync({
        id: ctx.id,
        equipment_id: ctx.equipment_id,
        resolution: resolution.trim(),
        // Only stamp the loto_removed fields if engineer picks "remove now".
        // "already" path leaves the LOTO state untouched — managers can
        // backfill it via the equipment detail view later if needed.
        removeLoto: lotoActive && lotoChoice === 'remove',
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Close failed.');
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(0, 0, 0, 0.55)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '20px',
        zIndex: 1000,
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <form
        onSubmit={submit}
        className="t-card"
        style={{
          maxWidth: 560, width: '100%',
          padding: 18, display: 'grid', gap: 12,
          borderLeft: '4px solid var(--color-ok, #10b981)',
        }}
      >
        <div>
          <div className="t-small t-muted uppercase tracking-wider">Close issue</div>
          <div className="t-section-title" style={{ fontSize: '1.05rem', marginTop: 4 }}>
            {ctx.building_label && (
              <span className="t-mono t-muted" style={{ marginRight: 6 }}>
                {ctx.building_label} ·
              </span>
            )}
            {ctx.equipment_label}
          </div>
          <div
            style={{
              display: 'flex', alignItems: 'baseline', gap: 8,
              marginTop: 6, flexWrap: 'wrap',
            }}
          >
            <span
              className="t-small uppercase tracking-wider"
              style={{
                padding: '2px 8px', borderRadius: 4,
                fontSize: '0.65rem', fontWeight: 700,
                background:
                  ctx.status === 'down_cm' || ctx.status === 'off_pm'
                    ? 'var(--color-danger)' : 'var(--color-warn, #d97706)',
                color: 'white',
              }}
            >
              {EQUIPMENT_STATUS_LABELS[ctx.status]}
            </span>
            {ctx.detail && (
              <span className="t-text t-muted" style={{ fontSize: '0.85rem' }}>
                {ctx.detail}
              </span>
            )}
          </div>
        </div>

        <Field
          label="Resolution (required)"
          hint="how did you fix it? include parts swapped, vendor/PM #, calibration values — future engineers will read this"
        >
          <textarea
            value={resolution}
            onChange={(e) => setResolution(e.target.value)}
            rows={5}
            autoFocus
            required
            placeholder={'e.g. "swapped FzS sensor (PN HX-202), recalibrated trip at 36°F. Was original PN listed too high for our run — re-ordered correct part from CWS."'}
            style={{ ...inputStyle, resize: 'vertical' }}
          />
        </Field>

        {lotoActive && (
          <div
            style={{
              padding: 12,
              borderRadius: 4,
              border: '1px solid var(--color-danger)',
              background: 'rgba(239, 68, 68, 0.08)',
              display: 'grid', gap: 8,
            }}
          >
            <div className="t-small uppercase tracking-wider" style={{ color: 'var(--color-danger)', fontWeight: 700 }}>
              🔒 {lotoTypeLabel(ctx.loto_type)} still applied
            </div>
            <div className="t-text" style={{ fontSize: '0.85rem' }}>
              Applied{' '}
              {ctx.loto_applied_at && (
                <strong>{ctx.loto_applied_at}</strong>
              )}
              {ctx.loto_applied_by_name && (
                <>
                  {' by '}
                  <strong>{ctx.loto_applied_by_name}</strong>
                </>
              )}
              . Closing this issue requires accounting for the {lotoTypeLabel(ctx.loto_type)}.
            </div>
            <label className="t-small" style={{ display: 'flex', alignItems: 'flex-start', gap: 8, cursor: 'pointer' }}>
              <input
                type="radio"
                name="loto-choice"
                checked={lotoChoice === 'remove'}
                onChange={() => setLotoChoice('remove')}
                style={{ marginTop: 3 }}
              />
              <span>
                <strong>Remove {lotoTypeLabel(ctx.loto_type)} now</strong>
                <span className="t-muted" style={{ marginLeft: 6, fontSize: '0.75rem' }}>
                  — I&apos;m physically pulling the {ctx.loto_type === 'isoto' ? 'isolation' : 'lock / tag'} right now (stamps you + today)
                </span>
              </span>
            </label>
            <label className="t-small" style={{ display: 'flex', alignItems: 'flex-start', gap: 8, cursor: 'pointer' }}>
              <input
                type="radio"
                name="loto-choice"
                checked={lotoChoice === 'already'}
                onChange={() => setLotoChoice('already')}
                style={{ marginTop: 3 }}
              />
              <span>
                <strong>Already removed externally</strong>
                <span className="t-muted" style={{ marginLeft: 6, fontSize: '0.75rem' }}>
                  — someone took it off but didn&apos;t update the record. Close issue but leave state alone; a manager can backfill.
                </span>
              </span>
            </label>
          </div>
        )}

        {error && (
          <div className="t-small" style={{ color: 'var(--color-danger)' }}>{error}</div>
        )}

        <div className="flex gap-2">
          <button
            type="submit"
            disabled={close.isPending}
            className="t-small t-accent"
            style={{
              padding: '8px 14px',
              border: '1px solid var(--color-ok, #10b981)',
              borderRadius: 4,
              background: 'var(--color-card)',
              color: 'var(--color-ok, #10b981)',
              fontWeight: 600,
            }}
          >
            {close.isPending ? 'Closing…' : 'Close issue'}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="t-small t-muted"
            style={{
              padding: '8px 14px',
              border: '1px solid var(--color-border)',
              borderRadius: 4,
              background: 'transparent',
            }}
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
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
        {hint && (
          <span className="t-muted ml-2" style={{ fontSize: '0.7rem' }}>
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
  padding: 8,
  borderRadius: 4,
  border: '1px solid var(--color-border)',
  background: 'var(--color-card)',
  color: 'var(--color-text)',
  font: 'inherit',
};
