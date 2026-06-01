// Inline form for adding or editing one piece of building equipment.
// Used by EquipmentList — slides open on "Add equipment" or row "Edit".
import { useState } from 'react';
import {
  useUpsertBuildingEquipment,
  uploadEquipmentPhoto,
  type BuildingEquipment,
} from '../../hooks/useBuildingKb';

type EquipmentCategory = NonNullable<BuildingEquipment['category']>;
const CATEGORIES: EquipmentCategory[] = [
  'mechanical',
  'control',
  'electrical',
  'plumbing',
  'other',
];

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

  const [name, setName] = useState(existing?.name ?? '');
  const [category, setCategory] = useState<EquipmentCategory>(
    existing?.category ?? 'mechanical',
  );
  const [locationNote, setLocationNote] = useState(existing?.location_note ?? '');
  const [partsNotes, setPartsNotes] = useState(existing?.parts_notes ?? '');
  const [commonIssues, setCommonIssues] = useState(existing?.common_issues ?? '');
  const [troubleshooting, setTroubleshooting] = useState(
    existing?.troubleshooting ?? '',
  );
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [removePhoto, setRemovePhoto] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim()) {
      setError('Name is required.');
      return;
    }
    try {
      // Step 1: upsert the row first to get an id (for the photo storage path).
      const saved = await upsert.mutateAsync({
        id: existing?.id,
        building_id: buildingId,
        name: name.trim(),
        category,
        location_note: locationNote.trim() || null,
        parts_notes: partsNotes.trim() || null,
        common_issues: commonIssues.trim() || null,
        troubleshooting: troubleshooting.trim() || null,
        photo_url: removePhoto ? null : existing?.photo_url ?? null,
        sort_order: existing?.sort_order ?? 0,
      });

      // Step 2: if a new photo was picked, upload and second-pass update.
      if (photoFile) {
        setUploading(true);
        try {
          const url = await uploadEquipmentPhoto(saved.id, photoFile);
          await upsert.mutateAsync({
            id: saved.id,
            building_id: buildingId,
            name: saved.name,
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

  return (
    <form
      onSubmit={submit}
      className="t-card"
      style={{ padding: 16, marginBottom: 12, display: 'grid', gap: 10 }}
    >
      <div className="t-small t-muted uppercase tracking-wider">
        {existing ? 'Edit equipment' : 'Add equipment'}
      </div>

      <Field label="Name (required)" hint='e.g. "HWP-3", "Chiller-1", "AHU-2"'>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
          required
          style={inputStyle}
        />
      </Field>

      <Field label="Category">
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value as EquipmentCategory)}
          style={inputStyle}
        >
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>{c}</option>
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
                alt={existing.name}
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
