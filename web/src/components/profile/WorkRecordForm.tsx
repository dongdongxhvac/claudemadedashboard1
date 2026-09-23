// Add / edit one work record. Used by the engineer's own page ("My record",
// status stays 'self') and by leads on the profile page (verifyNow=true →
// lands verified). Phone-first: big tap targets, one column.
import { useState } from 'react';
import {
  useUpsertWorkRecord, kindHasIndependence,
  KIND_LABELS, KIND_ORDER, INDEPENDENCE_LABELS, INDEPENDENCE_ORDER, TASK_SUGGESTIONS,
  type WorkRecord, type WorkRecordKind, type Independence,
} from '../../hooks/useWorkRecords';

export type FormBuilding = { id: string; code: string; short_code: string | null; name: string };

const box = {
  width: '100%', border: '1px solid var(--color-border)', background: 'var(--color-card)',
  color: 'var(--color-text)', borderRadius: 6, padding: '8px 10px', fontSize: 14,
} as const;

export function WorkRecordForm({
  userId, buildings, initial, verifyNow = false, onDone, onCancel,
}: {
  userId: string;
  buildings: FormBuilding[];
  initial?: WorkRecord | null;
  /** Lead/manager recording for someone else: save straight to verified. */
  verifyNow?: boolean;
  onDone: () => void;
  onCancel: () => void;
}) {
  const upsert = useUpsertWorkRecord();
  const today = new Date().toLocaleDateString('en-CA');
  const [kind, setKind]           = useState<WorkRecordKind>(initial?.kind ?? 'skill');
  const [date, setDate]           = useState(initial?.occurred_on ?? today);
  const [buildingId, setBuilding] = useState(initial?.building_id ?? '');
  const [task, setTask]           = useState(initial?.task ?? '');
  const [indep, setIndep]         = useState<Independence>(initial?.independence ?? 'solo');
  const [note, setNote]           = useState(initial?.note ?? '');
  const [file, setFile]           = useState<File | null>(null);
  const [removePhoto, setRemove]  = useState(false);
  const [err, setErr]             = useState<string | null>(null);

  const submit = async () => {
    setErr(null);
    if (!task.trim()) { setErr('Say what you did.'); return; }
    if (!date) { setErr('Pick the date.'); return; }
    try {
      await upsert.mutateAsync({
        id: initial?.id, user_id: userId, occurred_on: date,
        building_id: buildingId || null, kind, task,
        independence: kindHasIndependence(kind) ? indep : null,
        note: note || null, file, removePhoto, verifyNow,
      });
      onDone();
    } catch (e) { setErr((e as Error).message); }
  };

  const seg = (active: boolean) => ({
    padding: '7px 10px', borderRadius: 6, fontSize: 13, fontWeight: active ? 600 : 400,
    border: `1px solid ${active ? 'var(--color-accent)' : 'var(--color-border)'}`,
    background: active ? 'var(--color-accent-soft, rgba(99,102,241,0.10))' : 'var(--color-card)',
    color: active ? 'var(--color-accent)' : 'var(--color-text)',
  });

  return (
    <div className="space-y-3">
      <div>
        <div className="t-small t-muted mb-1">What kind of entry</div>
        <div className="flex flex-wrap gap-1.5">
          {KIND_ORDER.map((k) => (
            <button key={k} type="button" onClick={() => setKind(k)} style={seg(kind === k)}>{KIND_LABELS[k]}</button>
          ))}
        </div>
        {kind === 'knowledge' && (
          <p className="t-small t-muted mt-1">
            Building HVAC set-up counts when you explained it in the office — a hand drawing presented to a lead. Add a photo of the drawing below.
          </p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <div className="t-small t-muted mb-1">Date</div>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={box} />
        </label>
        <label className="block">
          <div className="t-small t-muted mb-1">Building</div>
          <select value={buildingId} onChange={(e) => setBuilding(e.target.value)} style={box}>
            <option value="">— none / site-wide —</option>
            {buildings.map((b) => (
              <option key={b.id} value={b.id}>{b.short_code ?? b.code} — {b.name}</option>
            ))}
          </select>
        </label>
      </div>

      <label className="block">
        <div className="t-small t-muted mb-1">What you did</div>
        <input
          type="text" value={task} onChange={(e) => setTask(e.target.value)} style={box}
          list={`wr-tasks-${kind}`} placeholder={TASK_SUGGESTIONS[kind][0]} maxLength={160}
        />
        <datalist id={`wr-tasks-${kind}`}>
          {TASK_SUGGESTIONS[kind].map((t) => <option key={t} value={t} />)}
        </datalist>
      </label>

      {kindHasIndependence(kind) && (
        <div>
          <div className="t-small t-muted mb-1">How</div>
          <div className="flex flex-wrap gap-1.5">
            {INDEPENDENCE_ORDER.map((i) => (
              <button key={i} type="button" onClick={() => setIndep(i)} style={seg(indep === i)}>{INDEPENDENCE_LABELS[i]}</button>
            ))}
          </div>
          <p className="t-small t-muted mt-1">"Solo, no interruption" = finished with no operation interruption and no callback.</p>
        </div>
      )}

      <label className="block">
        <div className="t-small t-muted mb-1">Note (optional) — equipment, what happened, who was there</div>
        <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} style={box} maxLength={2000} />
      </label>

      <label className="block">
        <div className="t-small t-muted mb-1">Photo (optional) — the drawing, the job</div>
        <input
          type="file" accept="image/*,application/pdf" capture="environment"
          onChange={(e) => { setFile(e.target.files?.[0] ?? null); setRemove(false); }}
          className="t-small"
        />
        {initial?.photo_path && !file && (
          <label className="t-small t-muted inline-flex items-center gap-1 mt-1">
            <input type="checkbox" checked={removePhoto} onChange={(e) => setRemove(e.target.checked)} /> remove current photo
          </label>
        )}
      </label>

      {err && <p className="t-small t-danger">{err}</p>}

      <div className="flex gap-3 justify-end pt-1">
        <button type="button" onClick={onCancel} className="t-small">Cancel</button>
        <button
          type="button" onClick={submit} disabled={upsert.isPending}
          className="t-small font-semibold px-4 py-2 rounded"
          style={{ background: 'var(--color-accent)', color: '#fff' }}
        >
          {upsert.isPending ? 'Saving…' : initial ? 'Save changes' : verifyNow ? 'Add as verified' : 'Add to my record'}
        </button>
      </div>
    </div>
  );
}
