// Inline form for adding or editing one piece of building equipment.
// After 0060: status is just the "headline" baseline (operational / standby
// auto / defaulted). Active problems (off-PM / down-CM / degraded / bypass)
// live as equipment_issues child rows and are managed via IssueForm from
// the EquipmentList card.
import { useMemo, useState } from 'react';
import {
  useBuildingEquipment,
  useUpsertBuildingEquipment,
  uploadEquipmentPhoto,
  collectDescendantIds,
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
  buildingShortCode,
  buildingName,
  existing,
  onClose,
}: {
  buildingId: string;
  /** For the "in [75] Building Name" safety label in the header / save button. */
  buildingShortCode?: string;
  buildingName?: string;
  existing?: BuildingEquipment;
  onClose: () => void;
}) {
  const upsert = useUpsertBuildingEquipment();
  const eqQ = useBuildingEquipment(buildingId);

  const [fullName, setFullName]             = useState(existing?.full_name ?? '');
  const [shortName, setShortName]           = useState(existing?.short_name ?? '');
  const [parentId, setParentId]             = useState<string | ''>(
    existing?.parent_equipment_id ?? '',
  );
  const [category, setCategory]             = useState<EquipmentCategory | ''>(
    existing?.category ?? '',
  );

  // Parent dropdown options: every active piece of equipment in this
  // building EXCEPT self and self's descendants (cycle prevention).
  const parentOptions = useMemo(() => {
    const all = eqQ.data ?? [];
    const excluded = new Set<string>();
    if (existing?.id) {
      excluded.add(existing.id);
      for (const d of collectDescendantIds(all, existing.id)) excluded.add(d);
    }
    return all
      .filter((e) => !excluded.has(e.id))
      .sort((a, b) => {
        // Top-level first, then alpha by name
        const aTop = a.parent_equipment_id ? 1 : 0;
        const bTop = b.parent_equipment_id ? 1 : 0;
        if (aTop !== bTop) return aTop - bTop;
        return a.full_name.localeCompare(b.full_name);
      });
  }, [eqQ.data, existing?.id]);
  const [locationNote, setLocationNote]     = useState(existing?.location_note ?? '');
  const [partsNotes, setPartsNotes]         = useState(existing?.parts_notes ?? '');
  const [photoFile, setPhotoFile]           = useState<File | null>(null);
  const [removePhoto, setRemovePhoto]       = useState(false);
  const [uploading, setUploading]           = useState(false);
  const [status, setStatus]                 = useState<EquipmentStatus>(
    existing?.status ?? 'operational',
  );

  const [error, setError] = useState<string | null>(null);
  // "Save as new" (user 2026-09-29): duplicate the form's current values as a
  // fresh row so similar equipment can be added by editing one and copying.
  // The form stays open on the ORIGINAL so the next copy is one rename away.
  const [savedAsNew, setSavedAsNew] = useState<string | null>(null);
  const tone = equipmentStatusTone(status);

  async function submit(e: React.FormEvent | null, asNew = false) {
    e?.preventDefault();
    setError(null);
    setSavedAsNew(null);
    if (!fullName.trim()) {
      setError('Full name is required.');
      return;
    }
    if (asNew && existing && fullName.trim().toLowerCase() === existing.full_name.trim().toLowerCase()) {
      setError('Change the full name first — the copy would have the same name as the original.');
      return;
    }
    try {
      const saved = await upsert.mutateAsync({
        id: asNew ? undefined : existing?.id,
        building_id: buildingId,
        parent_equipment_id: parentId || null,
        full_name: fullName.trim(),
        short_name: shortName.trim() || null,
        category: category || null,
        location_note: locationNote.trim() || null,
        parts_notes: partsNotes.trim() || null,
        // Not on the form any more (user 2026-09-29) — keep whatever the row
        // already has so an edit doesn't wipe older notes.
        common_issues: existing?.common_issues ?? null,
        troubleshooting: existing?.troubleshooting ?? null,
        // a copy never inherits the original's photo (it's that unit's picture)
        photo_url: asNew ? null : removePhoto ? null : existing?.photo_url ?? null,
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
      if (asNew) {
        setSavedAsNew(saved.short_name ? `${saved.short_name} · ${saved.full_name}` : saved.full_name);
        setPhotoFile(null);
        return;                      // stay open for the next copy
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
        padding: 12,
        marginBottom: 10,
        display: 'grid',
        gap: 6,
        borderLeft: `3px solid ${formAccent}`,
        maxWidth: 720,
      }}
    >
      <div
        style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}
      >
        <span
          className="t-small t-muted uppercase tracking-wider"
          style={{ fontSize: '0.65rem', letterSpacing: '0.1em' }}
        >
          {existing ? 'Edit equipment' : 'Add equipment'}
        </span>
        {buildingShortCode && (
          <>
            <span className="t-muted" style={{ fontSize: '0.7rem' }}>
              {existing ? 'in' : 'to'}
            </span>
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

      {/* Row 1: category — a button row, not a dropdown (user 2026-09-29).
          Click the selected one again to clear. */}
      <Field label="Category" block>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {EQUIPMENT_CATEGORIES.map((c) => {
            const on = category === c;
            return (
              <button
                key={c}
                type="button"
                onClick={() => setCategory(on ? '' : c)}
                aria-pressed={on}
                style={{
                  padding: '5px 10px',
                  borderRadius: 4,
                  fontSize: '0.8rem',
                  fontWeight: on ? 600 : 400,
                  border: `1px solid ${on ? 'var(--color-accent)' : 'var(--color-border)'}`,
                  background: on ? 'var(--color-accent)' : 'var(--color-card)',
                  color: on ? 'white' : 'var(--color-text)',
                  cursor: 'pointer',
                }}
              >
                {EQUIPMENT_CATEGORY_LABELS[c]}
              </button>
            );
          })}
        </div>
      </Field>

      {/* Row 2: full name · short name · component of */}
      <div className="grid" style={{ gridTemplateColumns: '2fr 1fr 1.5fr', gap: 6 }}>
        <Field label="Full name *" hint='"Hot Water Pump 3", "Chiller 1"'>
          <input
            type="text"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            autoFocus
            required
            style={inputStyle}
          />
        </Field>
        <Field label="Short name" hint='"HWP-3", "CH-1"'>
          <input
            type="text"
            value={shortName}
            onChange={(e) => setShortName(e.target.value)}
            style={inputStyle}
          />
        </Field>
        <Field label="Component of" hint="blank = top-level">
          <select
            value={parentId}
            onChange={(e) => setParentId(e.target.value)}
            style={inputStyle}
          >
            <option value="">— top-level —</option>
            {parentOptions.map((e) => (
              <option key={e.id} value={e.id}>
                {e.short_name ? `${e.short_name} · ${e.full_name}` : e.full_name}
                {e.parent_equipment_id ? ' (sub)' : ''}
              </option>
            ))}
          </select>
        </Field>
      </div>

      {/* Row 3: location · parts / consumables */}
      <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 6 }}>
        <Field label="Location" hint='"Penthouse, west wall" / "B1 Mech Room"'>
          <input
            type="text"
            value={locationNote}
            onChange={(e) => setLocationNote(e.target.value)}
            style={inputStyle}
          />
        </Field>
        <Field label="Parts / consumables" hint="filter / belt / oil">
          <input
            type="text"
            value={partsNotes}
            onChange={(e) => setPartsNotes(e.target.value)}
            style={inputStyle}
          />
        </Field>
      </div>

      {/* Photo + status on one row to save vertical */}
      <div
        className="grid"
        style={{ gridTemplateColumns: '1fr 1fr', gap: 6, alignItems: 'start' }}
      >
        <Field label="Photo" hint="JPEG / PNG / WebP / HEIC, ≤10 MB · backup for new hires">
          <div style={{ display: 'grid', gap: 4 }}>
            {existing?.photo_url && !removePhoto && !photoFile && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <img
                  src={existing.photo_url}
                  alt={existing.full_name}
                  style={{
                    maxHeight: 60,
                    maxWidth: 100,
                    borderRadius: 4,
                    border: '1px solid var(--color-border)',
                  }}
                />
                <button
                  type="button"
                  onClick={() => setRemovePhoto(true)}
                  className="t-small"
                  style={{
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    color: 'var(--color-danger)',
                    fontSize: '0.7rem',
                  }}
                >
                  Remove
                </button>
              </div>
            )}
            {photoFile && (
              <div className="t-small t-muted" style={{ fontSize: '0.7rem' }}>
                New: {photoFile.name}
              </div>
            )}
            {removePhoto && !photoFile && (
              <div className="t-small" style={{ color: 'var(--color-warn, #d97706)', fontSize: '0.7rem' }}>
                Photo will be removed.
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
              style={{ fontSize: '0.75rem' }}
            />
          </div>
        </Field>
        <Field
          label="Headline status"
          hint="problems (off-PM / down-CM / DEG / BYP) live in issues, not here"
        >
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
      </div>

      {existing?.last_status_change_at && (
        <div className="t-small t-muted" style={{ fontSize: '0.7rem' }}>
          Last status change: {new Date(existing.last_status_change_at).toLocaleString()}
        </div>
      )}

      {error && (
        <div className="t-small" style={{ color: 'var(--color-danger)' }}>{error}</div>
      )}
      {savedAsNew && (
        <div className="t-small" style={{ color: 'var(--color-ok, #10b981)' }}>
          Added as new: <b>{savedAsNew}</b>. Change the name again and save as new for the next one, or Cancel when done.
        </div>
      )}

      <div className="flex gap-2" style={{ marginTop: 2 }}>
        <button
          type="submit"
          disabled={upsert.isPending || uploading}
          className="t-small t-accent"
          style={{
            padding: '6px 12px',
            border: '1px solid var(--color-accent)',
            borderRadius: 4,
            background: 'var(--color-card)',
            fontSize: '0.8rem',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 5,
          }}
        >
          {uploading
            ? 'Uploading…'
            : upsert.isPending
            ? 'Saving…'
            : existing ? 'Save changes' : 'Add equipment'}
          {!uploading && !upsert.isPending && buildingShortCode && (
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
        {existing && (
          <button
            type="button"
            onClick={() => submit(null, true)}
            disabled={upsert.isPending || uploading}
            className="t-small t-accent"
            title="Create a new piece of equipment from these values (the original is left as is)"
            style={{
              padding: '6px 12px',
              border: '1px dashed var(--color-accent)',
              borderRadius: 4,
              background: 'transparent',
              fontSize: '0.8rem',
            }}
          >
            Save as new
          </button>
        )}
        <button
          type="button"
          onClick={onClose}
          className="t-small t-muted"
          style={{
            padding: '6px 12px',
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
  block = false,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
  /** Render as a div (for button groups) instead of a <label>. */
  block?: boolean;
}) {
  const Tag: 'label' | 'div' = block ? 'div' : 'label';
  return (
    <Tag style={{ display: 'block' }}>
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
    </Tag>
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
