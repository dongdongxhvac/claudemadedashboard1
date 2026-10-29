// Binney St — Clusters · Rounds · Weekend (manager view, below Workload ·
// Performance; user 2026-10-29). Puts the managers' paper sheets on screen:
//
//   * Crews by cluster  — East (Ed Nardone) / West (Andrew Balbo) rosters
//                          from engineer_profiles.cluster, split by 4×10 crew,
//                          tagged with the rounds group(s) each person walks
//                          or "floater" (weekend PM plan).
//   * Buildings         — per cluster → rounds group (E1/E2/W1/W2) with the
//                          sheet's round points + hours; managers can move a
//                          building (buildings.cluster / rounds_group).
//   * Rounds rotation   — Week A / Week B grids, this week highlighted, the
//                          Wednesday A/B rule (which crew walks the Wednesday
//                          round), upcoming Wednesdays, floater/lead/engineer
//                          duties, weekend staffing counts. Editable in place.
//   * Weekend PM plan   — East / Floating / West Saturday-Sunday crews and
//                          PM-hour budgets. Editable in place.
//   * Weekend plan      — the weekly hand-out (BinneyWeekendPlan.tsx).
//
// Data: migration 0154 (site_reference jsonb docs + weekend_plans + the new
// profile/building columns). Binney-only per the isolate-new-features rule.
import { useMemo, useState } from 'react';
import { useMe, manageScopeFor } from '../../hooks/useMe';
import { localISODate, addDays } from '../../lib/dashboard';
import {
  type Cluster, type GroupCode, type RoundsRotation, type PmPlan, type PmPlanGroup, type WeekLetter, type DayKey,
  DAY_KEYS, DAY_LABELS, GROUP_CODES, CLUSTER_LABEL, CLUSTER_STYLE, inputStyle,
  weekLetterFor, otherWeek, upcomingWednesdays, dayKeyOf, sundayOf, splitNames, shortName, fmtMd,
} from '../../lib/binneyRounds';
import {
  useBinneyBuildings, useUpdateBuildingCluster, useSiteReference, useUpsertSiteReference, useBinneyDedicated,
  type BinneyBuilding, type BinneyDedicated,
} from './hooks/useBinneyOps';
import { ClusterBadge } from './ClusterBadge';
import { useBinneyClusterIndex, type ClusterIndex, type ClusterPerson } from './hooks/useBinneyClusterIndex';
import { BinneyWeekendPlanBlock } from './BinneyWeekendPlan';
import { SmallBtn } from './BinneyUi';

const WEEKDAYS: DayKey[] = ['mon', 'tue', 'wed', 'thu', 'fri'];
const BUILDING_GROUPS: Record<Cluster, string[]> = { east: ['E1', 'E2'], west: ['W1', 'W2'] };
const CLUSTERS: Cluster[] = ['east', 'west'];

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

// ── role tags: which rounds group(s) a person walks, floater, trainee ──────

type RoleTag = { groups: Set<GroupCode>; floater: boolean; trainee: GroupCode | null; dedicated: string[] };
type RoleTags = Map<string, RoleTag>;

function buildRoleTags(idx: ClusterIndex, rot: RoundsRotation | null, pm: PmPlan | null, dedicated: BinneyDedicated[]): RoleTags {
  const tags: RoleTags = new Map();
  const get = (id: string): RoleTag => {
    let t = tags.get(id);
    if (!t) { t = { groups: new Set(), floater: false, trainee: null, dedicated: [] }; tags.set(id, t); }
    return t;
  };
  for (const d of dedicated) get(d.user_id).dedicated.push(d.building_code);
  if (rot) {
    for (const w of ['A', 'B'] as WeekLetter[]) {
      for (const d of WEEKDAYS) {
        for (const g of GROUP_CODES) {
          for (const tok of splitNames(rot.weeks?.[w]?.[d]?.[g])) {
            const p = idx.resolve(tok);
            if (p) get(p.user_id).groups.add(g);
          }
        }
      }
    }
    for (const [g, name] of Object.entries(rot.trainees ?? {})) {
      const p = name ? idx.resolve(name) : null;
      if (p) get(p.user_id).trainee = g as GroupCode;
    }
  }
  const floating = pm?.groups.find((g) => g.key === 'floating');
  if (floating) {
    for (const n of floating.saturday) { const p = idx.resolve(n, 'saturday'); if (p) get(p.user_id).floater = true; }
    for (const n of floating.sunday)   { const p = idx.resolve(n, 'sunday');   if (p) get(p.user_id).floater = true; }
  }
  return tags;
}

const ROUND_GROUPS = new Set<GroupCode>(['E1', 'E2', 'W1', 'W2']);
const BMS_GROUPS = new Set<GroupCode>(['EBMS', 'WBMS']);

/** Sort bucket for the crews list (user 2026-10-29): floater → round → BMS,
 *  then shadowing, dedicated, untagged. */
function dutyRank(t: RoleTag | undefined): number {
  if (!t) return 5;
  if (t.floater) return 0;
  if (Array.from(t.groups).some((g) => ROUND_GROUPS.has(g))) return 1;
  if (Array.from(t.groups).some((g) => BMS_GROUPS.has(g))) return 2;
  if (t.trainee) return 3;
  if (t.dedicated.length) return 4;
  return 5;
}

/** On the Week A / Week B rounds grids at all (any weekday cell)? */
function onRoundsSheet(t: RoleTag | undefined): boolean {
  return !!t && t.groups.size > 0;
}

function tagLabel(t: RoleTag | undefined): string | null {
  if (!t) return null;
  const parts: string[] = [];
  if (t.dedicated.length) parts.push(`dedicated · ${t.dedicated.map(abbrevBuilding).join(', ')}`);
  if (t.groups.size) parts.push(Array.from(t.groups).sort().join('·'));
  if (t.floater) parts.push('floater');
  if (t.trainee) parts.push(`shadowing ${t.trainee}`);
  return parts.length ? parts.join(' · ') : null;
}

/** "Assembly Innovation Park" → "AIP"; short codes stay as they are. */
function abbrevBuilding(code: string): string {
  if (code.length <= 12) return code;
  const words = code.split(/\s+/).filter((w) => /^[A-Za-z]/.test(w));
  return words.length >= 2 ? words.map((w) => w[0].toUpperCase()).join('') : code;
}

// ── Crews by cluster ───────────────────────────────────────────────────────

const CREW_LABEL: Record<'sunday' | 'saturday' | 'none', string> = {
  sunday: 'Sun–Wed crew', saturday: 'Wed–Sat crew', none: 'Mon–Fri · no shift',
};

function CrewsBlock({ idx, tags }: { idx: ClusterIndex; tags: RoleTags }) {
  const unclustered = idx.people.filter((p) => p.role === 'engineer' && !p.cluster);
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 flex-wrap mb-1">
        <div className="t-small t-muted uppercase tracking-wider">Crews by cluster · dedicated manager</div>
        <span className="t-small t-muted">
          <mark style={{ background: 'rgba(250, 204, 21, 0.45)', color: 'inherit', padding: '0 3px', borderRadius: 2 }}>highlighted</mark>
          {' '}= not on the Week A / B rounds sheet · sorted floater → round → BMS
        </span>
      </div>
      <div className="grid gap-3" style={{ gridTemplateColumns: '1fr 1fr' }}>
        {CLUSTERS.map((c) => {
          const s = CLUSTER_STYLE[c];
          const mgr = idx.managers[c][0];
          const people = idx.people.filter((p) => p.role === 'engineer' && p.cluster === c);
          const byCrew: Record<'sunday' | 'saturday' | 'none', ClusterPerson[]> = { sunday: [], saturday: [], none: [] };
          for (const p of people) byCrew[p.crew ?? 'none'].push(p);
          return (
            <div key={c} className="rounded p-3" style={{ background: `${s.bg}66`, border: `1px solid ${s.border}` }}>
              <div className="flex items-baseline justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-2">
                  <ClusterBadge cluster={c} size={18} />
                  <b className="t-text">{CLUSTER_LABEL[c]}</b>
                  <span className="t-small t-muted">· manager</span>
                  <b className="t-text">{mgr?.full_name ?? '—'}</b>
                </div>
                <span className="t-small t-muted">{people.length} engineers</span>
              </div>
              {(['sunday', 'saturday', 'none'] as const).map((k) => byCrew[k].length > 0 && (
                <div key={k} className="mt-2">
                  <div className="t-small t-muted" style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{CREW_LABEL[k]}</div>
                  {/* auto-fill columns; names never truncate — a long tag wraps under the name instead */}
                  <ul className="list-none p-0 m-0 mt-0.5 grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(175px, 1fr))', columnGap: 10, rowGap: 2 }}>
                    {byCrew[k].sort((a, b) =>
                      dutyRank(tags.get(a.user_id)) - dutyRank(tags.get(b.user_id))
                      || Number(b.is_lead) - Number(a.is_lead)
                      || a.full_name.localeCompare(b.full_name),
                    ).map((p) => {
                      const t = tags.get(p.user_id);
                      const tag = tagLabel(t);
                      const offSheet = !onRoundsSheet(t);
                      return (
                        <li key={p.user_id} className="t-small flex flex-wrap items-baseline gap-x-1 min-w-0">
                          {p.is_lead && <span style={{ color: '#d4a017', fontSize: 11, lineHeight: 1 }} title="Lead engineer">★</span>}
                          <span
                            className="t-text"
                            title={offSheet ? 'Not on the Week A / Week B building-rounds sheet' : undefined}
                            style={offSheet
                              ? { whiteSpace: 'nowrap', background: 'rgba(250, 204, 21, 0.45)', padding: '0 3px', borderRadius: 2 }
                              : { whiteSpace: 'nowrap' }}
                          >
                            {p.full_name}
                          </span>
                          {tag && <span className="t-mono t-muted" style={{ fontSize: 10, whiteSpace: 'nowrap' }}>{tag}</span>}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </div>
          );
        })}
      </div>
      {unclustered.length > 0 && (
        <p className="t-small t-warn mt-2">
          No cluster yet: {unclustered.map((p) => p.full_name).join(', ')} — set it in Admin › User Profiles.
        </p>
      )}
    </div>
  );
}

// ── Buildings by cluster → rounds group ────────────────────────────────────

function BuildingsBlock({
  bldgs, rot, canEdit, dedicated, idx,
}: {
  bldgs: BinneyBuilding[]; rot: RoundsRotation | null; canEdit: boolean; dedicated: BinneyDedicated[]; idx: ClusterIndex;
}) {
  const [editing, setEditing] = useState(false);
  // building_id → dedicated engineers' short names
  const dedicatedBy = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const d of dedicated) {
      const p = idx.people.find((x) => x.user_id === d.user_id);
      if (!p) continue;
      m.set(d.building_id, [...(m.get(d.building_id) ?? []), shortName(p.full_name)]);
    }
    return m;
  }, [dedicated, idx]);
  const [err, setErr] = useState<string | null>(null);
  const upd = useUpdateBuildingCluster();
  const active = useMemo(() => bldgs.filter((b) => b.active), [bldgs]);
  const stats = rot?.group_stats ?? {};
  const cstats = rot?.cluster_stats ?? {};
  const unassigned = active.filter((b) => !b.cluster);

  const change = async (b: BinneyBuilding, cluster: Cluster | null, group: string | null) => {
    setErr(null);
    try {
      await upd.mutateAsync({ id: b.id, cluster, rounds_group: group });
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const groupStat = (g: string) => {
    const st = stats[g as GroupCode];
    return st ? `${st.points} pts · ${st.hours} h` : null;
  };

  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 mb-1">
        <div className="t-small t-muted uppercase tracking-wider">Buildings · rounds group</div>
        {canEdit && (
          <SmallBtn onClick={() => setEditing((v) => !v)}>{editing ? 'Done' : 'Edit'}</SmallBtn>
        )}
      </div>
      {err && <p className="t-small t-danger mb-1">{err}</p>}
      {editing ? (
        <table className="t-small w-full border-collapse">
          <thead>
            <tr className="t-muted uppercase tracking-wider" style={{ fontSize: 9, borderBottom: '1px solid var(--color-border)' }}>
              <th className="text-left py-1 pr-2">Building</th>
              <th className="text-left py-1 pr-2">Cluster</th>
              <th className="text-left py-1">Rounds group</th>
            </tr>
          </thead>
          <tbody>
            {[...active].sort((a, b) => (a.cluster ?? 'zz').localeCompare(b.cluster ?? 'zz') || (a.rounds_group ?? 'zz').localeCompare(b.rounds_group ?? 'zz') || a.code.localeCompare(b.code)).map((b) => (
              <tr key={b.id} style={{ borderBottom: '1px solid var(--color-border-soft)' }}>
                <td className="py-1 pr-2 t-text">{b.code}</td>
                <td className="py-1 pr-2">
                  <select
                    value={b.cluster ?? ''}
                    disabled={upd.isPending}
                    onChange={(e) => {
                      const c = (e.target.value || null) as Cluster | null;
                      const keep = c && b.rounds_group && BUILDING_GROUPS[c].includes(b.rounds_group) ? b.rounds_group : null;
                      void change(b, c, keep);
                    }}
                    className="border rounded px-1 py-0.5 t-small" style={inputStyle}
                  >
                    <option value="">—</option>
                    <option value="east">East</option>
                    <option value="west">West</option>
                  </select>
                </td>
                <td className="py-1">
                  <select
                    value={b.rounds_group ?? ''}
                    disabled={upd.isPending || !b.cluster}
                    onChange={(e) => void change(b, b.cluster, e.target.value || null)}
                    className="border rounded px-1 py-0.5 t-small" style={inputStyle}
                  >
                    <option value="">no round</option>
                    {(b.cluster ? BUILDING_GROUPS[b.cluster] : []).map((g) => <option key={g} value={g}>{g}</option>)}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="grid gap-3" style={{ gridTemplateColumns: '1fr 1fr' }}>
          {CLUSTERS.map((c) => {
            const s = CLUSTER_STYLE[c];
            const cs = cstats[c];
            const noRound = active.filter((b) => b.cluster === c && !b.rounds_group);
            return (
              <div key={c} className="rounded p-3" style={{ border: `1px solid ${s.border}` }}>
                <div className="flex items-baseline justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2">
                    <ClusterBadge cluster={c} size={16} />
                    <b className="t-text">{CLUSTER_LABEL[c]}</b>
                  </div>
                  {cs && <span className="t-small t-muted t-mono">{cs.points} pts · {cs.hours} h/day</span>}
                </div>
                {BUILDING_GROUPS[c].map((g) => {
                  const list = active.filter((b) => b.cluster === c && b.rounds_group === g);
                  const st = groupStat(g);
                  return (
                    <div key={g} className="mt-2">
                      <div className="flex items-baseline gap-2">
                        <span className="t-small t-text" style={{ fontWeight: 700 }}>{g}</span>
                        {st && <span className="t-small t-muted t-mono" style={{ fontSize: 10 }}>{st}</span>}
                        <span className="t-small t-muted" style={{ fontSize: 10 }}>{list.length} bldg</span>
                      </div>
                      <div className="flex flex-wrap gap-1 mt-0.5">
                        {list.map((b) => {
                          const ded = dedicatedBy.get(b.id);
                          return (
                            <span key={b.id} className="t-small px-1.5 py-0.5 rounded" style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)' }}
                              title={ded ? `Dedicated engineer: ${ded.join(', ')}` : undefined}>
                              {b.code}
                              {ded && <span className="t-muted" style={{ fontSize: 10 }}> · {ded.join(', ')}</span>}
                            </span>
                          );
                        })}
                        {list.length === 0 && <span className="t-small t-muted italic">none</span>}
                      </div>
                    </div>
                  );
                })}
                {noRound.length > 0 && (
                  <div className="mt-2">
                    <span className="t-small t-muted" style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em' }}>no round</span>
                    <div className="flex flex-wrap gap-1 mt-0.5">
                      {noRound.map((b) => (
                        <span key={b.id} className="t-small px-1.5 py-0.5 rounded t-muted" style={{ border: '1px dashed var(--color-border)' }}>{b.code}</span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      {!editing && unassigned.length > 0 && (
        <p className="t-small t-muted mt-2">
          Not in a cluster: {unassigned.map((b) => b.code).join(', ')}{canEdit ? ' — Edit to place them.' : '.'}
        </p>
      )}
    </div>
  );
}

// ── Rounds rotation (Week A / Week B) ──────────────────────────────────────

function RotationBlock({
  rot, idx, week, now, canEdit, onSave, saving,
}: {
  rot: RoundsRotation; idx: ClusterIndex; week: WeekLetter; now: Date; canEdit: boolean;
  onSave: (next: RoundsRotation) => Promise<void>; saving: boolean;
}) {
  const [draft, setDraft] = useState<RoundsRotation | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const view = draft ?? rot;
  const todayKey = dayKeyOf(now);
  const weds = upcomingWednesdays(now, 8, rot);

  const setCell = (w: WeekLetter, d: DayKey, g: GroupCode, v: string) =>
    setDraft((prev) => { const next = clone(prev ?? rot); next.weeks[w][d][g] = v; return next; });
  const setTrainee = (g: GroupCode, v: string) =>
    setDraft((prev) => {
      const next = clone(prev ?? rot);
      next.trainees = { ...(next.trainees ?? {}) };
      if (v.trim()) next.trainees[g] = v; else delete next.trainees[g];
      return next;
    });

  const save = async () => {
    if (!draft) { return; }
    setErr(null);
    try { await onSave(draft); setDraft(null); } catch (e) { setErr((e as Error).message); }
  };

  const renderCell = (w: WeekLetter, d: DayKey, g: GroupCode) => {
    const raw = view.weeks?.[w]?.[d]?.[g] ?? '';
    if (draft) {
      return (
        <input value={raw} onChange={(e) => setCell(w, d, g, e.target.value)}
          className="w-full border rounded px-1 t-small t-text" style={{ ...inputStyle, minWidth: 0 }} />
      );
    }
    if (/^floaters?$/i.test(raw.trim())) return <span className="t-muted italic">Floater</span>;
    const toks = splitNames(raw);
    if (d === 'wed' && toks.length > 1) {
      const ruleCrew = rot.wednesday_rule[w];
      return (
        <span>
          {toks.map((t, i) => {
            const p = idx.resolve(t);
            const walks = p?.crew === ruleCrew;
            return (
              <span key={i}>
                {i > 0 && <span className="t-muted">/</span>}
                <span style={walks ? { fontWeight: 700, textDecoration: 'underline', textDecorationColor: 'var(--color-accent)' } : undefined}
                  title={walks ? `Walks the Wednesday round in week ${w} (${ruleCrew} crew)` : undefined}>{t}</span>
              </span>
            );
          })}
        </span>
      );
    }
    return <span>{raw}</span>;
  };

  const groupsFor = (c: Cluster) => view.groups.filter((g) => g.cluster === c);

  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 flex-wrap mb-1">
        <div className="flex items-baseline gap-3 flex-wrap">
          <div className="t-small t-muted uppercase tracking-wider">Building rounds · rotation</div>
          <span className="t-small t-muted">
            Wednesday round alternates: week A → <b className="t-text">{rot.wednesday_rule.A}</b> crew, week B → <b className="t-text">{rot.wednesday_rule.B}</b> crew.
            Both crews overlap Wednesday; the underlined name walks it.
          </span>
        </div>
        {canEdit && (
          <div className="flex items-center gap-1">
            {draft ? (
              <>
                <SmallBtn onClick={() => { setDraft(null); setErr(null); }} disabled={saving}>Cancel</SmallBtn>
                <SmallBtn onClick={() => void save()} disabled={saving} primary>{saving ? 'Saving…' : 'Save rotation'}</SmallBtn>
              </>
            ) : (
              <SmallBtn onClick={() => setDraft(clone(rot))}>Edit</SmallBtn>
            )}
          </div>
        )}
      </div>
      {err && <p className="t-small t-danger mb-1">{err}</p>}

      <div className="grid gap-3" style={{ gridTemplateColumns: '1fr 1fr' }}>
        {(['A', 'B'] as WeekLetter[]).map((w) => {
          const current = w === week;
          return (
            <div key={w} className="rounded p-2" style={{ border: `${current ? 2 : 1}px solid ${current ? 'var(--color-accent)' : 'var(--color-border)'}` }}>
              <div className="flex items-baseline justify-between mb-1">
                <b className="t-text">Week {w}</b>
                <span className="t-small" style={{ color: current ? 'var(--color-accent)' : 'var(--color-text-muted)', fontWeight: current ? 700 : 400 }}>
                  {current ? 'this week' : 'next week'} · Wed round: {rot.wednesday_rule[w]} crew
                </span>
              </div>
              <table className="w-full border-collapse" style={{ fontSize: 11, tableLayout: 'fixed' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
                    <th className="text-left py-0.5 pr-1 t-muted" style={{ width: 70, fontWeight: 500 }}></th>
                    {CLUSTERS.map((c) => groupsFor(c).map((g) => (
                      <th key={g.code} className="text-left py-0.5 px-1" style={{ background: `${CLUSTER_STYLE[c].bg}99`, color: CLUSTER_STYLE[c].fg, fontWeight: 700 }}>{g.label}</th>
                    )))}
                  </tr>
                </thead>
                <tbody>
                  {DAY_KEYS.map((d) => {
                    const today = current && d === todayKey;
                    return (
                      <tr key={d} style={{ borderBottom: '1px solid var(--color-border-soft)', background: today ? 'rgba(37,99,235,0.10)' : undefined }}>
                        <td className="py-0.5 pr-1 t-text" style={{ fontWeight: today ? 700 : 500 }}>{DAY_LABELS[d].slice(0, 3)}{today ? ' ◀' : ''}</td>
                        {CLUSTERS.map((c) => groupsFor(c).map((g) => (
                          <td key={g.code} className="py-0.5 px-1 t-text truncate">{renderCell(w, d, g.code)}</td>
                        )))}
                      </tr>
                    );
                  })}
                  {(draft || Object.keys(view.trainees ?? {}).length > 0) && w === 'A' && (
                    <tr>
                      <td className="py-0.5 pr-1 t-muted italic">shadow</td>
                      {CLUSTERS.map((c) => groupsFor(c).map((g) => {
                        const v = view.trainees?.[g.code] ?? '';
                        return (
                          <td key={g.code} className="py-0.5 px-1" style={{ background: v ? 'rgba(34,197,94,0.18)' : undefined }}>
                            {draft
                              ? <input value={v} onChange={(e) => setTrainee(g.code, e.target.value)} placeholder="—" className="w-full border rounded px-1 t-small" style={inputStyle} />
                              : v}
                          </td>
                        );
                      }))}
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          );
        })}
      </div>

      <div className="mt-2">
        <div className="t-small t-muted" style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Wednesday rounds ahead</div>
        <div className="flex flex-wrap gap-1 mt-0.5">
          {weds.map((x) => {
            const isThis = sundayOf(x.date).getTime() === sundayOf(now).getTime();
            return (
              <span key={x.date.toISOString()} className="t-small px-1.5 py-0.5 rounded"
                style={{ background: isThis ? 'var(--color-accent)' : 'var(--color-bg)', color: isThis ? 'white' : undefined, border: '1px solid var(--color-border)' }}>
                {fmtMd(x.date)} · <b>{x.week}</b> · {x.crew}
              </span>
            );
          })}
        </div>
        {rot.note && <p className="t-small t-muted mt-1">{rot.note}</p>}
      </div>
    </div>
  );
}

/** Floater / Lead / Engineer duties + weekend floater/lead counts (rounds
 *  sheet). Lives under the weekend PM plan (user 2026-10-29). */
function DutiesBlock({ rot }: { rot: RoundsRotation }) {
  return (
    <div>
      <div className="t-small t-muted uppercase tracking-wider">Duties · weekend staffing</div>
      <ul className="list-none p-0 m-0 mt-0.5">
        {(rot.roles ?? []).map((r) => (
          <li key={r.role} className="t-small"><b className="t-text">{r.role}</b> <span className="t-muted">— {r.duty}</span></li>
        ))}
      </ul>
      {rot.weekend_staffing && (
        <p className="t-small t-text mt-1">
          Sat: <b>{rot.weekend_staffing.saturday.floaters}</b> floaters + <b>{rot.weekend_staffing.saturday.leads}</b> lead{rot.weekend_staffing.saturday.leads === 1 ? '' : 's'}
          {' · '}
          Sun: <b>{rot.weekend_staffing.sunday.floaters}</b> floaters + <b>{rot.weekend_staffing.sunday.leads}</b> lead{rot.weekend_staffing.sunday.leads === 1 ? '' : 's'}
        </p>
      )}
    </div>
  );
}

// ── Weekend PM plan (East / Floating / West) ───────────────────────────────

function PmPlanBlock({
  pm, idx, canEdit, onSave, saving,
}: {
  pm: PmPlan; idx: ClusterIndex; canEdit: boolean; onSave: (next: PmPlan) => Promise<void>; saving: boolean;
}) {
  const [draft, setDraft] = useState<PmPlan | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const view = draft ?? pm;

  const setGroup = (i: number, patch: Partial<PmPlanGroup>) =>
    setDraft((prev) => {
      const next = clone(prev ?? pm);
      next.groups[i] = { ...next.groups[i], ...patch };
      const g = next.groups[i];
      g.month_hours = Math.round(g.pm_hours * (g.saturday.length + g.sunday.length) * 10) / 10;
      next.totals.month_hours = Math.round(next.groups.reduce((s, x) => s + x.month_hours, 0) * 10) / 10;
      return next;
    });

  const save = async () => {
    if (!draft) return;
    setErr(null);
    try { await onSave(draft); setDraft(null); } catch (e) { setErr((e as Error).message); }
  };

  const names = (list: string[], crew: 'saturday' | 'sunday') => (
    <span className="flex flex-wrap gap-x-2 gap-y-0.5">
      {list.map((n, i) => {
        const p = idx.resolve(n, crew);
        const info = p ? idx.byUserId.get(p.user_id) : null;
        return (
          <span key={i} className="inline-flex items-center gap-1 whitespace-nowrap" title={p ? p.full_name : undefined}>
            {p?.is_lead && <span style={{ color: '#d4a017', fontSize: 10 }}>★</span>}
            <span>{p ? shortName(p.full_name) : n}</span>
            <ClusterBadge cluster={info?.cluster} manager={info?.managerName} size={11} />
          </span>
        );
      })}
    </span>
  );

  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 mb-1">
        <div className="t-small t-muted uppercase tracking-wider">Weekend PM plan · hours budget</div>
        {canEdit && (
          <div className="flex items-center gap-1">
            {draft ? (
              <>
                <SmallBtn onClick={() => { setDraft(null); setErr(null); }} disabled={saving}>Cancel</SmallBtn>
                <SmallBtn onClick={() => void save()} disabled={saving} primary>{saving ? 'Saving…' : 'Save plan'}</SmallBtn>
              </>
            ) : (
              <SmallBtn onClick={() => setDraft(clone(pm))}>Edit</SmallBtn>
            )}
          </div>
        )}
      </div>
      {err && <p className="t-small t-danger mb-1">{err}</p>}
      <table className="w-full border-collapse t-small">
        <thead>
          <tr className="t-muted uppercase tracking-wider" style={{ fontSize: 9, borderBottom: '1px solid var(--color-border)' }}>
            <th className="text-left py-1 pr-2">Group</th>
            <th className="text-left py-1 pr-2">Saturday</th>
            <th className="text-left py-1 pr-2">Sunday</th>
            <th className="text-right py-1 pr-2" title="Hours of PMs per engineer, as on the planning sheet">Hours of PMs</th>
            <th className="text-right py-1" title="Group total = hours of PMs × headcount">Group total</th>
          </tr>
        </thead>
        <tbody>
          {view.groups.map((g, i) => (
            <tr key={g.key} style={{ borderBottom: '1px solid var(--color-border-soft)' }}>
              <td className="py-1 pr-2 align-top">
                <b className="t-text">{g.label}</b>
                {g.manager && <div className="t-muted" style={{ fontSize: 10 }}>{g.manager}</div>}
              </td>
              <td className="py-1 pr-2 align-top">
                {draft
                  ? <input value={g.saturday.join(', ')} onChange={(e) => setGroup(i, { saturday: splitNames(e.target.value) })} className="w-full border rounded px-1 t-small" style={inputStyle} />
                  : names(g.saturday, 'saturday')}
              </td>
              <td className="py-1 pr-2 align-top">
                {draft
                  ? <input value={g.sunday.join(', ')} onChange={(e) => setGroup(i, { sunday: splitNames(e.target.value) })} className="w-full border rounded px-1 t-small" style={inputStyle} />
                  : names(g.sunday, 'sunday')}
              </td>
              <td className="py-1 pr-2 text-right t-mono align-top">
                {draft
                  ? <input type="number" step="0.5" value={g.pm_hours} onChange={(e) => setGroup(i, { pm_hours: Number(e.target.value) })} className="border rounded px-1 t-small text-right" style={{ ...inputStyle, width: 64 }} />
                  : g.pm_hours}
              </td>
              <td className="py-1 text-right t-mono align-top">{g.month_hours}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={4} className="py-1 pr-2 t-muted">
              {view.totals.days_per_week} days · {view.totals.weeks} weeks · {view.totals.hours_per_day} hours per day · {view.totals.hours_per_month} hours per month · total
            </td>
            <td className="py-1 text-right t-mono t-text" style={{ fontWeight: 700 }}>{view.totals.month_hours}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

// ── Panel ──────────────────────────────────────────────────────────────────

export function BinneyOpsPanel() {
  const idx = useBinneyClusterIndex();
  const bldgQ = useBinneyBuildings();
  const rotQ = useSiteReference<RoundsRotation>('rounds_rotation');
  const pmQ = useSiteReference<PmPlan>('pm_plan');
  const dedQ = useBinneyDedicated();
  const upsertRef = useUpsertSiteReference();
  const me = useMe();
  const canEdit = manageScopeFor(me.data) !== 'none';

  // One clock per calendar day — the week-letter math only moves with the date.
  const todayIso = localISODate(new Date());
  const now = useMemo(() => new Date(todayIso + 'T12:00:00'), [todayIso]);

  const rot = rotQ.data?.value ?? null;
  const pm = pmQ.data?.value ?? null;
  const week = rot ? weekLetterFor(now, rot) : null;
  const sun = sundayOf(now);
  const dedicated = useMemo(() => dedQ.data ?? [], [dedQ.data]);
  const tags = useMemo(() => buildRoleTags(idx, rot, pm, dedicated), [idx, rot, pm, dedicated]);

  const err = rotQ.error ?? pmQ.error ?? bldgQ.error ?? null;
  const missingRef = !rotQ.isLoading && !rotQ.error && rotQ.data === null;

  return (
    <section className="t-card" style={{ padding: '1rem 1.25rem', borderTop: '3px solid var(--color-accent)' }}>
      <div className="flex items-baseline justify-between flex-wrap gap-2 mb-3">
        <div className="flex items-baseline gap-3 flex-wrap">
          <h2 className="t-section-title" style={{ letterSpacing: '0.04em' }}>Clusters · Rounds · Weekend</h2>
          <span className="t-small t-muted">East = Kendall · Ed Nardone &nbsp;·&nbsp; West = 301 · Andrew Balbo</span>
        </div>
        {rot && week && (
          <span className="t-small px-2 py-0.5 rounded-full" style={{ background: 'var(--color-accent)', color: 'white', fontWeight: 600 }}
            title="Rotation week for the Sun–Sat week containing today">
            Week {week} · {fmtMd(sun)} – {fmtMd(addDays(sun, 6))} · Wed round → {rot.wednesday_rule[week]} crew · next week {otherWeek(week)}
          </span>
        )}
      </div>

      {err && <p className="t-small t-danger mb-2">Couldn't load: {(err as Error).message}</p>}
      {missingRef && (
        <p className="t-small t-muted mb-2">
          Reference documents not seeded yet (site_reference · binney) — apply migration 0154.
        </p>
      )}

      <div className="grid gap-6" style={{ gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)' }}>
        <CrewsBlock idx={idx} tags={tags} />
        <BuildingsBlock bldgs={bldgQ.data ?? []} rot={rot} canEdit={canEdit} dedicated={dedicated} idx={idx} />
      </div>

      {rot && week && (
        <div className="mt-5">
          <RotationBlock
            rot={rot} idx={idx} week={week} now={now} canEdit={canEdit}
            saving={upsertRef.isPending}
            onSave={async (next) => { await upsertRef.mutateAsync({ key: 'rounds_rotation', value: next }); }}
          />
        </div>
      )}

      <div className="grid gap-6 mt-5" style={{ gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1.1fr)' }}>
        <div className="space-y-4">
          {pm && (
            <PmPlanBlock
              pm={pm} idx={idx} canEdit={canEdit}
              saving={upsertRef.isPending}
              onSave={async (next) => { await upsertRef.mutateAsync({ key: 'pm_plan', value: next }); }}
            />
          )}
          {rot && <DutiesBlock rot={rot} />}
        </div>
        <BinneyWeekendPlanBlock idx={idx} rot={rot} canEdit={canEdit} now={now} />
      </div>
    </section>
  );
}
