// /engineer/:id/profile — the engineer work record (rebuilt 2026-09-23).
//
// Layout "A · work record" from the profile studies: a compact header (no
// level bar), then four ruled sections rolled up from dated, verified
// entries (work_records, migration 0134):
//   1 · Buildings   — task × building grid (times done + independence mark;
//                     knowledge rows show ✓ when the building's set-up has
//                     been explained / walked) + the record itself
//   2 · Training & certifications — training entries + the certifications card
//   3 · COVE performance — CMMS completions (real data)
//   4 · OT availability  — §11 sign-ups / worked by category + the engineer's
//                          own availability days
// Career timeline and admin notes stay at the bottom (2026-09-22 work).
//
// Access: admin/manager can view any; engineer can view own iff
// visible_to_self=true; otherwise RLS returns no row → friendly 403 message.
import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useEngineerProfile, type CompletionEntry } from '../../hooks/useEngineerProfile';
import { useMe, manageScopeFor } from '../../hooks/useMe';
import { useCareerTimeline } from '../../hooks/useCareerTimeline';
import { CareerTimeline } from '../../components/profile/CareerTimeline';
import { CertificationsCard } from '../../components/profile/CertificationsCard';
import { useMySiteAccess, useHomeSiteCodeOf, useUparkBuildingIds } from '../../hooks/useSiteScope';
import { DISCIPLINES } from '../../hooks/useEngineers';
import { useEngineers } from '../../hooks/useEngineers';
import { useShifts } from '../../hooks/useShifts';
import { useBuildings } from '../../hooks/useBuildings';
import {
  useWorkRecords, useVerifyWorkRecord, useDeleteWorkRecord, useWorkRecordPhotoUrl,
  useOtAvailability, useUpsertOtAvailability, useOvertimeHistory,
  KIND_LABELS, INDEPENDENCE_LABELS, TASK_SUGGESTIONS, OT_DAYS, kindHasIndependence,
  BUILDING_SYSTEMS, systemSignoffs,
  type WorkRecord, type WorkRecordKind, type Independence, type OtDay,
} from '../../hooks/useWorkRecords';
import { BuildingSheet } from '../../components/profile/BuildingSheet';
import { OVERTIME_CATEGORY_LABELS, OVERTIME_CATEGORY_ORDER, type OvertimeCategory } from '../../hooks/useOvertime';
import { WorkRecordForm, type FormBuilding } from '../../components/profile/WorkRecordForm';
import { PT } from '../../components/profile/theme';

// ── palette for this page (option A: cream paper, ink rules) ──────────────
const C = {
  page:  '#fbfaf6',
  band:  '#f6f4ec',
  ink:   '#1c1d21',
  mute:  '#5c5f66',
  faint: '#8a8d94',
  line:  '#e3e0d6',
  grp:   '#efece3',
  ok:    '#2f7d4f',
  warn:  '#a4620b',
  ex:    '#c4c0b4',
} as const;
const MONO = 'ui-monospace, SFMono-Regular, Menlo, monospace';

const h3: React.CSSProperties = {
  fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.1em', color: C.mute, margin: '0 0 10px',
  paddingBottom: 6, borderBottom: `1px solid ${C.ink}`, display: 'flex', justifyContent: 'space-between',
  alignItems: 'baseline', fontWeight: 600, gap: 12, flexWrap: 'wrap',
};
const sub: React.CSSProperties = { fontWeight: 400, letterSpacing: 0, textTransform: 'none', fontSize: 12 };
const th: React.CSSProperties = { fontWeight: 500, color: C.mute, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', padding: '6px 6px', borderBottom: `1px solid ${C.line}`, textAlign: 'left', verticalAlign: 'bottom' };
const td: React.CSSProperties = { padding: '7px 6px', borderBottom: `1px solid ${C.line}`, verticalAlign: 'middle', fontSize: 13 };
const pill = (color: string): React.CSSProperties => ({ fontSize: 11, border: `1px solid ${color}`, color, padding: '1px 6px', borderRadius: 2, whiteSpace: 'nowrap' });
const linkBtn: React.CSSProperties = { color: C.ink, textDecoration: 'underline', fontSize: 12, background: 'none', border: 0, padding: 0, cursor: 'pointer' };

function fmtYmd(iso: string): string {
  return new Date(iso + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}
function fmtShort(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
function weeksSince(ymd: string, now: number): number {
  return Math.max(0, Math.floor((now - new Date(ymd + 'T00:00:00').getTime()) / (7 * 86_400_000)));
}
function clock(t: string): string {
  const [h, m] = t.split(':').map(Number);
  const ap = h >= 12 ? 'pm' : 'am';
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')}${ap}`;
}

/** Independence marks: ○ with lead · ● solo · ◉ solo, no interruption. */
function Mark({ i, size = 10 }: { i: Independence | 'know'; size?: number }) {
  const base: React.CSSProperties = { display: 'inline-block', width: size, height: size, borderRadius: '50%', border: `1.5px solid ${C.ink}`, verticalAlign: -1, marginRight: 4, background: '#fff' };
  if (i === 'know') return <i style={{ ...base, borderRadius: 0, width: size - 1, height: size - 1, background: C.ink }} />;
  if (i === 'solo') return <i style={{ ...base, background: C.ink }} />;
  if (i === 'solo_clean') return <i style={{ ...base, background: C.ink, boxShadow: `inset 0 0 0 2px ${C.page}` }} />;
  return <i style={base} />;
}
const RANK: Record<Independence, number> = { with_lead: 1, solo: 2, solo_clean: 3 };

export default function EngineerProfile() {
  const { id } = useParams<{ id: string }>();
  const me = useMe();
  const q = useEngineerProfile(id);
  const access = useMySiteAccess();
  const targetSite = useHomeSiteCodeOf(id);
  const career = useCareerTimeline(id);

  if (q.isLoading || me.isLoading) return <Wrap><p style={{ padding: 24 }}>Loading...</p></Wrap>;
  if (q.isError) return <Wrap><p style={{ color: PT.danger, padding: 24 }}>Error: {(q.error as Error).message}</p></Wrap>;

  if (!q.data || !q.data.profile) return <Locked title="Profile not available" body="This profile doesn't exist or has been removed." back="/" />;

  const { profile: p, completions } = q.data;
  const isSelf = me.data?.id === p.user_id;
  const isAdminOrMgr = me.data?.role === 'admin' || me.data?.role === 'manager';
  const crossSiteBlocked =
    !isSelf && !access.canSeeAllSites && !access.isLoading && !targetSite.isLoading &&
    targetSite.siteCode !== null && targetSite.siteCode !== access.homeSite;
  if (crossSiteBlocked) return <Locked title="Profile not available" body="This profile doesn't exist or has been removed." back="/" />;
  if (isSelf && !isAdminOrMgr && !p.visible_to_self) {
    return <Locked title="Profile not yet shared" body="Your profile is being set up by your admin. It will appear here once ready." back="/engineer/me" backLabel="← Back to my work" />;
  }

  const managerIsh = manageScopeFor(me.data) !== 'none';
  const canEdit = managerIsh || me.data?.is_lead === true;

  return (
    <Wrap>
      <ProfileBody
        p={p}
        completions={completions}
        siteCode={targetSite.siteCode}
        isSelf={isSelf}
        canEdit={canEdit}
        managerIsh={managerIsh}
        isAdmin={me.data?.role === 'admin'}
        career={career}
      />
    </Wrap>
  );
}

function ProfileBody({
  p, completions, siteCode, isSelf, canEdit, managerIsh, isAdmin, career,
}: {
  p: NonNullable<ReturnType<typeof useEngineerProfile>['data']>['profile'];
  completions: CompletionEntry[];
  siteCode: string | null;
  isSelf: boolean;
  canEdit: boolean;
  managerIsh: boolean;
  isAdmin: boolean;
  career: ReturnType<typeof useCareerTimeline>;
}) {
  const recordsQ = useWorkRecords(p.user_id);
  const verify = useVerifyWorkRecord();
  const del = useDeleteWorkRecord();
  const engineersQ = useEngineers();
  const shiftsQ = useShifts();
  const buildingsQ = useBuildings();
  const uparkIds = useUparkBuildingIds();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<WorkRecord | null>(null);
  const [showAllRecords, setShowAllRecords] = useState(false);
  // Building set-up sheet, tucked under the grid — opens from a column head.
  const [openBuilding, setOpenBuilding] = useState<string | null>(null);
  // Snapshot of "now" for this mount — keeps render pure (react-hooks/purity).
  const [now] = useState(() => Date.now());

  const records = useMemo(() => recordsQ.data ?? [], [recordsQ.data]);
  const eng = engineersQ.data?.find((e) => e.user_id === p.user_id);
  const shift = eng?.shift_id ? shiftsQ.data?.find((s) => s.id === eng.shift_id) : null;
  const siteLabel = siteCode === 'binney' ? 'Binney St' : 'UPark';
  const initials = p.full_name.split(/\s+/).map((s) => s[0]).slice(0, 2).join('').toUpperCase();

  // Buildings of this person's site — the grid columns.
  const buildings = useMemo<FormBuilding[]>(() => {
    const all = (buildingsQ.data ?? []) as FormBuilding[];
    if (!uparkIds) return all;
    const isUpark = siteCode !== 'binney';
    return all.filter((b) => (isUpark ? uparkIds.has(b.id) : !uparkIds.has(b.id)));
  }, [buildingsQ.data, uparkIds, siteCode]);

  // ── Section 1 roll-up: task rows × building columns ─────────────────────
  type Cell = { count: number; best: Independence | null; verifiedCount: number };
  const grid = useMemo(() => {
    const kinds: WorkRecordKind[] = ['skill', 'problem', 'major_pm'];
    const rowsByKind = new Map<WorkRecordKind, Map<string, Map<string, Cell>>>();
    for (const k of kinds) {
      const m = new Map<string, Map<string, Cell>>();
      for (const t of TASK_SUGGESTIONS[k]) m.set(t, new Map());
      rowsByKind.set(k, m);
    }
    for (const r of records) {
      if (r.kind === 'training') continue;
      const m = rowsByKind.get(r.kind)!;
      if (!m.has(r.task)) m.set(r.task, new Map());
      const col = r.building_id ?? '__site';
      const cells = m.get(r.task)!;
      const c = cells.get(col) ?? { count: 0, best: null, verifiedCount: 0 };
      c.count += 1;
      if (r.status === 'verified') c.verifiedCount += 1;
      if (r.independence && (!c.best || RANK[r.independence] > RANK[c.best])) c.best = r.independence;
      cells.set(col, c);
    }
    // drop fixed suggestion rows that have no entries at all, except a
    // couple of anchors so a fresh profile still shows the shape
    const ANCHOR = new Set(['Cooling tower cleaning support', 'Motor & pump rebuild', 'BMS operation', 'VFD fault troubleshooting', 'Major off-hour PM']);
    const out: { kind: WorkRecordKind; task: string; cells: Map<string, Cell>; total: number }[] = [];
    for (const k of kinds) {
      for (const [task, cells] of rowsByKind.get(k)!) {
        const total = [...cells.values()].reduce((s, c) => s + c.count, 0);
        if (total === 0 && !ANCHOR.has(task)) continue;
        out.push({ kind: k, task, cells, total });
      }
    }
    return out;
  }, [records]);
  const hasSiteWide = grid.some((g) => g.cells.has('__site'));

  // ── Section 3 roll-up: completions ───────────────────────────────────────
  const cove = useMemo(() => {
    const d90 = now - 90 * 86_400_000;
    const recent = completions.filter((c) => new Date(c.first_seen_at).getTime() >= d90);
    const hours = recent.reduce((s, c) => s + (Number(c.labor_hours) || 0), 0);
    const weeks = Array.from({ length: 12 }, (_, i) => {
      const end = now - (11 - i) * 7 * 86_400_000;
      const start = end - 7 * 86_400_000;
      return completions.filter((c) => { const t = new Date(c.first_seen_at).getTime(); return t >= start && t < end; }).length;
    });
    return { count90: recent.length, hours90: hours, last: completions[0]?.first_seen_at ?? null, weeks, max: Math.max(1, ...weeks) };
  }, [completions, now]);

  const trainings = records.filter((r) => r.kind === 'training');
  const shownRecords = showAllRecords ? records : records.slice(0, 12);

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: '20px 24px 48px' }}>
      <nav style={{ marginBottom: 12, fontSize: 12, color: C.mute }}>
        <Link to={isSelf && !managerIsh ? '/engineer/me' : '/manager'} style={{ color: C.mute }}>{isSelf && !managerIsh ? '← My work' : '← Dashboard'}</Link>
        {isAdmin && <> · <Link to="/admin" style={{ color: C.mute }}>Admin</Link></>}
      </nav>

      {/* ── compact header (no level bar) ─────────────────────────────── */}
      <header style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '12px 16px', alignItems: 'center', padding: '14px 18px', border: `1px solid ${C.ink}`, borderBottomWidth: 2, background: C.band, marginBottom: 22 }}>
        <div style={{ width: 44, height: 44, border: `2px solid ${C.ink}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, fontWeight: 600, background: '#fff' }}>{initials}</div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 19, fontWeight: 600, lineHeight: 1.15 }}>
            {p.full_name}
            {p.discipline && (
              <span style={{ ...pill(C.mute), marginLeft: 10, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                {DISCIPLINES.find((d) => d.value === p.discipline)?.label ?? p.discipline}
              </span>
            )}
          </div>
          <div style={{ color: C.mute, fontSize: 12.5, marginTop: 2, display: 'flex', flexWrap: 'wrap', gap: '0 14px' }}>
            <span>Engineer · {siteLabel}{eng?.title ? ` · ${eng.title}` : ''}</span>
            {shift && <span>{clock(shift.start_time)} shift</span>}
            {p.hiring_date && <span>Hired {fmtYmd(p.hiring_date)} · {weeksSince(p.hiring_date, now)} wk</span>}
            {p.email && <span style={{ fontFamily: MONO }}>{p.email}</span>}
            {p.phone && <span style={{ fontFamily: MONO }}>{p.phone}</span>}
          </div>
        </div>
      </header>

      {/* ── 1 · Buildings ─────────────────────────────────────────────── */}
      <section style={{ marginBottom: 26 }}>
        <h3 style={h3}>
          <span>1 · Buildings</span>
          <span style={sub}>
            task × building · times done · <Mark i="with_lead" /> with lead <Mark i="solo" /> solo <Mark i="solo_clean" /> solo, no interruption · click a building for its set-up sheet
            {canEdit && !adding && !editing && (
              <button onClick={() => setAdding(true)} style={{ ...linkBtn, marginLeft: 12, fontWeight: 600 }}>+ Add entry</button>
            )}
          </span>
        </h3>

        {(adding || editing) && (
          <div style={{ border: `1px solid ${C.line}`, background: '#fff', padding: '12px 14px', marginBottom: 14 }}>
            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8 }}>{editing ? 'Edit entry' : `New entry for ${p.full_name} — saved as verified by you`}</div>
            <WorkRecordForm
              userId={p.user_id}
              buildings={buildings}
              initial={editing}
              verifyNow={!editing || editing.status === 'verified'}
              onDone={() => { setAdding(false); setEditing(null); }}
              onCancel={() => { setAdding(false); setEditing(null); }}
            />
          </div>
        )}

        <div style={{ overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 720 }}>
            <thead>
              <tr>
                <th style={{ ...th, paddingLeft: 0, minWidth: 200 }}>Task / skill</th>
                {buildings.map((b) => (
                  <th key={b.id} style={{ ...th, textAlign: 'center', fontSize: 10.5, letterSpacing: 0, padding: '5px 3px', background: openBuilding === b.id ? '#fbf3d6' : undefined }}>
                    <button onClick={() => setOpenBuilding(openBuilding === b.id ? null : b.id)} title={`${b.name} — open set-up sheet`} style={{ background: 'none', border: 0, padding: 0, font: 'inherit', color: 'inherit', cursor: 'pointer', textDecoration: 'underline dotted' }}>
                      {b.short_code ?? b.code}
                    </button>
                  </th>
                ))}
                {hasSiteWide && <th style={{ ...th, textAlign: 'center', fontSize: 10.5 }}>Site</th>}
                <th style={{ ...th, textAlign: 'right' }}>Total</th>
              </tr>
            </thead>
            <tbody>
              <GridGroup label="Knowledge · building set-up · systems signed off" span={buildings.length + 2 + (hasSiteWide ? 1 : 0)}>
                <tr>
                  <td style={{ ...td, paddingLeft: 0, fontWeight: 500 }}>HVAC mechanical set-up <span style={{ fontWeight: 400, color: C.mute, fontSize: 11 }}>· {BUILDING_SYSTEMS.length} systems, explained in office</span></td>
                  {buildings.map((b) => {
                    const signs = systemSignoffs(records, b.id);
                    const v = BUILDING_SYSTEMS.filter((s) => signs.get(s)?.status === 'verified').length;
                    const pend = BUILDING_SYSTEMS.filter((s) => signs.get(s)?.status === 'self').length;
                    const none = v === 0 && pend === 0;
                    return (
                      <td key={b.id} style={{ ...td, textAlign: 'center', fontFamily: MONO, fontSize: 12, padding: '5px 3px', whiteSpace: 'nowrap', color: none ? C.ex : C.ink, fontWeight: v === BUILDING_SYSTEMS.length ? 600 : 400, background: openBuilding === b.id ? '#fbf3d6' : undefined }}
                          title={`${v} verified · ${pend} pending · of ${BUILDING_SYSTEMS.length}`}>
                        {none ? '·' : <>{v}/{BUILDING_SYSTEMS.length}{pend > 0 && <sup style={{ color: C.warn }}>+{pend}</sup>}</>}
                      </td>
                    );
                  })}
                  {hasSiteWide && <td style={{ ...td, textAlign: 'center', color: C.ex }}>·</td>}
                  <td style={{ ...td, textAlign: 'right', fontFamily: MONO, fontSize: 12, whiteSpace: 'nowrap' }}>
                    {(() => {
                      const done = buildings.filter((b) => { const s = systemSignoffs(records, b.id); return BUILDING_SYSTEMS.every((x) => s.get(x)?.status === 'verified'); }).length;
                      const sys = buildings.reduce((n, b) => { const s = systemSignoffs(records, b.id); return n + BUILDING_SYSTEMS.filter((x) => s.get(x)?.status === 'verified').length; }, 0);
                      return sys === 0 ? <span style={{ color: C.faint }}>—</span> : <><b>{done}</b> of {buildings.length} bldgs · {sys}/{buildings.length * BUILDING_SYSTEMS.length} systems</>;
                    })()}
                  </td>
                </tr>
              </GridGroup>
              {(['skill', 'problem', 'major_pm'] as WorkRecordKind[]).map((k) => {
                const rows = grid.filter((g) => g.kind === k);
                if (rows.length === 0) return null;
                return (
                  <GridGroup key={k} label={KIND_LABELS[k]} span={buildings.length + 2 + (hasSiteWide ? 1 : 0)}>
                    {rows.map((g) => (
                      <tr key={`${g.kind}:${g.task}`}>
                        <td style={{ ...td, paddingLeft: 0, fontWeight: 500 }}>{g.task}</td>
                        {[...buildings.map((b) => b.id), ...(hasSiteWide ? ['__site'] : [])].map((col) => {
                          const c = g.cells.get(col);
                          return (
                            <td key={col} style={{ ...td, textAlign: 'center', fontFamily: MONO, fontSize: 12, padding: '5px 3px', whiteSpace: 'nowrap', color: c ? C.ink : C.ex }}>
                              {!c ? '·' : <span title={`${c.count} × · ${c.best ? INDEPENDENCE_LABELS[c.best] : ''} · ${c.verifiedCount} verified`}>{c.best && <Mark i={c.best} />}{c.count}</span>}
                            </td>
                          );
                        })}
                        <td style={{ ...td, textAlign: 'right', fontFamily: MONO, fontSize: 12, whiteSpace: 'nowrap' }}>
                          {g.total === 0 ? <span style={{ color: C.faint }}>—</span> : (
                            <>
                              <b>{g.total}</b>
                              {(() => { const best = [...g.cells.values()].reduce<Independence | null>((b, c) => (c.best && (!b || RANK[c.best] > RANK[b]) ? c.best : b), null); return best ? ` · best: ${INDEPENDENCE_LABELS[best].toLowerCase()}` : ''; })()}
                            </>
                          )}
                        </td>
                      </tr>
                    ))}
                  </GridGroup>
                );
              })}
            </tbody>
          </table>
        </div>

        {openBuilding && (() => {
          const b = buildings.find((x) => x.id === openBuilding);
          return b ? (
            <div style={{ marginTop: 12 }}>
              <BuildingSheet
                buildingId={b.id}
                buildingLabel={b.short_code ?? b.code}
                buildingName={b.name}
                userId={p.user_id}
                isSelf={isSelf}
                canVerify={canEdit}
                onClose={() => setOpenBuilding(null)}
                kbHref={(managerIsh || canEdit) && siteCode !== 'binney' ? `/buildings/${encodeURIComponent(b.short_code ?? b.code)}` : null}
              />
            </div>
          ) : null;
        })()}

        <h3 style={{ ...h3, marginTop: 18 }}>
          <span>Record</span>
          <span style={sub}>{records.length} entr{records.length === 1 ? 'y' : 'ies'} · {records.filter((r) => r.status === 'verified').length} verified · newest first</span>
        </h3>
        {recordsQ.isLoading ? <p style={{ fontSize: 13, color: C.mute }}>Loading…</p>
        : records.length === 0 ? (
          <p style={{ fontSize: 13, color: C.mute, margin: 0 }}>
            No entries yet. {isSelf ? 'Add what you did from "My record" on your own page.' : 'The engineer records their own day-to-day from their page; you can also add entries here.'}
          </p>
        ) : (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {shownRecords.map((r) => (
              <RecordRow
                key={r.id} r={r} canEdit={canEdit}
                onVerify={(v) => verify.mutate({ id: r.id, user_id: r.user_id, verified: v })}
                onEdit={() => { setEditing(r); setAdding(false); }}
                onDelete={() => { if (confirm('Delete this entry?')) del.mutate(r); }}
              />
            ))}
          </ul>
        )}
        {records.length > shownRecords.length && (
          <button onClick={() => setShowAllRecords(true)} style={{ ...linkBtn, marginTop: 8 }}>Show all {records.length}</button>
        )}
      </section>

      {/* ── 2 · Training & certifications ─────────────────────────────── */}
      <section style={{ marginBottom: 26 }}>
        <h3 style={h3}><span>2 · Training &amp; certifications</span><span style={sub}>{trainings.length} training entr{trainings.length === 1 ? 'y' : 'ies'}</span></h3>
        {trainings.length > 0 && (
          <table style={{ borderCollapse: 'collapse', width: '100%', marginBottom: 14 }}>
            <thead><tr><th style={{ ...th, paddingLeft: 0 }}>Training</th><th style={th}>Where</th><th style={{ ...th, textAlign: 'right' }}>Completed</th><th style={{ ...th, textAlign: 'right' }}>Status</th></tr></thead>
            <tbody>
              {trainings.map((t) => (
                <tr key={t.id}>
                  <td style={{ ...td, paddingLeft: 0 }}>{t.task}{t.note && <div style={{ fontSize: 11.5, color: C.mute }}>{t.note}</div>}</td>
                  <td style={{ ...td, fontFamily: MONO, fontSize: 12 }}>{t.building_code ? `Bld ${t.building_code}` : '—'}</td>
                  <td style={{ ...td, textAlign: 'right', fontFamily: MONO, fontSize: 12 }}>{t.occurred_on}</td>
                  <td style={{ ...td, textAlign: 'right' }}>
                    {t.status === 'verified' ? <span style={pill(C.ok)}>Verified</span> : <span style={pill(C.mute)}>Recorded</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <CertificationsCard userId={p.user_id} milestones={career.milestones} canEdit={canEdit} glow="transparent" />
      </section>

      {/* ── 3 · COVE performance ──────────────────────────────────────── */}
      <section style={{ marginBottom: 26 }}>
        <h3 style={h3}><span>3 · COVE performance</span><span style={sub}>from CMMS completions · last 90 days</span></h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', border: `1px solid ${C.line}`, marginBottom: 12 }}>
          <Kv k="Completions · 90 d" v={String(cove.count90)} />
          <Kv k="Labor hours · 90 d" v={cove.hours90.toFixed(1)} />
          <Kv k="Last completion" v={cove.last ? fmtShort(cove.last) : '—'} />
          <Kv k="Tracked total" v={String(completions.length)} sub="last 30 shown" />
        </div>
        <div style={{ display: 'flex', gap: 3, alignItems: 'flex-end', height: 34, margin: '6px 0 4px' }}>
          {cove.weeks.map((n, i) => (
            <i key={i} title={`${n} completion${n === 1 ? '' : 's'}`} style={{ flex: 1, display: 'block', minHeight: 2, height: `${Math.max(6, (n / cove.max) * 100)}%`, background: n ? C.ink : C.line }} />
          ))}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: C.mute, marginBottom: 12 }}>
          <span>12 weeks ago</span><span>completions per week</span><span>this week</span>
        </div>
        {completions.length === 0
          ? <p style={{ fontSize: 13, color: C.mute, margin: 0 }}>No completions tracked yet. PM sign-offs from the CMMS appear here as task number, type, labor hours, and date.</p>
          : <CompletionList rows={completions} />}
      </section>

      {/* ── 4 · OT availability ───────────────────────────────────────── */}
      <OtSection userId={p.user_id} canEditAvail={isSelf || canEdit} />

      {/* ── Career timeline + admin notes (2026-09-22 work, kept) ───────── */}
      <section style={{ marginBottom: 26 }}>
        <h3 style={h3}><span>Career</span></h3>
        <CareerTimeline
          userId={p.user_id}
          events={career.events}
          isLoading={career.isLoading}
          error={career.isError ? (career.error as Error) : null}
          canEdit={canEdit}
          canManagerRows={managerIsh}
          showPrivate={managerIsh || isSelf}
          glow="transparent"
        />
      </section>
      {p.notes && managerIsh && (
        <section style={{ marginBottom: 26 }}>
          <h3 style={h3}><span>Notes</span><span style={sub}>admin / manager only</span></h3>
          <p style={{ whiteSpace: 'pre-wrap', fontSize: 13, margin: 0 }}>{p.notes}</p>
        </section>
      )}
    </div>
  );
}

function GridGroup({ label, span, children }: { label: string; span: number; children: React.ReactNode }) {
  return (
    <>
      <tr><td colSpan={span} style={{ background: C.grp, fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '0.08em', color: C.mute, padding: '4px 6px', borderTop: `1px solid ${C.line}` }}>{label}</td></tr>
      {children}
    </>
  );
}

function RecordRow({ r, canEdit, onVerify, onEdit, onDelete }: {
  r: WorkRecord; canEdit: boolean; onVerify: (v: boolean) => void; onEdit: () => void; onDelete: () => void;
}) {
  const [showPhoto, setShowPhoto] = useState(false);
  return (
    <li style={{ display: 'grid', gridTemplateColumns: '82px 56px 1fr auto', gap: 12, padding: '7px 0', borderBottom: `1px solid ${C.line}`, fontSize: 13, alignItems: 'baseline' }}>
      <span style={{ fontFamily: MONO, fontSize: 12, color: C.mute }}>{r.occurred_on}</span>
      <span style={{ fontFamily: MONO, fontSize: 12 }}>{r.building_code ? `Bld ${r.building_code}` : <span style={{ color: C.faint }}>site</span>}</span>
      <span>
        <b style={{ fontWeight: 600 }}>{r.task}</b>
        <span style={{ color: C.mute, fontSize: 11.5, marginLeft: 8, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{KIND_LABELS[r.kind]}</span>
        {r.note && <div style={{ fontSize: 12, color: C.mute }}>{r.note}</div>}
        {r.photo_path && (
          <div style={{ fontSize: 12 }}>
            <button onClick={() => setShowPhoto((v) => !v)} style={linkBtn}>{showPhoto ? 'Hide photo' : 'Photo'}</button>
            {showPhoto && <RecordPhoto path={r.photo_path} />}
          </div>
        )}
      </span>
      <span style={{ textAlign: 'right', fontSize: 11.5, color: C.mute, whiteSpace: 'nowrap' }}>
        {r.independence && kindHasIndependence(r.kind) && <span><Mark i={r.independence} />{INDEPENDENCE_LABELS[r.independence].toLowerCase()} · </span>}
        {r.status === 'verified'
          ? <span style={{ color: C.ok }}>verified{r.verified_by_name ? ` · ${r.verified_by_name}` : ''}</span>
          : <span style={{ color: C.warn }}>recorded by engineer</span>}
        {canEdit && (
          <span style={{ marginLeft: 10, display: 'inline-flex', gap: 8 }}>
            {r.status === 'self'
              ? <button onClick={() => onVerify(true)} style={{ ...linkBtn, color: C.ok, fontWeight: 600 }}>Verify</button>
              : <button onClick={() => onVerify(false)} style={linkBtn}>Unverify</button>}
            <button onClick={onEdit} style={linkBtn}>Edit</button>
            <button onClick={onDelete} style={{ ...linkBtn, color: C.mute }}>Delete</button>
          </span>
        )}
      </span>
    </li>
  );
}

function RecordPhoto({ path }: { path: string }) {
  const url = useWorkRecordPhotoUrl(path);
  if (url.isLoading) return <span style={{ color: C.mute }}> loading…</span>;
  if (!url.data) return <span style={{ color: C.mute }}> (unavailable)</span>;
  return path.toLowerCase().endsWith('.pdf')
    ? <div><a href={url.data} target="_blank" rel="noreferrer" style={{ color: C.ink }}>Open PDF</a></div>
    : <div style={{ marginTop: 6 }}><a href={url.data} target="_blank" rel="noreferrer"><img src={url.data} alt="record photo" style={{ maxWidth: 360, maxHeight: 280, border: `1px solid ${C.line}` }} /></a></div>;
}

function Kv({ k, v, sub: s }: { k: string; v: string; sub?: string }) {
  return (
    <div style={{ padding: '8px 12px', borderRight: `1px solid ${C.line}` }}>
      <div style={{ fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '0.08em', color: C.mute }}>{k}</div>
      <div style={{ fontSize: 16, fontWeight: 600, marginTop: 1, fontFamily: MONO }}>{v}{s && <small style={{ fontSize: 11, fontWeight: 400, color: C.mute, marginLeft: 4, fontFamily: 'inherit' }}>{s}</small>}</div>
    </div>
  );
}

function OtSection({ userId, canEditAvail }: { userId: string; canEditAvail: boolean }) {
  const hist = useOvertimeHistory(userId);
  const availQ = useOtAvailability(userId);
  const save = useUpsertOtAvailability();
  const [editing, setEditing] = useState(false);
  const rows = hist.data ?? [];
  const [now] = useState(() => Date.now());
  const byCat = OVERTIME_CATEGORY_ORDER.map((cat) => {
    const mine = rows.filter((r) => r.category === cat && r.status !== 'cancelled');
    const worked = mine.filter((r) => r.status === 'completed' || new Date(r.ends_at ?? r.starts_at).getTime() < now);
    const last = mine[0]?.starts_at ?? null;
    return { cat, signed: mine.length, worked: worked.length, last };
  });
  const totSigned = byCat.reduce((s, c) => s + c.signed, 0);
  const totWorked = byCat.reduce((s, c) => s + c.worked, 0);
  const a = availQ.data;

  return (
    <section style={{ marginBottom: 26 }}>
      <h3 style={h3}><span>4 · OT availability</span><span style={sub}>from §11 overtime posts · sign-ups and completed shifts</span></h3>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '0 32px' }}>
        <table style={{ borderCollapse: 'collapse', width: '100%', alignSelf: 'start' }}>
          <thead><tr><th style={{ ...th, paddingLeft: 0 }}>Category</th><th style={{ ...th, textAlign: 'right' }}>Worked</th><th style={{ ...th, textAlign: 'right' }}>Signed up</th><th style={{ ...th, textAlign: 'right' }}>Last</th></tr></thead>
          <tbody>
            {byCat.map((c) => (
              <tr key={c.cat}>
                <td style={{ ...td, paddingLeft: 0, fontWeight: 500 }}>{OVERTIME_CATEGORY_LABELS[c.cat as OvertimeCategory]}</td>
                <td style={{ ...td, textAlign: 'right', fontFamily: MONO }}>{c.worked}</td>
                <td style={{ ...td, textAlign: 'right', fontFamily: MONO }}>{c.signed}</td>
                <td style={{ ...td, textAlign: 'right', fontFamily: MONO, fontSize: 12, color: C.mute }}>{c.last ? `${fmtShort(c.last)}${new Date(c.last).getTime() > now ? ' · upcoming' : ''}` : '—'}</td>
              </tr>
            ))}
            <tr>
              <td style={{ ...td, paddingLeft: 0, fontWeight: 600 }}>Total</td>
              <td style={{ ...td, textAlign: 'right', fontFamily: MONO, fontWeight: 600 }}>{totWorked}</td>
              <td style={{ ...td, textAlign: 'right', fontFamily: MONO, fontWeight: 600 }}>{totSigned}</td>
              <td style={{ ...td }} />
            </tr>
          </tbody>
        </table>
        <div>
          <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: C.mute, marginBottom: 6, display: 'flex', justifyContent: 'space-between' }}>
            <span>Usually available</span>
            {canEditAvail && !editing && <button onClick={() => setEditing(true)} style={linkBtn}>Edit</button>}
          </div>
          {editing ? (
            <AvailEditor
              userId={userId} initial={a}
              saving={save.isPending}
              onSave={async (v) => { await save.mutateAsync(v); setEditing(false); }}
              onCancel={() => setEditing(false)}
            />
          ) : (
            <>
              <div style={{ display: 'inline-flex', gap: 3 }}>
                {OT_DAYS.map((d) => {
                  const on = a?.days.includes(d.key);
                  return <i key={d.key} style={{ width: 26, height: 18, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontStyle: 'normal', border: `1px solid ${on ? C.ink : C.line}`, background: on ? C.ink : '#fff', color: on ? '#fff' : C.faint }}>{d.label}</i>;
                })}
              </div>
              <div style={{ fontSize: 12, color: C.mute, marginTop: 8 }}>
                {a ? `Nights: ${a.nights ? 'yes' : 'no'} · Early (before 6am): ${a.early ? 'yes' : 'no'}${a.notice ? ` · Notice: ${a.notice}` : ''}` : 'Not set yet.'}
                {a?.note && <div>{a.note}</div>}
              </div>
              <p style={{ fontSize: 11.5, color: C.mute, margin: '10px 0 0' }}>Availability is set by the engineer; the counts come from posts and sign-ups.</p>
            </>
          )}
        </div>
      </div>
    </section>
  );
}

function AvailEditor({ userId, initial, saving, onSave, onCancel }: {
  userId: string;
  initial: { days: OtDay[]; nights: boolean; early: boolean; notice: string | null; note: string | null } | null | undefined;
  saving: boolean;
  onSave: (v: { user_id: string; days: OtDay[]; nights: boolean; early: boolean; notice: string | null; note: string | null }) => Promise<void>;
  onCancel: () => void;
}) {
  const [days, setDays] = useState<OtDay[]>(initial?.days ?? []);
  const [nights, setNights] = useState(initial?.nights ?? false);
  const [early, setEarly] = useState(initial?.early ?? false);
  const [notice, setNotice] = useState(initial?.notice ?? '');
  const [note, setNote] = useState(initial?.note ?? '');
  const [err, setErr] = useState<string | null>(null);
  const toggle = (d: OtDay) => setDays((cur) => (cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d]));
  const inp: React.CSSProperties = { border: `1px solid ${C.line}`, background: '#fff', padding: '4px 8px', fontSize: 13, width: '100%' };
  return (
    <div style={{ fontSize: 13 }}>
      <div style={{ display: 'inline-flex', gap: 3 }}>
        {OT_DAYS.map((d) => {
          const on = days.includes(d.key);
          return <button key={d.key} type="button" onClick={() => toggle(d.key)} style={{ width: 30, height: 24, fontSize: 11, border: `1px solid ${on ? C.ink : C.line}`, background: on ? C.ink : '#fff', color: on ? '#fff' : C.mute, cursor: 'pointer' }}>{d.label}</button>;
        })}
      </div>
      <div style={{ display: 'flex', gap: 14, marginTop: 8, flexWrap: 'wrap' }}>
        <label><input type="checkbox" checked={nights} onChange={(e) => setNights(e.target.checked)} /> Nights</label>
        <label><input type="checkbox" checked={early} onChange={(e) => setEarly(e.target.checked)} /> Early (before 6am)</label>
      </div>
      <div style={{ marginTop: 8 }}><input value={notice} onChange={(e) => setNotice(e.target.value)} placeholder="Notice preferred, e.g. 24 h" maxLength={80} style={inp} /></div>
      <div style={{ marginTop: 6 }}><input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Anything else (optional)" maxLength={500} style={inp} /></div>
      {err && <p style={{ color: PT.danger, fontSize: 12 }}>{err}</p>}
      <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end', marginTop: 8 }}>
        <button onClick={onCancel} style={linkBtn}>Cancel</button>
        <button
          disabled={saving}
          onClick={async () => { setErr(null); try { await onSave({ user_id: userId, days, nights, early, notice: notice || null, note: note || null }); } catch (e) { setErr((e as Error).message); } }}
          style={{ ...linkBtn, fontWeight: 600 }}
        >{saving ? 'Saving…' : 'Save'}</button>
      </div>
    </div>
  );
}

function CompletionList({ rows }: { rows: CompletionEntry[] }) {
  return (
    <table style={{ borderCollapse: 'collapse', width: '100%' }}>
      <thead>
        <tr><th style={{ ...th, paddingLeft: 0 }}>Task #</th><th style={th}>Type</th><th style={{ ...th, textAlign: 'right' }}>Labor h</th><th style={{ ...th, textAlign: 'right' }}>First seen</th></tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={`${r.task_no}-${i}`}>
            <td style={{ ...td, paddingLeft: 0, fontFamily: MONO, fontSize: 12 }}>{r.task_no}</td>
            <td style={{ ...td, fontSize: 12 }}>{r.pm_type ?? '—'}</td>
            <td style={{ ...td, textAlign: 'right', fontFamily: MONO, fontSize: 12 }}>{r.labor_hours ?? '—'}</td>
            <td style={{ ...td, textAlign: 'right', fontFamily: MONO, fontSize: 12, color: C.mute }}>{new Date(r.first_seen_at).toLocaleDateString()}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Locked({ title, body, back, backLabel = '← Back' }: { title: string; body: string; back: string; backLabel?: string }) {
  return (
    <Wrap>
      <div style={{ textAlign: 'center', padding: '64px 24px' }}>
        <h2 style={{ fontSize: 22, fontWeight: 500, marginBottom: 8 }}>{title}</h2>
        <p style={{ color: C.mute }}>{body}</p>
        <Link to={back} style={{ display: 'inline-block', marginTop: 24, textDecoration: 'underline', color: C.ink }}>{backLabel}</Link>
      </div>
    </Wrap>
  );
}

function Wrap({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ minHeight: '100vh', background: C.page, color: C.ink, fontFamily: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif' }}>
      {children}
    </div>
  );
}
