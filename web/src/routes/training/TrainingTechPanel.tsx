import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useUpdateEngineerProfile, DISCIPLINES, type Discipline } from '../../hooks/useEngineers';
import type { TrainingTech } from '../../hooks/useTraining';
import {
  DraftTable, DraftBadge, DraftBody, useLocalDraft, makeRow,
  type DraftColumn, type DraftRow,
} from './draftTable';
import { FACET_HINT, draftKey } from './trainingSections';
import { ProblemAxisLegend } from './ProblemAxisLegend';

// Per-tech panel for the Training view.
//   REAL: a few profile fields edit through the canonical useUpdateEngineerProfile
//   mutation (keys ['engineers'] / ['users_all']), so changes show up in the
//   Admin / Users view. We also invalidate ['training','roster'] so this view's
//   own roster mirror refreshes.
//   DRAFT: skill records — per-problem proficiency (memory / technical /
//   rule-of-thumb level), plus competency / certs / courses / sign-offs — are
//   localStorage-only, keyed by the tech id, until we lock the schema.

// The headline: a tech's proficiency per real-world PROBLEM, scored separately
// for each of the 3 skill axes (memory / technical / rule-of-thumb) so a gap
// points straight at how to coach. (Diagnosis lives under Technical.)
const PROBLEM_PROF_COLS: DraftColumn[] = [
  { key: 'problem', label: 'Problem', width: '26%', placeholder: 'Reset VFD after fault' },
  { key: 'equipment', label: 'Where', width: '17%', placeholder: 'Bldg 75 · CH-2' },
  { key: 'mem', label: 'Memory', width: '11%', placeholder: '0-4' },
  { key: 'tech', label: 'Technical', width: '11%', placeholder: '0-4' },
  { key: 'rule', label: 'Rule of thumb', width: '13%', placeholder: '0-4' },
  { key: 'last', label: 'Last', width: '11%' },
  { key: 'times', label: 'Times', width: '10%', placeholder: '#' },
];

const seedProblemProf = (): DraftRow[] => [
  makeRow({ problem: 'e.g. Reset VFD after fault', equipment: 'Bldg 75 · CH-2', mem: '3', tech: '1', rule: '2', last: '', times: '4' }),
];

const COMPETENCY_COLS: DraftColumn[] = [
  { key: 'equipment', label: 'Equipment', width: '18%' },
  { key: 'task', label: 'Task', width: '18%' },
  { key: 'facet', label: 'Facet', width: '12%', placeholder: FACET_HINT },
  { key: 'level', label: 'Level', width: '14%', placeholder: '0-4 trainee→trainer' },
  { key: 'times', label: 'Times', width: '9%', placeholder: '# done' },
  { key: 'last', label: 'Last done', width: '15%' },
  { key: 'by', label: 'By', width: '14%', placeholder: 'assessor' },
];

const CERT_COLS: DraftColumn[] = [
  { key: 'cert', label: 'Certification', width: '32%', placeholder: 'EPA 608, NFPA 70E…' },
  { key: 'issued', label: 'Issued', width: '18%' },
  { key: 'expires', label: 'Expires', width: '18%' },
  { key: 'number', label: 'Cert #', width: '18%' },
  { key: 'doc', label: 'Doc', width: '14%' },
];

const COURSE_COLS: DraftColumn[] = [
  { key: 'course', label: 'Course', width: '34%' },
  { key: 'type', label: 'Type', width: '16%', placeholder: 'classroom/lab/online' },
  { key: 'completed', label: 'Completed', width: '18%' },
  { key: 'score', label: 'Score', width: '14%' },
  { key: 'by', label: 'Instructor', width: '18%' },
];

const SIGNOFF_COLS: DraftColumn[] = [
  { key: 'sop', label: 'SOP / task', width: '40%' },
  { key: 'signedBy', label: 'Signed off by', width: '30%' },
  { key: 'date', label: 'Date', width: '30%' },
];

type SkillTab = 'problems' | 'competency' | 'certs' | 'courses' | 'signoffs';
const SKILL_TABS: { key: SkillTab; label: string }[] = [
  { key: 'problems', label: 'Problem proficiency' },
  { key: 'competency', label: 'Competency' },
  { key: 'certs', label: 'Certifications' },
  { key: 'courses', label: 'Courses' },
  { key: 'signoffs', label: 'SOP sign-offs' },
];

export function TrainingTechPanel({ tech }: { tech: TrainingTech }) {
  const qc = useQueryClient();
  const updateProfile = useUpdateEngineerProfile();

  // Local profile state — initialized from the roster row, saved on blur/change.
  const [title, setTitle] = useState(tech.title ?? '');
  const [discipline, setDiscipline] = useState<Discipline | ''>((tech.discipline as Discipline) ?? '');
  const [level, setLevel] = useState(String(tech.level ?? 1));

  const [tab, setTab] = useState<SkillTab>('problems');

  const [problems, setProblems] = useLocalDraft(draftKey.techProblems(tech.user_id), seedProblemProf);
  const [competency, setCompetency] = useLocalDraft(draftKey.techCompetency(tech.user_id), () => []);
  const [certs, setCerts] = useLocalDraft(draftKey.techCerts(tech.user_id), () => []);
  const [courses, setCourses] = useLocalDraft(draftKey.techCourses(tech.user_id), () => []);
  const [signoffs, setSignoffs] = useLocalDraft(draftKey.techSignoffs(tech.user_id), () => []);

  async function saveProfile(patch: { title?: string; discipline?: Discipline | null; level?: number }) {
    try {
      await updateProfile.mutateAsync({ user_id: tech.user_id, patch });
      qc.invalidateQueries({ queryKey: ['training', 'roster'] });
    } catch (e) {
      console.error('Profile save failed', e);
    }
  }

  return (
    <div>
      {/* REAL profile fields — edits sync to the Admin / Users view. */}
      <div
        className="flex items-end gap-3 flex-wrap"
        style={{ marginBottom: 12, paddingBottom: 12, borderBottom: '1px solid var(--color-border-soft)' }}
      >
        <Field label="Title">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => { if (title !== (tech.title ?? '')) saveProfile({ title }); }}
            className="t-text" style={inputStyle} placeholder="Building Engineer"
          />
        </Field>
        <Field label="Discipline">
          <select
            value={discipline}
            onChange={(e) => {
              const v = (e.target.value || '') as Discipline | '';
              setDiscipline(v);
              saveProfile({ discipline: v === '' ? null : v });
            }}
            className="t-text" style={inputStyle}
          >
            <option value="">—</option>
            {DISCIPLINES.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
          </select>
        </Field>
        <Field label="Level">
          <input
            type="number" min={1} max={10}
            value={level}
            onChange={(e) => setLevel(e.target.value)}
            onBlur={() => {
              const n = parseInt(level, 10);
              if (!Number.isNaN(n) && n !== tech.level) saveProfile({ level: n });
            }}
            className="t-text" style={{ ...inputStyle, width: 64 }}
          />
        </Field>
        <span className="t-small t-muted" style={{ minHeight: 16 }}>
          {updateProfile.isPending ? 'Saving…'
            : updateProfile.isError ? <span style={{ color: 'var(--color-danger)' }}>Save failed — check permissions.</span>
            : 'Edits sync to Admin'}
        </span>
      </div>

      {/* DRAFT skill records */}
      <div className="flex items-center gap-2 flex-wrap" style={{ marginBottom: 10 }}>
        {SKILL_TABS.map((t) => {
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className="t-small"
              style={{
                padding: '4px 10px', borderRadius: 3, border: '1px solid',
                borderColor: active ? 'var(--color-accent)' : 'transparent',
                background: active ? 'rgba(99,102,241,0.06)' : 'transparent',
                color: active ? 'var(--color-text)' : 'var(--color-text-muted)',
                cursor: 'pointer', font: 'inherit', fontWeight: active ? 600 : 400,
              }}
            >
              {t.label}
            </button>
          );
        })}
        <DraftBadge />
      </div>

      {tab === 'problems' && (
        <DraftBody intro="How well this tech handles each real-world problem — scored 0-4 for memory, technical, and rule-of-thumb. A low score points to how to coach: drill the SOP, hands-on with a lead, or shadow them on a no-disruption job.">
          <ProblemAxisLegend />
          <DraftTable columns={PROBLEM_PROF_COLS} rows={problems} onChange={setProblems} addLabel="Add problem proficiency" />
        </DraftBody>
      )}
      {tab === 'competency' && (
        <DraftBody intro="Routine-work competency: tech × equipment × task × facet → level + times performed.">
          <DraftTable columns={COMPETENCY_COLS} rows={competency} onChange={setCompetency} addLabel="Add competency row" />
        </DraftBody>
      )}
      {tab === 'certs' && (
        <DraftBody intro="Certifications with issue / expiry dates.">
          <DraftTable columns={CERT_COLS} rows={certs} onChange={setCerts} addLabel="Add certification" />
        </DraftBody>
      )}
      {tab === 'courses' && (
        <DraftBody intro="Completed classroom / lab / online training.">
          <DraftTable columns={COURSE_COLS} rows={courses} onChange={setCourses} addLabel="Add course" />
        </DraftBody>
      )}
      {tab === 'signoffs' && (
        <DraftBody intro="Who is signed off to perform which SOP / task.">
          <DraftTable columns={SIGNOFF_COLS} rows={signoffs} onChange={setSignoffs} addLabel="Add sign-off" />
        </DraftBody>
      )}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  padding: '4px 8px', borderRadius: 4,
  border: '1px solid var(--color-border)', background: 'var(--color-card)',
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="t-small t-muted uppercase tracking-wider" style={{ fontSize: '0.6rem' }}>{label}</span>
      {children}
    </label>
  );
}
