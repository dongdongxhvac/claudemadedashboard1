// TrackerMatrix — the admin's whole-crew view, "inline list" layout (user
// 2026-10-09, picked from the mockups): plain text, no colored boxes. One
// block per engineer: name on the left, then ONE LINE PER CATEGORY (log,
// professional, each skill group) with the category name in a label column
// and its items written out with their choices, wrapping within the line.
//   log       — the six kind counts + helped / straight (read-only here)
//   traits    — 1 2 3 4, the picked one bold + underlined; click again clears
//   skills    — – L D V (not started / learning / done / verified)
// Notes, SOP write-ups and the dated log live on the per-person panel,
// which a click on the engineer's name opens.
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

const STATUS_LETTER: Record<SkillStatus, string> = { not_started: '–', learning: 'L', done: 'D', verified: 'V' };

/** Short labels for the inline list (the full text is the tooltip). */
const TRAIT_SHORT: Record<string, string> = {
  learning: 'Learning', follow_direction: 'Direction', reliable: 'Reliable', communication: 'Communication',
  responsibility: 'Responsibility', skills: 'Skills', experience: 'Experience', knowledge: 'Knowledge',
};
const SKILL_SHORT: Record<string, string> = {
  tr_hvac: 'HVAC', tr_electrical: 'Electrical', tr_bms: 'BMS', tr_plumbing: 'Plumbing', tr_life_safety: 'Life safety',
  tr_ahu: 'AHU', tr_chiller_plant: 'Chiller plant', tr_boiler_plant: 'Boiler plant', tr_cooling_tower: 'Cooling tower',
  tr_new_hire_8wk: 'New-hire 8-week', tr_hvac_license_dev: 'Licensed HVAC program',
  actuator_replacement: 'Actuator', contactor_replacement: 'Contactor', tstat_replacement: 'T-stat',
  read_electrical_diagram: 'Read electrical diagram', name_components: 'Name components', find_component: 'Find a component',
  as_built_reading: 'As-built reading', pace_out: 'Pace-out', loto: 'LOTO',
  belt_tension_sop: 'Belt tension', sheave_alignment_sop: 'Sheave alignment',
  alignment_lab_rough: 'Pump & motor alignment rough', alignment_lab_precise: 'Pump & motor alignment precise',
  refrigeration_cycle_sop: 'Refrigeration cycle', backflow_rebuild: 'Backflow rebuild', motor_rebuild: 'Motor rebuild', pump_rebuild: 'Pump rebuild',
  control_lab: 'Control lab', start_sequence_lab: 'Start sequence lab', bms_network_lab: 'BMS network lab',
  building_knowledge_lab: 'Building knowledge lab',
  cooling_tower_cleaning: 'Cooling tower cleaning', chiller_open_close: 'Chiller open/close', boiler_open_close: 'Boiler open/close',
  water_treatment: 'Water treatment', generator_test: 'Generator test',
  pm_ahu: 'AHU PM', pm_ahu_freeze_stat: 'AHU PM freeze stat', pm_pump: 'Pump PM', pm_motor: 'Motor PM', pm_cooling_tower: 'Cooling tower PM', pm_boiler: 'Boiler PM', pm_chiller: 'Chiller PM',
  pneumatic_knowledge: 'Pneumatic knowledge', pneumatic_experience: 'Pneumatic experience',
  upkeep_space: 'Space organizing', upkeep_cleaning: 'Cleaning', upkeep_parts_inventory: 'Parts inventory', upkeep_material_inventory: 'Material inventory',
};
const GROUP_SHORT: Record<string, string> = {};

const catLabel: React.CSSProperties = { color: 'var(--color-text-muted)', fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', fontWeight: 600, paddingTop: 3, lineHeight: '16px', minWidth: 0, overflowWrap: 'anywhere' };
const catRow: React.CSSProperties = { display: 'grid', gridTemplateColumns: '150px 1fr', gap: '0 12px', alignItems: 'start', padding: '3px 0' };
const flow: React.CSSProperties = { display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', minWidth: 0, fontSize: 12, lineHeight: '22px', columnGap: 18 };
const itemStyle: React.CSSProperties = { whiteSpace: 'nowrap' };

function Cat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={catRow}>
      <span style={catLabel}>{label}</span>
      <div style={flow}>{children}</div>
    </div>
  );
}

function Choices({ options, picked, onPick, title, disabled }: {
  options: string[]; picked: number; onPick: (i: number) => void; title: string; disabled: boolean;
}) {
  return (
    <span className="t-mono" title={title} style={{ display: 'inline-flex', fontSize: 11.5, marginLeft: 5 }}>
      {options.map((o, i) => {
        const on = i === picked;
        return (
          <button
            key={o}
            type="button"
            disabled={disabled}
            aria-pressed={on}
            onClick={() => onPick(i)}
            style={{
              font: 'inherit', background: 'none', border: 0, padding: '0 3px', lineHeight: '16px',
              color: on ? 'var(--color-text)' : 'var(--color-text-muted)', fontWeight: on ? 700 : 400,
              borderBottom: `2px solid ${on ? 'var(--color-accent)' : 'transparent'}`,
              cursor: disabled ? 'default' : 'pointer',
            }}
          >{o}</button>
        );
      })}
    </span>
  );
}

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

  const rows = useMemo(() => [...engineers].sort((a, b) => a.full_name.localeCompare(b.full_name)), [engineers]);
  const loading = countsQ.isLoading || traitsQ.isLoading || skillsQ.isLoading;
  const err = countsQ.error ?? traitsQ.error ?? skillsQ.error ?? upTrait.error ?? upSkill.error;

  return (
    <div className="t-card" style={{ padding: '0.4rem 0.9rem' }}>
      <div className="flex items-baseline justify-between gap-3 flex-wrap t-small t-muted" style={{ padding: '4px 0 2px' }}>
        <span>{rows.length} engineer{rows.length === 1 ? '' : 's'}{!canEdit && ' · view only'}</span>
        <span className="t-mono" style={{ fontSize: 11 }}>– not started · L learning · D done · V verified · traits 1–4 · click a name for the log, notes and SOPs</span>
      </div>
      {loading && <p className="t-small t-muted">Loading…</p>}
      {err && <p className="t-small t-danger">Error: {(err as Error).message}</p>}
      {!loading && rows.length === 0 && <p className="t-small t-muted italic">No engineers match.</p>}
      {!loading && rows.map((e) => {
        const c = countsQ.data?.get(e.user_id);
        const traits = traitsQ.data?.get(e.user_id);
        const skills = skillsQ.data?.get(e.user_id);
        const done = SKILLS.filter((s) => ['done', 'verified'].includes(skills?.get(s.key)?.status ?? 'not_started')).length;
        const verified = SKILLS.filter((s) => skills?.get(s.key)?.status === 'verified').length;
        return (
          <div key={e.user_id} style={{ padding: '10px 0', borderTop: '1px solid var(--color-border)' }}>
            <div style={{ ...catRow, padding: '0 0 4px' }}>
              <div style={{ minWidth: 0 }}>
                <button onClick={() => onOpen(e)} className="t-accent hover:underline" style={{ font: 'inherit', fontSize: 14, fontWeight: 600, background: 'none', border: 0, padding: 0, textAlign: 'left' }} title="Open the full tracker — log, notes, SOP write-ups">
                  {e.full_name}{e.is_lead ? ' ★' : ''}
                </button>
              </div>
              <div className="t-mono t-muted" style={{ fontSize: 11, lineHeight: '22px' }}>
                {c?.total ?? 0} entries · {done}/{SKILLS.length} skills done · {verified} verified
              </div>
            </div>

            <Cat label="Log">
              {TRACK_KINDS.map((k) => (
                <span key={k} style={itemStyle}>{TRACK_KIND_LABELS[k]}<span className="t-mono" style={{ marginLeft: 4, fontWeight: 600 }}>{c?.byKind[k] ?? 0}</span></span>
              ))}
              <span style={itemStyle}>helped<span className="t-mono" style={{ marginLeft: 4, fontWeight: 600 }}>{c?.help ?? 0}</span> / straight<span className="t-mono" style={{ marginLeft: 4, fontWeight: 600 }}>{c?.straight ?? 0}</span></span>
            </Cat>

            <Cat label="Professional">
              {TRAITS.map((t) => {
                const row = traits?.get(t.key);
                const score = row?.score ?? null;
                return (
                  <span key={t.key} style={itemStyle}>
                    {TRAIT_SHORT[t.key] ?? t.label}
                    <Choices
                      options={['1', '2', '3', '4']}
                      picked={score ? score - 1 : -1}
                      disabled={!canEdit}
                      title={`${t.label} — ${t.hint}${score ? ` · ${SCORE_LABELS[score]}` : ''}${row?.note ? ` — ${row.note}` : ''}`}
                      onPick={(i) => upTrait.mutate({ user_id: e.user_id, trait: t.key, score: score === i + 1 ? null : i + 1, note: row?.note ?? null })}
                    />
                  </span>
                );
              })}
            </Cat>

            {SKILL_GROUPS.map((g) => (
              <Cat key={g} label={GROUP_SHORT[g] ?? g}>
                {SKILLS.filter((s) => s.group === g).map((s) => {
                  const row = skills?.get(s.key);
                  const status: SkillStatus = row?.status ?? 'not_started';
                  return (
                    <span key={s.key} style={itemStyle}>
                      {SKILL_SHORT[s.key] ?? s.label}
                      {s.sop && <span className="t-muted" style={{ fontSize: 9, letterSpacing: '0.06em', marginLeft: 3 }} title={row?.sop_text ? 'SOP written' : 'SOP not written yet'}>SOP{row?.sop_text ? '✓' : ''}</span>}
                      <Choices
                        options={SKILL_STATUSES.map((x) => STATUS_LETTER[x])}
                        picked={SKILL_STATUSES.indexOf(status)}
                        disabled={!canEdit}
                        title={`${s.label}${s.hint ? ` — ${s.hint}` : ''} · ${SKILL_STATUS_LABELS[status]}${row?.done_on ? ` · ${row.done_on}` : ''}${row?.note ? ` — ${row.note}` : ''}`}
                        onPick={(i) => {
                          const next = SKILL_STATUSES[i];
                          upSkill.mutate({
                            user_id: e.user_id, skill: s.key, status: next,
                            done_on: next === 'done' || next === 'verified' ? (row?.done_on ?? today) : (row?.done_on ?? null),
                            sop_text: row?.sop_text ?? null, note: row?.note ?? null,
                          });
                        }}
                      />
                    </span>
                  );
                })}
              </Cat>
            ))}
          </div>
        );
      })}
    </div>
  );
}
