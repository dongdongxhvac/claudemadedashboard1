import { useEffect, useMemo, useState } from 'react';
import {
  useSites, useTrainingBuildings, useTrainingRoster,
} from '../../hooks/useTraining';
import {
  useTrainingCuration, useSaveTrainingCuration,
  ALL_SECTIONS, SECTION_LABELS, toggleId,
  type TrainingCuration,
} from '../../hooks/useTrainingCuration';

// The supervisor's "pick what to show" control. Buildings + techs + section
// toggles edit a local working copy; Save spreads the LATEST curation and
// overrides only these fields, so it never clobbers pinnedEquipmentIds set
// inline from a building panel.

type Working = { b: string[]; t: string[]; s: string[] };

export function CurationPicker({ ready }: { ready: boolean }) {
  const { curation } = useTrainingCuration();
  const save = useSaveTrainingCuration();
  const sitesQ = useSites();
  const bldgsQ = useTrainingBuildings(ready);
  const rosterQ = useTrainingRoster(ready);

  const [open, setOpen] = useState(true);
  const [working, setWorking] = useState<Working>({ b: [], t: [], s: [...ALL_SECTIONS] });
  const [dirty, setDirty] = useState(false);
  const [bSearch, setBSearch] = useState('');
  const [tSearch, setTSearch] = useState('');

  // Sync the working copy from saved curation until the user starts editing.
  const snap = JSON.stringify([
    curation.pinnedBuildingIds, curation.pinnedTechIds, curation.visibleSections,
  ]);
  useEffect(() => {
    if (dirty) return;
    const [b, t, s] = JSON.parse(snap) as [string[], string[], string[]];
    setWorking({ b, t, s });
  }, [snap, dirty]);

  const siteName = useMemo(
    () => new Map((sitesQ.data ?? []).map((x) => [x.id, x.name])),
    [sitesQ.data],
  );

  const buildings = (bldgsQ.data ?? []).filter((x) => {
    const q = bSearch.trim().toLowerCase();
    if (!q) return true;
    return (x.name + ' ' + (x.short_code ?? x.code)).toLowerCase().includes(q);
  });
  const bySite = useMemo(() => {
    const m = new Map<string, typeof buildings>();
    for (const b of buildings) {
      const key = b.site_id ?? '_none';
      (m.get(key) ?? m.set(key, []).get(key)!).push(b);
    }
    return m;
  }, [buildings]);

  const techs = (rosterQ.data ?? []).filter((x) => {
    const q = tSearch.trim().toLowerCase();
    if (!q) return true;
    return x.full_name.toLowerCase().includes(q);
  });

  const edit = (fn: (w: Working) => Working) => { setWorking(fn); setDirty(true); };

  async function onSave() {
    const next: TrainingCuration = {
      ...curation,
      pinnedBuildingIds: working.b,
      pinnedTechIds: working.t,
      visibleSections: working.s,
    };
    try {
      await save.mutateAsync(next);
      setDirty(false);
    } catch (e) {
      console.error('Save curation failed', e);
    }
  }

  return (
    <section className="t-card">
      <div className="flex items-baseline justify-between mb-2 gap-3">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="t-section-title text-left"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer', background: 'none', border: 'none', padding: 0, color: 'inherit', font: 'inherit' }}
        >
          <span style={{ fontSize: 11, color: 'var(--color-text-muted)', display: 'inline-block', width: 10, transform: open ? 'none' : 'rotate(-90deg)' }}>▾</span>
          Choose what to show
        </button>
        <div className="flex items-center gap-3">
          {dirty && <span className="t-small" style={{ color: 'var(--color-warn, #d97706)' }}>unsaved</span>}
          {save.isError && <span className="t-small" style={{ color: 'var(--color-danger)' }}>save failed — check permissions</span>}
          <button
            type="button"
            onClick={onSave}
            disabled={!dirty || save.isPending}
            className="t-small t-accent"
            style={{ padding: '4px 12px', borderRadius: 4, border: '1px solid var(--color-accent)', background: 'var(--color-card)', cursor: dirty ? 'pointer' : 'default', opacity: dirty ? 1 : 0.5 }}
          >
            {save.isPending ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>

      {open && (
        <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
          {/* Buildings */}
          <div>
            <PickHeader label="Buildings" count={working.b.length} />
            {ready ? (
              <>
                <SearchBox value={bSearch} onChange={setBSearch} placeholder="filter buildings…" />
                <div style={listStyle}>
                  {[...bySite.entries()].map(([sid, list]) => (
                    <div key={sid}>
                      <div className="t-small t-muted uppercase tracking-wider" style={{ fontSize: '0.6rem', padding: '4px 4px 2px' }}>
                        {siteName.get(sid) ?? 'Unassigned'}
                      </div>
                      {list.map((b) => (
                        <label key={b.id} className="flex items-center gap-2 t-row-hover" style={rowStyle}>
                          <input type="checkbox" checked={working.b.includes(b.id)} onChange={() => edit((w) => ({ ...w, b: toggleId(w.b, b.id) }))} />
                          <span className="t-mono t-small" style={{ minWidth: 44, color: 'var(--color-text)' }}>{b.short_code ?? b.code}</span>
                          <span className="t-small" style={{ flex: 1, minWidth: 0 }}>{b.name}</span>
                        </label>
                      ))}
                    </div>
                  ))}
                  {buildings.length === 0 && <p className="t-small t-muted" style={{ padding: 6 }}>No buildings.</p>}
                </div>
              </>
            ) : <PendingNote />}
          </div>

          {/* Techs */}
          <div>
            <PickHeader label="Techs" count={working.t.length} />
            {ready ? (
              <>
                <SearchBox value={tSearch} onChange={setTSearch} placeholder="filter techs…" />
                <div style={listStyle}>
                  {techs.map((t) => (
                    <label key={t.user_id} className="flex items-center gap-2 t-row-hover" style={rowStyle}>
                      <input type="checkbox" checked={working.t.includes(t.user_id)} onChange={() => edit((w) => ({ ...w, t: toggleId(w.t, t.user_id) }))} />
                      <span className="t-small" style={{ flex: 1, minWidth: 0 }}>{t.full_name}</span>
                      {t.discipline && <span className="t-small t-muted">{t.discipline}</span>}
                    </label>
                  ))}
                  {techs.length === 0 && <p className="t-small t-muted" style={{ padding: 6 }}>No techs.</p>}
                </div>
              </>
            ) : <PendingNote />}
          </div>

          {/* Sections */}
          <div>
            <PickHeader label="Sections" count={working.s.length} />
            <div style={listStyle}>
              {ALL_SECTIONS.map((sec) => (
                <label key={sec} className="flex items-center gap-2 t-row-hover" style={rowStyle}>
                  <input type="checkbox" checked={working.s.includes(sec)} onChange={() => edit((w) => ({ ...w, s: toggleId(w.s, sec) }))} />
                  <span className="t-small">{SECTION_LABELS[sec]}</span>
                </label>
              ))}
            </div>
            <p className="t-small t-muted" style={{ marginTop: 6 }}>
              Pick equipment to focus inside each building's panel.
            </p>
          </div>
        </div>
      )}
    </section>
  );
}

const listStyle: React.CSSProperties = {
  maxHeight: 220, overflowY: 'auto', marginTop: 6,
  border: '1px solid var(--color-border-soft)', borderRadius: 4, padding: 4,
};
const rowStyle: React.CSSProperties = { padding: '2px 4px', cursor: 'pointer' };

function PickHeader({ label, count }: { label: string; count: number }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="t-text" style={{ fontWeight: 600 }}>{label}</span>
      {count > 0 && <span className="t-small t-accent">{count} picked</span>}
    </div>
  );
}

function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="t-text"
      style={{ width: '100%', marginTop: 6, padding: '4px 8px', borderRadius: 4, border: '1px solid var(--color-border)', background: 'var(--color-card)' }}
    />
  );
}

function PendingNote() {
  return <p className="t-small t-muted" style={{ marginTop: 6 }}>Pending migration 0072 + roster import.</p>;
}
