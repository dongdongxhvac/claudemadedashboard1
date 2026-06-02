// Inline form for adding or editing one piece of building equipment.
// Used by EquipmentList — slides open on "Add equipment" or row "Edit".
//
// Fields split into two visual sections:
//   1. Identity / catalog  (full_name, short_name, category, location,
//      parts, common issues, troubleshooting, photo)
//   2. Status workflow     (status dropdown + conditional popup with
//      status_detail / status_date / wo_number / rsp when the status is
//      off_pm or down_cm)
//
// The DB trigger auto-bumps last_status_change_at whenever status changes,
// so the React side doesn't have to compute it.
import { useState } from 'react';
import {
  useUpsertBuildingEquipment,
  uploadEquipmentPhoto,
  EQUIPMENT_CATEGORIES,
  EQUIPMENT_CATEGORY_LABELS,
  EQUIPMENT_STATUSES,
  EQUIPMENT_STATUS_LABELS,
  equipmentStatusTone,
  equipmentStatusNeedsDetail,
  type BuildingEquipment,
  type EquipmentCategory,
  type EquipmentStatus,
} from '../../hooks/useBuildingKb';

function todayLocalISO(): string {
  return new Date().toLocaleDateString('en-CA');
}

export function EquipmentForm({
  buildingId,
  existing,
  onClose,
}: {
  buildingId: string;
  existing?: BuildingEquipment;
  onClose: () => void;
}) {
  const upsert = useUpsertBuildingEquipment();

  const [fullName, setFullName]             = useState(existing?.full_name ?? '');
  const [shortName, setShortName]           = useState(existing?.short_name ?? '');
  const [category, setCategory]             = useState<EquipmentCategory | ''>(
    existing?.category ?? '',
  );
  const [locationNote, setLocationNote]     = useState(existing?.location_note ?? '');
  const [partsNotes, setPartsNotes]         = useState(existing?.parts_notes ?? '');
  const [commonIssues, setCommonIssues]     = useState(existing?.common_issues ?? '');
  const [troubleshooting, setTroubleshooting] = useState(existing?.troubleshooting ?? '');
  const [photoFile, setPhotoFile]           = useState<File | null>(null);
  const [removePhoto, setRemovePhoto]       = useState(false);
  const [uploading, setUploading]           = useState(false);

  // Status workflow state — the conditional popup auto-shows when needed.
  const [status, setStatus]                 = useState<EquipmentStatus>(
    existing?.status ?? 'operational',
  );
  const [statusDetail, setStatusDetail]     = useState(existing?.status_detail ?? '');
  const [statusDate, setStatusDate]         = useState<string>(
    existing?.status_date ?? todayLocalISO(),
  );
  const [woNumber, setWoNumber]             = useState(existing?.wo_number ?? '');
  const [rsp, setRsp]                       = useState(existing?.rsp ?? '');

  const [error, setError] = useState<string | null>(null);

  // Detail block opens for any "needs attention" status (off_pm, down_cm,
  // degraded, bypass) — defaulted is left soft per the helper's spec.
  const showStatusDetail = equipmentStatusNeedsDetail(status);
  const tone = equipmentStatusTone(status);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!fullName.trim()) {
      setError('Full name is required.');
      return;
    }
    if (showStatusDetail && !statusDetail.trim()) {
      setError(`Status detail is required when status is ${EQUIPMENT_STATUS_LABELS[status]}.`);
      return;
    }
    try {
      // Step 1: upsert the row (the DB trigger auto-stamps
      // last_status_change_at when status actually changes).
      const saved = await upsert.mutateAsync({
        id: existing?.id,
        building_id: buildingId,
        full_name: fullName.trim(),
        short_name: shortName.trim() || null,
        category: category || null,
        location_note: locationNote.trim() || null,
        parts_notes: partsNotes.trim() || null,
        common_issues: commonIssues.trim() || null,
        troubleshooting: troubleshooting.trim() || null,
        photo_url: removePhoto ? null : existing?.photo_url ?? null,
        sort_order: existing?.sort_order ?? 0,
        status,
        // Clear the status-detail bundle when status goes back to a
        // healthy state, so old WO# / RSP don't linger on a green row.
        status_detail: showStatusDetail ? (statusDetail.trim() || null) : null,
        status_date:   showStatusDetail ? statusDate : null,
        wo_number:     showStatusDetail ? (woNumber.trim() || null) : null,
        rsp:           showStatusDetail ? (rsp.trim() || null) : null,
      });

      // Step 2: if a new photo was picked, upload + second-pass update.
      if (photoFile) {
        setUploading(true);
        try {
          const url = await uploadEquipmentPhoto(saved.id, photoFile);
          await upsert.mutateAsync({
            id: saved.id,
            building_id: buildingId,
            full_name: saved.full_name,
            photo_url: url,
          });
        } finally {
          setUploading(false);
        }
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed.');
    }
  }

  // Border accent for the form ties the visual to current status tone so
  // the manager sees the consequence of their dropdown choice live.
  const formAccent =
    tone === 'bad' ? 'var(--color-danger)' :
    tone === 'warn' ? 'var(--color-warn, #d97706)' :
    'var(--color-ok, #10b981)';

  return (
    <form
      onSubmit={submit}
      className="t-card"
      style={{
        padding: 16, marginBottom: 12, display: 'grid', gap: 10,
        borderLeft: `3px solid ${formAccent}`,
      }}
    >
      <div className="t-small t-muted uppercase tracking-wider">
        {existing ? 'Edit equipment' : 'Add equipment'}
      </div>

      <div className="grid gap-2" style={{ gridTemplateColumns: '2fr 1fr' }}>
        <Field label="Full name (required)" hint='e.g. "Hot Water Pump 3", "Chiller 1"'>
          <input
            type="text"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            autoFocus
            required
            style={inputStyle}
          />
        </Field>

        <Field label="Short name" hint='e.g. "HWP-3", "CH-1"'>
          <input
            type="text"
            value={shortName}
            onChange={(e) => setShortName(e.target.value)}
            placeholder=""
            style={inputStyle}
          />
        </Field>
      </div>

      <Field label="Category">
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value as EquipmentCategory | '')}
          style={inputStyle}
        >
          <option value="">— pick —</option>
          {EQUIPMENT_CATEGORIES.map((c) => (
            <option key={c} value={c}>{EQUIPMENT_CATEGORY_LABELS[c]}</option>
          ))}
        </select>
      </Field>

      <Field label="Location" hint='e.g. "Penthouse, west wall" or "B1 Mech Room"'>
        <input
          type="text"
          value={locationNote}
          onChange={(e) => setLocationNote(e.target.value)}
          style={inputStyle}
        />
      </Field>

      <Field label="Parts / consumables" hint="filter sizes, belt numbers, oil types">
        <textarea
          value={partsNotes}
          onChange={(e) => setPartsNotes(e.target.value)}
          rows={3}
          style={{ ...inputStyle, resize: 'vertical' }}
        />
      </Field>

      <Field label="Common issues">
        <textarea
          value={commonIssues}
          onChange={(e) => setCommonIssues(e.target.value)}
          rows={3}
          style={{ ...inputStyle, resize: 'vertical' }}
        />
      </Field>

      <Field label="Troubleshooting" hint="what to check first if this is down">
        <textarea
          value={troubleshooting}
          onChange={(e) => setTroubleshooting(e.target.value)}
          rows={3}
          style={{ ...inputStyle, resize: 'vertical' }}
        />
      </Field>

      <Field label="Photo (optional)" hint="JPEG / PNG / WebP / HEIC, up to 10 MB">
        <div style={{ display: 'grid', gap: 8 }}>
          {existing?.photo_url && !removePhoto && !photoFile && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <img
                src={existing.photo_url}
                alt={existing.full_name}
                style={{ maxHeight: 120, maxWidth: 200, borderRadius: 4, border: '1px solid var(--color-border)' }}
              />
              <button
                type="button"
                onClick={() => setRemovePhoto(true)}
                className="t-small"
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  color: 'var(--color-danger)',
                }}
              >
                Remove photo
              </button>
            </div>
          )}
          {photoFile && (
            <div className="t-small t-muted">New photo selected: {photoFile.name}</div>
          )}
          {removePhoto && !photoFile && (
            <div className="t-small" style={{ color: 'var(--color-warn, #d97706)' }}>
              Photo will be removed on save.
            </div>
          )}
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
            onChange={(e) => {
              const f = e.target.files?.[0] ?? null;
              setPhotoFile(f);
              if (f) setRemovePhoto(false);
            }}
          />
        </div>
      </Field>

      {/* ──────────────── Status workflow ──────────────── */}

      <div
        className="t-small uppercase tracking-wider"
        style={{ color: formAccent, marginTop: 4 }}
      >
        Status
      </div>

      <Field label="Current status">
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as EquipmentStatus)}
          style={{ ...inputStyle, borderColor: formAccent }}
        >
          {EQUIPMENT_STATUSES.map((s) => (
            <option key={s} value={s}>{EQUIPMENT_STATUS_LABELS[s]}</option>
          ))}
        </select>
      </Field>

      {showStatusDetail && (
        <div
          style={{
            display: 'grid', gap: 10,
            padding: 12,
            borderRadius: 4,
            border: `1px solid var(--color-danger)`,
            background: 'rgba(239, 68, 68, 0.06)',
          }}
        >
          <div className="t-small uppercase tracking-wider" style={{ color: 'var(--color-danger)' }}>
            {EQUIPMENT_STATUS_LABELS[status]} — required details
          </div>

          <Field label="Status detail (required)" hint="what's wrong / what's being done">
            <textarea
              value={statusDetail}
              onChange={(e) => setStatusDetail(e.target.value)}
              rows={2}
              style={{ ...inputStyle, resize: 'vertical' }}
              required
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
        </div>
      )}

      {!showStatusDetail && existing?.last_status_change_at && (
        <div className="t-small t-muted" style={{ marginTop: -4 }}>
          Last status change: <strong>{new Date(existing.last_status_change_at).toLocaleString()}</strong>
        </div>
      )}

      {error && (
        <div className="t-small" style={{ color: 'var(--color-danger)' }}>{error}</div>
      )}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={upsert.isPending || uploading}
          className="t-small t-accent"
          style={{
            padding: '8px 14px', border: '1px solid var(--color-accent)',
            borderRadius: 4, background: 'var(--color-card)',
          }}
        >
          {uploading ? 'Uploading…' : upsert.isPending ? 'Saving…' : existing ? 'Save changes' : 'Add equipment'}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="t-small t-muted"
          style={{
            padding: '8px 14px', border: '1px solid var(--color-border)',
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
