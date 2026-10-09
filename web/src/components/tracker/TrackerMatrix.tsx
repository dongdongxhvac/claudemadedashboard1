// TrackerMatrix — the admin's whole-crew view (user 2026-10-09: "editable,
// with all items showed"). Every item is a row — the log counts, the eight
// professional traits, the 28 skills — and every active engineer is a
// column. Trait scores and skill statuses are edited right in the cell;
// notes, SOP write-ups and the dated log live on the per-person panel, which
// a click on the engineer's name opens.
import { useMemo } from 'react';
import type { EngineerRow } from '../../hooks/useEngineers';
import {
  useAllTrackerEntryCounts, useAllTrackerTraits, useAllTrackerSkills,
  useUpsertTrackerTrait, useUpsertTrackerSkill,
} from '../../hooks/useTracker';
import {
  TRACK_KINDS, TRACK_KIND_LABELS,
  TRAITS, SCORE_LABELS,
  SKILLS, SKILL_GROUPS, SKILL_STATUSES, SKILL_STATUS_LABELS,
  type SkillStatus,
} from '../../lib/tracker';

const STATUS_SHORT: Record<SkillStatus, string> = { not_started: '—', learning: 'L', done: 'D', verified: 'V' };
const STATUS_BG: Record<SkillStatus, string> = {
  not_started: 'transparent',
  learning: 'rgba(212,160,23,0.18)',
  done: 'rgba(94,106,210,0.18)',
  verified: 'rgba(16,185,129,0.20)',
};
const cellSel: React.CSSProperties = {
  width: 44, fontSize: 11, padding: '1px 2px', borderRadius: 3,
  border: '1px solid var(--color-border)', color: 'var(--color-text)', textAlign: 'center',
};
const stickyTh: React.CSSProperties = {
  position: 'sticky', left: 0, zIndex: 2, background: 'var(--color-card)', textAlign: 'left',
  padding: '3px 8px 3px 4px', whiteSpace: 'nowrap', borderRight: '1px solid var(--color-border)',
};

export function TrackerMatrix({ engineers, canEdit, onOpen }: {
  engineers: EngineerRow[];
  canEdit: boolean;
  onOpen: (e: EngineerRow) => void;
}) {
  const countsQ = useAllTrackerEntryCounts();
  const traitsQ = useAllTrackerTraits();
  const skillsQ = useAllTrackerSkills();
  const upTrait = useUpsertTrackerTrait();
  const upSkill = useUpsertTrackerSkill();
  const today = new Date().toLocaleDateString('en-CA');

  const cols = useMemo(() => [...engineers].sort((a, b) => a.full_name.localeCompare(b.full_name)), [engineers]);
  const loading = countsQ.isLoading || traitsQ.isLoading || skillsQ.isLoading;
  const err = countsQ.error ?? traitsQ.error ?? skillsQ.error ?? upTrait.error ?? upSkill.error;

  const nameCell = (e: EngineerRow) => (
    <th key={e.user_id} className="t-small" style={{ padding: '4px 2px', verticalAlign: 'bottom', fontWeight: 500, minWidth: 48 }}>
      <button onClick={() => onOpen(e)} title={`${e.full_name} — open the full tracker (log, notes, SOPs)`} className="t-accent hover:underline" style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)', maxHeight: 110, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {e.full_name}{e.is_lead ? ' ★' : ''}
      </button>
    </th>
  );

  return (
    <div className="t-card" style={{ padding: '0.5rem 0.75rem' }}>
      <div className="flex items-baseline justify-between gap-3 flex-wrap mb-1">
        <span className="t-small t-muted">
          {cols.length} engineer{cols.length === 1 ? '' : 's'} · scores 1–4 · skills — / L learning / D done / V verified
          {!canEdit && ' · view only'}
        </span>
        <span className="t-small t-muted">click a name for the log, notes and SOP write-ups</span>
      </div>
      {loading && <p className="t-small t-muted">Loading…</p>}
      {err && <p className="t-small t-danger">Error: {(err as Error).message}</p>}
      {!loading && (
        <div className="overflow-x-auto" style={{ maxHeight: '75vh', overflowY: 'auto' }}>
          <table className="border-collapse" style={{ fontSize: 11 }}>
            <thead>
              <tr>
                <th style={{ ...stickyTh, zIndex: 3, top: 0 }} />
                {cols.map(nameCell)}
              </tr>
            </thead>
            <tbody>
              {/* ── Log counts ── */}
              <GroupRow label="Log" span={cols.length + 1} />
              <tr>
                <th style={stickyTh} className="t-small">Entries · helped / straight</th>
                {cols.map((e) => {
                  const c = countsQ.data?.get(e.user_id);
                  return (
                    <td key={e.user_id} style={{ textAlign: 'center', padding: '2px' }} title={c ? TRACK_KINDS.map((k) => `${TRACK_KIND_LABELS[k]} ${c.byKind[k] ?? 0}`).join(' · ') : 'no entries'}>
                      {c ? <span>{c.total} <span className="t-muted">· {c.help}/{c.straight}</span></span> : <span className="t-muted">—</span>}
                    </td>
                  );
                })}
              </tr>
              {TRACK_KINDS.map((k) => (
                <tr key={k}>
                  <th style={{ ...stickyTh, fontWeight: 400 }} className="t-small t-muted">{TRACK_KIND_LABELS[k]}</th>
                  {cols.map((e) => {
                    const n = countsQ.data?.get(e.user_id)?.byKind[k] ?? 0;
                    return <td key={e.user_id} style={{ textAlign: 'center', padding: '2px' }} className={n ? '' : 't-muted'}>{n || '·'}</td>;
                  })}
                </tr>
              ))}

              {/* ── Professional ── */}
              <GroupRow label="Professional — a licensed tech is a professional (1–4)" span={cols.length + 1} />
              {TRAITS.map((t) => (
                <tr key={t.key}>
                  <th style={stickyTh} className="t-small" title={t.hint}>{t.label}</th>
                  {cols.map((e) => {
                    const row = traitsQ.data?.get(e.user_id)?.get(t.key);
                    const score = row?.score ?? null;
                    return (
                      <td key={e.user_id} style={{ textAlign: 'center', padding: '2px' }}>
                        <select
                          value={score ?? ''}
                          disabled={!canEdit}
                          onChange={(ev) => upTrait.mutate({ user_id: e.user_id, trait: t.key, score: ev.target.value === '' ? null : Number(ev.target.value), note: row?.note ?? null })}
                          title={`${t.label}: ${score !== null ? SCORE_LABELS[score] : 'not scored'}${row?.note ? ` — ${row.note}` : ''}`}
                          style={{ ...cellSel, background: score ? `rgba(94,106,210,${0.08 + score * 0.08})` : 'transparent' }}
                        >
                          <option value="">—</option>
                          {[1, 2, 3, 4].map((n) => <option key={n} value={n}>{n}</option>)}
                        </select>
                      </td>
                    );
                  })}
                </tr>
              ))}

              {/* ── Skills ── */}
              {SKILL_GROUPS.map((g) => (
                <GroupBlock key={g} label={g} span={cols.length + 1}>
                  {SKILLS.filter((s) => s.group === g).map((s) => (
                    <tr key={s.key}>
                      <th style={stickyTh} className="t-small" title={s.hint}>
                        {s.label}{s.sop && <span className="ml-1" style={{ fontSize: 9, fontWeight: 600, color: '#7e22ce' }}>SOP</span>}
                      </th>
                      {cols.map((e) => {
                        const row = skillsQ.data?.get(e.user_id)?.get(s.key);
                        const status: SkillStatus = row?.status ?? 'not_started';
                        return (
                          <td key={e.user_id} style={{ textAlign: 'center', padding: '2px' }}>
                            <select
                              value={status}
                              disabled={!canEdit}
                              onChange={(ev) => {
                                const next = ev.target.value as SkillStatus;
                                upSkill.mutate({
                                  user_id: e.user_id, skill: s.key, status: next,
                                  done_on: next === 'done' || next === 'verified' ? (row?.done_on ?? today) : (row?.done_on ?? null),
                                  sop_text: row?.sop_text ?? null, note: row?.note ?? null,
                                });
                              }}
                              title={`${s.label}: ${SKILL_STATUS_LABELS[status]}${row?.done_on ? ` · ${row.done_on}` : ''}${s.sop ? (row?.sop_text ? ' · SOP written' : ' · SOP not written') : ''}${row?.note ? ` — ${row.note}` : ''}`}
                              style={{ ...cellSel, background: STATUS_BG[status] }}
                            >
                              {SKILL_STATUSES.map((x) => <option key={x} value={x}>{STATUS_SHORT[x]}</option>)}
                            </select>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </GroupBlock>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function GroupRow({ label, span }: { label: string; span: number }) {
  return (
    <tr>
      <td colSpan={span} className="t-small t-muted uppercase tracking-wider" style={{ fontSize: 10, padding: '8px 4px 2px', borderBottom: '1px solid var(--color-border)', position: 'sticky', left: 0 }}>
        {label}
      </td>
    </tr>
  );
}

function GroupBlock({ label, span, children }: { label: string; span: number; children: React.ReactNode }) {
  return (
    <>
      <GroupRow label={label} span={span} />
      {children}
    </>
  );
}
