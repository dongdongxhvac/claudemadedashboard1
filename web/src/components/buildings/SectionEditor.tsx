// Per-category free-form text editor for the building knowledge base.
// Read-only for non-editors; tap-to-edit + autosave-on-blur for admin/lead.
//
// Intentionally PLAIN TEXT in V1 — no markdown rendering, no rich text,
// no toolbar. The walk-through use case is "type what Bobby is saying
// before he moves on"; structure can come later.
import { useEffect, useRef, useState } from 'react';
import { useCanAccessAdmin } from '../../hooks/useMe';
import {
  useUpsertBuildingSection,
  type BuildingSectionNote,
  type SectionKey,
} from '../../hooks/useBuildingKb';

export function SectionEditor({
  buildingId,
  sectionKey,
  note,
}: {
  buildingId: string;
  sectionKey: SectionKey;
  note: BuildingSectionNote | undefined;
}) {
  const canEdit = useCanAccessAdmin();
  const upsert = useUpsertBuildingSection();

  // Local draft state mirrors the saved body. We don't autosave on every
  // keystroke (too many roundtrips); blur-to-save is the model.
  const [draft, setDraft] = useState(note?.body ?? '');
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const taRef = useRef<HTMLTextAreaElement | null>(null);

  // If the server fires realtime back at us with a different body (another
  // editor saved while we were viewing), refresh local state — but ONLY if
  // we're not currently focused. Stomping a typed-in-progress draft is the
  // worst possible outcome.
  useEffect(() => {
    if (document.activeElement === taRef.current) return;
    setDraft(note?.body ?? '');
  }, [note?.body]);

  async function save() {
    if (draft === (note?.body ?? '')) return; // no-op, skip the network call
    try {
      await upsert.mutateAsync({
        building_id: buildingId,
        section_key: sectionKey,
        body: draft,
      });
      setSavedAt(Date.now());
    } catch (e) {
      // RLS rejection (most likely cause if the gate is out of sync) will
      // surface here. Display it inline so the editor knows save failed.
      console.error('Section save failed', e);
    }
  }

  // Mobile-friendly: textarea grows with content. Min 6 rows so the field
  // is visibly editable even when empty.
  if (!canEdit) {
    return (
      <div className="t-text" style={{ whiteSpace: 'pre-wrap' }}>
        {note?.body && note.body.trim() ? (
          note.body
        ) : (
          <span className="t-muted">No notes yet for this section.</span>
        )}
      </div>
    );
  }

  return (
    <div>
      <textarea
        ref={taRef}
        className="t-text w-full"
        style={{
          minHeight: 160,
          padding: 12,
          borderRadius: 6,
          border: '1px solid var(--color-border)',
          background: 'var(--color-card)',
          color: 'var(--color-text)',
          fontFamily: 'inherit',
          resize: 'vertical',
        }}
        placeholder={`Type what you learn about this building's ${sectionKey} system. Saves on blur.`}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={save}
      />
      <div className="t-small t-muted mt-1" style={{ minHeight: 18 }}>
        {upsert.isPending
          ? 'Saving…'
          : upsert.isError
            ? <span style={{ color: 'var(--color-danger)' }}>Save failed — check permissions.</span>
            : savedAt
              ? `Saved ${new Date(savedAt).toLocaleTimeString()}`
              : note?.updated_at
                ? `Last saved ${new Date(note.updated_at).toLocaleString()}`
                : 'No saves yet.'}
      </div>
    </div>
  );
}
