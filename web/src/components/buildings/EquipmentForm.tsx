// Inline form for adding or editing one piece of building equipment.
// After 0060: status is just the "headline" baseline (operational / standby
// auto / defaulted). Active problems (off-PM / down-CM / degraded / bypass)
// live as equipment_issues child rows and are managed via IssueForm from
// the EquipmentList card.
import { useState } from 'react';
import {
  useUpsertBuildingEquipment,
  uploadEquipmentPhoto,
  EQUIPMENT_CATEGORIES,
  EQUIPMENT_CATEGORY_LABELS,
  EQUIPMENT_STATUSES,
  EQUIPMENT_STATUS_LABELS,
  equipmentStatusTone,
  type BuildingEquipment,
  type EquipmentCategory,
  type EquipmentStatus,
} from '../../hooks/useBuildingKb';

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
  const [status, setStatus]                 = useState<EquipmentStatus>(
    existing?.status ?? 'operational',
  );

  const [error, setError] = useState<string | null>(null);
  const tone = equipmentStatusTone(status);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!fullName.trim()) {
      setError('Full name is required.');
      return;
    }
    try {
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
      });

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

      <div
        className="t-small uppercase tracking-wider"
        style={{ color: formAccent, marginTop: 4 }}
      >
        Headline status
      </div>

      <Field label="Status" hint="problems (off-PM, down-CM, degraded, bypass) are added separately from the equipment card">
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

      {existing?.last_status_change_at && (
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
