// Building set-up sheet + one engineer's system sign-offs for that building.
//
// Left: the reference — composed from the Buildings KB that already exists
// (equipment by category + the Mechanical / Overview section notes + any
// equipment that isn't operational as "known conditions"). Nothing new to
// maintain: leads keep the KB, this reads it.
// Right: the eight systems, each a knowledge work_record for this building
// (task = system label). ■ verified · ▣ recorded, waiting for a lead ·
// □ open. The engineer signs off a system themselves after explaining it in
// the office (hand drawing presented); a lead verifies.
//
// Used tucked away under the profile's Buildings grid (click a column head)
// and as the engineer's own "Buildings" tab (/engineer/buildings).
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  useBuildingEquipment, useBuildingSections,
  EQUIPMENT_CATEGORIES, EQUIPMENT_CATEGORY_LABELS, EQUIPMENT_STATUS_LABELS,
  type BuildingEquipment, type EffectiveEquipmentStatus,
} from '../../hooks/useBuildingKb';
import {
  useWorkRecords, useUpsertWorkRecord, useVerifyWorkRecord,
  BUILDING_SYSTEMS, systemSignoffs, type WorkRecord,
} from '../../hooks/useWorkRecords';

import { SHEET } from './sheetTheme';
const MONO = 'ui-monospace, SFMono-Regular, Menlo, monospace';

function fmtShort(iso: string): string {
  return new Date(iso.length === 10 ? iso + 'T00:00:00' : iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function BuildingSheet({
  buildingId, buildingLabel, buildingName, userId, isSelf, canVerify, onClose, kbHref,
}: {
  buildingId: string;
  buildingLabel: string;
  buildingName?: string | null;
  userId: string;
  /** The viewer IS this engineer → can sign off (self-recorded). */
  isSelf: boolean;
  /** Lead / manager → can verify pending sign-offs or mark a system verified directly. */
  canVerify: boolean;
  onClose?: () => void;
  /** Link to the full KB page for this building, if the viewer may open it. */
  kbHref?: string | null;
}) {
  const eqQ = useBuildingEquipment(buildingId);
  const secQ = useBuildingSections(buildingId);
  const recQ = useWorkRecords(userId);
  const upsert = useUpsertWorkRecord();
  const verify = useVerifyWorkRecord();
  const [err, setErr] = useState<string | null>(null);

  const equipment = eqQ.data ?? [];
  const byCat = useMemo(() => {
    const m = new Map<string, BuildingEquipment[]>();
    for (const e of equipment) {
      if (e.parent_equipment_id) continue;           // top-level only
      const k = e.category ?? 'other';
      m.set(k, [...(m.get(k) ?? []), e]);
    }
    return m;
  }, [equipment]);
  const known = useMemo(() => equipment.filter((e) => {
    const st = (e as BuildingEquipment & { status?: EffectiveEquipmentStatus }).status;
    return st && st !== 'operational' && st !== 'standby_auto';
  }), [equipment]);
  const note = (k: string) => secQ.data?.find((s) => s.section_key === k)?.body?.trim() || null;
  const mech = note('mechanical');
  const overview = note('overview');

  const signs = systemSignoffs(recQ.data ?? [], buildingId);
  const verified = BUILDING_SYSTEMS.filter((s) => signs.get(s)?.status === 'verified').length;
  const pending = BUILDING_SYSTEMS.filter((s) => signs.get(s)?.status === 'self').length;

  const signOff = async (system: string, asVerified: boolean) => {
    setErr(null);
    try {
      await upsert.mutateAsync({
        user_id: userId, occurred_on: new Date().toLocaleDateString('en-CA'), building_id: buildingId,
        kind: 'knowledge', task: system, independence: null,
        note: asVerified ? null : 'Explained in the office (hand drawing presented).', verifyNow: asVerified,
      });
    } catch (e) { setErr((e as Error).message); }
  };
  const doVerify = async (r: WorkRecord) => {
    setErr(null);
    try { await verify.mutateAsync({ id: r.id, user_id: r.user_id, verified: true }); }
    catch (e) { setErr((e as Error).message); }
  };

  const cell: React.CSSProperties = { fontSize: 12.5 };
  const dt: React.CSSProperties = { color: SHEET.mute, textTransform: 'uppercase', fontSize: 10.5, letterSpacing: '0.06em', paddingTop: 2 };

  return (
    <div style={{ border: `1px solid ${SHEET.ink}`, display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(260px, 320px)', background: '#fff', color: SHEET.ink }} className="bsheet">
      <style>{`@media (max-width: 760px){ .bsheet{ grid-template-columns: 1fr !important; } .bsheet .bsheet-r{ border-left: 0 !important; border-top: 1px solid ${SHEET.line}; } }`}</style>
      <div style={{ padding: '12px 16px', minWidth: 0 }}>
        <h4 style={{ margin: '0 0 8px', fontSize: 13, fontWeight: 600, display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
          <span>Building set-up sheet · {buildingLabel}{buildingName ? ` · ${buildingName}` : ''}</span>
          <span style={{ fontWeight: 400, color: SHEET.mute, fontSize: 12 }}>
            from the Buildings KB
            {kbHref && <> · <Link to={kbHref} style={{ color: SHEET.ink }}>open KB</Link></>}
            {onClose && <> · <button onClick={onClose} style={{ background: 'none', border: 0, padding: 0, color: SHEET.ink, textDecoration: 'underline', cursor: 'pointer', fontSize: 12 }}>close</button></>}
          </span>
        </h4>
        {eqQ.isLoading ? <p style={{ ...cell, color: SHEET.mute }}>Loading…</p> : (
          <>
            {byCat.size === 0 && !mech && !overview && (
              <p style={{ ...cell, color: SHEET.mute, margin: 0 }}>Nothing in the KB for this building yet — a lead adds equipment and the Mechanical note under Buildings.</p>
            )}
            <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: 'minmax(110px, 140px) 1fr', gap: '5px 12px', ...cell }}>
              {EQUIPMENT_CATEGORIES.filter((c) => byCat.has(c)).map((c) => {
                const list = byCat.get(c)!;
                return (
                  <Fragment2 key={c}>
                    <dt style={dt}>{EQUIPMENT_CATEGORY_LABELS[c]}</dt>
                    <dd style={{ margin: 0 }}>
                      <b style={{ fontWeight: 600 }}>{list.length}</b> · {list.map((e) => e.short_name ?? e.full_name).join(', ')}
                    </dd>
                  </Fragment2>
                );
              })}
              {byCat.has('other') && (
                <Fragment2>
                  <dt style={dt}>Other</dt>
                  <dd style={{ margin: 0 }}>{byCat.get('other')!.map((e) => e.short_name ?? e.full_name).join(', ')}</dd>
                </Fragment2>
              )}
              {mech && (<Fragment2><dt style={dt}>Mechanical</dt><dd style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{mech}</dd></Fragment2>)}
              {!mech && overview && (<Fragment2><dt style={dt}>Overview</dt><dd style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{overview}</dd></Fragment2>)}
            </dl>
            {known.length > 0 && (
              <div style={{ borderLeft: `3px solid ${SHEET.warn}`, padding: '4px 8px', background: '#fbf3d6', marginTop: 10, fontSize: 12 }}>
                <b>Known conditions</b> · {known.map((e) => {
                  const st = (e as BuildingEquipment & { status?: EffectiveEquipmentStatus }).status!;
                  return `${e.short_name ?? e.full_name}: ${EQUIPMENT_STATUS_LABELS[st] ?? st}${e.common_issues ? ` — ${e.common_issues}` : ''}`;
                }).join(' · ')}
              </div>
            )}
          </>
        )}
      </div>

      <div className="bsheet-r" style={{ borderLeft: `1px solid ${SHEET.line}`, padding: '12px 16px', background: SHEET.band }}>
        <h4 style={{ margin: '0 0 8px', fontSize: 13, fontWeight: 600, display: 'flex', justifyContent: 'space-between', gap: 10 }}>
          <span>{isSelf ? 'My' : ''} {buildingLabel} sign-offs</span>
          <span style={{ fontWeight: 400, color: SHEET.mute, fontSize: 12, fontFamily: MONO }}>{verified} of {BUILDING_SYSTEMS.length}{pending ? ` · ${pending} pending` : ''}</span>
        </h4>
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, fontSize: 12.5 }}>
          {BUILDING_SYSTEMS.map((sys) => {
            const r = signs.get(sys) ?? null;
            const st = r?.status ?? null;
            return (
              <li key={sys} style={{ display: 'grid', gridTemplateColumns: '14px 1fr auto', gap: 8, padding: '5px 0', borderBottom: `1px solid ${SHEET.line}`, alignItems: 'center' }}>
                <span style={{ width: 11, height: 11, border: `1.5px solid ${SHEET.ink}`, display: 'block', background: st === 'verified' ? SHEET.ink : st === 'self' ? `repeating-linear-gradient(45deg, ${SHEET.ink} 0 2px, #fff 2px 4px)` : '#fff' }} title={st === 'verified' ? 'Verified' : st === 'self' ? 'Recorded, waiting for a lead' : 'Open'} />
                <span>{sys}</span>
                <span style={{ fontSize: 11, color: SHEET.mute, whiteSpace: 'nowrap', display: 'inline-flex', gap: 8, alignItems: 'center' }}>
                  {st === 'verified' && r && <span style={{ color: SHEET.ok }}>{fmtShort(r.verified_at ?? r.occurred_on)}{r.verified_by_name ? ` · ${r.verified_by_name}` : ''}</span>}
                  {st === 'self' && r && <span style={{ color: SHEET.warn }}>{fmtShort(r.occurred_on)} · pending</span>}
                  {st === null && <span>open</span>}
                  {st === 'self' && r && canVerify && (
                    <button onClick={() => doVerify(r)} disabled={verify.isPending} style={btn(SHEET.ok)}>Verify</button>
                  )}
                  {st === null && isSelf && (
                    <button onClick={() => signOff(sys, false)} disabled={upsert.isPending} style={btn(SHEET.ink)}>Sign off</button>
                  )}
                  {st === null && !isSelf && canVerify && (
                    <button onClick={() => signOff(sys, true)} disabled={upsert.isPending} style={btn(SHEET.ok)}>Mark verified</button>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
        {err && <p style={{ color: '#b91c1c', fontSize: 12, margin: '8px 0 0' }}>{err}</p>}
        <p style={{ fontSize: 11.5, color: SHEET.mute, margin: '8px 0 0' }}>
          {isSelf
            ? 'Sign off a system after you explained it in the office — hand drawing presented to a lead. A lead then verifies it.'
            : 'The engineer signs off after explaining the system in the office; verify here once you have heard it.'}
        </p>
      </div>
    </div>
  );
}

function btn(color: string): React.CSSProperties {
  return { background: 'none', border: `1px solid ${color}`, color, borderRadius: 2, padding: '1px 7px', fontSize: 11, fontWeight: 600, cursor: 'pointer' };
}

/** React.Fragment with a key, without importing Fragment under a name that
 *  collides with the JSX shorthand in this file. */
function Fragment2({ children }: { children: React.ReactNode }) { return <>{children}</>; }
