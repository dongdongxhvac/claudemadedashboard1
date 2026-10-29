// Binney St — the weekly "Weekend Plans" hand-out, on screen and editable.
// One weekend_plans row per Saturday (0154). Shows the plan for the coming
// weekend when it exists, else the latest published one with a note; any
// past weekend can be picked from the dropdown. Managers add / edit / delete.
import { useMemo, useState } from 'react';
import { localISODate, addDays } from '../../lib/dashboard';
import {
  type GroupCode, type RoundsRotation, type WeekendPlan, type PlanItem, type WeekendRounds, type Cluster,
  CLUSTER_STYLE, inputStyle, saturdayOnOrAfter, splitNames, shortName, fmtIsoMd, parsePlanItems, planItemsToText, resolveName, uniqueShortName,
} from '../../lib/binneyRounds';
import { useWeekendPlans, useUpsertWeekendPlan, useDeleteWeekendPlan, type WeekendPlanInput } from './hooks/useBinneyOps';
import { ClusterBadge } from './ClusterBadge';
import type { ClusterIndex, ClusterPerson } from './hooks/useBinneyClusterIndex';
import { SmallBtn, EngineerSelect } from './BinneyUi';
import { buildWeekendPlanPrintHtml, openPrintHtml } from '../../lib/binneyPrint';

const DEFAULT_GROUPS: { code: GroupCode; label: string; cluster: Cluster }[] = [
  { code: 'E1', label: 'Cluster E1', cluster: 'east' },
  { code: 'E2', label: 'Cluster E2', cluster: 'east' },
  { code: 'EBMS', label: 'East BMS', cluster: 'east' },
  { code: 'W1', label: 'Cluster W1', cluster: 'west' },
  { code: 'W2', label: 'Cluster W2', cluster: 'west' },
  { code: 'WBMS', label: 'West BMS', cluster: 'west' },
];

function ItemList({ items, bullet = true }: { items: PlanItem[] | null | undefined; bullet?: boolean }) {
  if (!items || items.length === 0) return <p className="t-small t-muted italic">—</p>;
  return (
    <ul className={`${bullet ? 'list-disc pl-4' : 'list-none pl-0'} m-0 space-y-0.5`}>
      {items.map((it, i) => {
        const alert = it.level === 'alert' || it.level === 'warning';
        return (
          <li key={i} className="t-small" style={{ color: alert ? '#b91c1c' : 'var(--color-text)', fontWeight: it.level === 'warning' ? 700 : 400 }}>
            {it.text}
          </li>
        );
      })}
    </ul>
  );
}

function emptyPlan(weekendStart: string, template?: WeekendPlan | null): WeekendPlanInput {
  return {
    weekend_start: weekendStart,
    manager_on_call: template?.manager_on_call ?? '',
    notes: [],
    rounds: template?.rounds ? JSON.parse(JSON.stringify(template.rounds)) as WeekendRounds : {},
    saturday_items: [],
    sunday_items: [],
    reminders: template?.reminders ? JSON.parse(JSON.stringify(template.reminders)) as PlanItem[] : [],
  };
}

export function BinneyWeekendPlanBlock({
  idx, rot, canEdit, now,
}: {
  idx: ClusterIndex; rot: RoundsRotation | null; canEdit: boolean; now: Date;
}) {
  const plansQ = useWeekendPlans();
  const upsert = useUpsertWeekendPlan();
  const del = useDeleteWeekendPlan();
  const plans = useMemo(() => plansQ.data ?? [], [plansQ.data]);
  const groups = rot?.groups ?? DEFAULT_GROUPS;

  const comingSat = localISODate(saturdayOnOrAfter(now));
  const [picked, setPicked] = useState<string | null>(null);
  const shownIso = picked ?? (plans.some((p) => p.weekend_start === comingSat) ? comingSat : plans[0]?.weekend_start ?? null);
  const plan = plans.find((p) => p.weekend_start === shownIso) ?? null;
  const comingMissing = !plans.some((p) => p.weekend_start === comingSat);
  // "Ed" on the sheet → Edward Nardone: resolve against managers only.
  const managers = idx.people.filter((p) => p.role === 'manager');
  const managerLabel = (v: string | null | undefined) => (v ? resolveName(v, managers)?.full_name ?? v : '—');
  // Printable hand-out (portrait), laid out like the paper one.
  const engineerNames = idx.people.filter((p) => p.role === 'engineer').map((p) => p.full_name);
  const printLabel = (token: string, crew?: 'saturday' | 'sunday') => {
    const p = idx.resolve(token, crew);
    return p ? uniqueShortName(p.full_name, engineerNames) : token;
  };
  const print = () => {
    if (!plan) return;
    openPrintHtml(buildWeekendPlanPrintHtml({ plan, groups, managerLabel: managerLabel(plan.manager_on_call), label: (t) => printLabel(t) }));
  };

  const [editor, setEditor] = useState<{ mode: 'new' | 'edit'; draft: WeekendPlanInput; id?: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const startNew = () => {
    // New plan for the coming Saturday (or the one after if that's published),
    // rounds + reminders copied from the latest plan as a starting point.
    let iso = comingSat;
    if (!comingMissing) iso = localISODate(addDays(new Date(comingSat + 'T00:00:00'), 7));
    setEditor({ mode: 'new', draft: emptyPlan(iso, plans[0] ?? null) });
  };
  const startEdit = () => {
    if (!plan) return;
    setEditor({
      mode: 'edit', id: plan.id,
      draft: {
        weekend_start: plan.weekend_start, manager_on_call: plan.manager_on_call ?? '',
        notes: plan.notes ?? [], rounds: plan.rounds ?? {}, saturday_items: plan.saturday_items ?? [],
        sunday_items: plan.sunday_items ?? [], reminders: plan.reminders ?? [],
      },
    });
  };

  const save = async (draft: WeekendPlanInput, id?: string) => {
    setErr(null);
    try {
      await upsert.mutateAsync({ ...draft, id, manager_on_call: draft.manager_on_call?.trim() || null });
      setPicked(draft.weekend_start);
      setEditor(null);
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  const remove = async () => {
    if (!editor?.id) return;
    if (!window.confirm('Delete this weekend plan?')) return;
    setErr(null);
    try { await del.mutateAsync(editor.id); setPicked(null); setEditor(null); } catch (e) { setErr((e as Error).message); }
  };

  const nameCell = (raw: string | undefined, crew: 'saturday' | 'sunday') => {
    const toks = splitNames(raw);
    if (toks.length === 0) return <span className="t-muted">—</span>;
    return (
      <span className="inline-flex flex-wrap items-center gap-x-1">
        {toks.map((t, i) => {
          const p = idx.resolve(t, crew);
          const info = p ? idx.byUserId.get(p.user_id) : null;
          return (
            <span key={i} className="inline-flex items-center gap-0.5 whitespace-nowrap" title={p?.full_name}>
              {i > 0 && <span className="t-muted">/</span>}
              <span>{p ? shortName(p.full_name) : t}</span>
              <ClusterBadge cluster={info?.cluster} role={info?.role} manager={info?.managerName} size={11} />
            </span>
          );
        })}
      </span>
    );
  };

  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 flex-wrap mb-1">
        <div className="flex items-baseline gap-2 flex-wrap">
          <div className="t-small t-muted uppercase tracking-wider">Weekend plan · manager hand-out</div>
          {plans.length > 1 && (
            <select value={shownIso ?? ''} onChange={(e) => setPicked(e.target.value)}
              className="border rounded px-1 py-0 t-small" style={inputStyle}>
              {plans.map((p) => (
                <option key={p.id} value={p.weekend_start}>
                  {fmtIsoMd(p.weekend_start)} – {fmtIsoMd(localISODate(addDays(new Date(p.weekend_start + 'T00:00:00'), 1)))}
                </option>
              ))}
            </select>
          )}
        </div>
        <div className="flex items-center gap-1">
          {plan && <SmallBtn onClick={print} title="Print this hand-out (portrait)">⎙ Print</SmallBtn>}
          {canEdit && plan && <SmallBtn onClick={startEdit}>Edit</SmallBtn>}
          {canEdit && <SmallBtn onClick={startNew} primary>+ New plan</SmallBtn>}
        </div>
      </div>
      {err && !editor && <p className="t-small t-danger mb-1">{err}</p>}

      {plansQ.isLoading ? (
        <p className="t-small t-muted">Loading…</p>
      ) : !plan ? (
        <p className="t-small t-muted">No weekend plan published yet.{canEdit ? ' Use + New plan.' : ''}</p>
      ) : (
        <div className="rounded p-3" style={{ border: '1px solid var(--color-border)', background: 'var(--color-bg)' }}>
          {comingMissing && plan.weekend_start !== comingSat && (
            <p className="t-small t-warn mb-2" style={{ fontWeight: 600 }}>
              ⏳ No plan yet for {fmtIsoMd(comingSat)} – {fmtIsoMd(localISODate(addDays(new Date(comingSat + 'T00:00:00'), 1)))} · showing the last one.
            </p>
          )}
          <div className="flex items-baseline justify-between gap-2 flex-wrap">
            <h3 className="t-text" style={{ fontWeight: 800, fontSize: 15, textDecoration: 'underline' }}>
              Weekend Plans {fmtIsoMd(plan.weekend_start)} – {fmtIsoMd(localISODate(addDays(new Date(plan.weekend_start + 'T00:00:00'), 1)))}
            </h3>
            <span className="t-small t-text">Manager on call — <b>{managerLabel(plan.manager_on_call)}</b></span>
          </div>

          <div className="mt-2"><ItemList items={plan.notes} /></div>

          <table className="w-full border-collapse mt-3" style={{ fontSize: 11 }}>
            <thead>
              <tr>
                <th className="text-left py-0.5 pr-1" style={{ width: 64 }}></th>
                {groups.map((g) => (
                  <th key={g.code} className="text-left py-0.5 px-1" style={{ background: `${CLUSTER_STYLE[g.cluster].bg}99`, color: CLUSTER_STYLE[g.cluster].fg, fontWeight: 700 }}>{g.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(['saturday', 'sunday'] as const).map((day) => (
                <tr key={day} style={{ borderBottom: '1px solid var(--color-border-soft)' }}>
                  <td className="py-1 pr-1 t-text" style={{ fontWeight: 600 }}>{day === 'saturday' ? 'Saturday' : 'Sunday'}</td>
                  {groups.map((g) => (
                    <td key={g.code} className="py-1 px-1 t-text">{nameCell(plan.rounds?.[day]?.[g.code], day)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>

          <div className="grid gap-3 mt-3" style={{ gridTemplateColumns: '1fr 1fr' }}>
            <div>
              <div className="t-small t-text" style={{ fontWeight: 700, textDecoration: 'underline' }}>Saturday</div>
              <ItemList items={plan.saturday_items} />
            </div>
            <div>
              <div className="t-small t-text" style={{ fontWeight: 700, textDecoration: 'underline' }}>Sunday</div>
              <ItemList items={plan.sunday_items} />
            </div>
          </div>

          {plan.reminders?.length > 0 && (
            <div className="mt-3 pt-2" style={{ borderTop: '1px dashed var(--color-border)' }}>
              <ItemList items={plan.reminders} bullet={false} />
            </div>
          )}
          <p className="t-small t-muted mt-2" style={{ fontSize: 10 }}>
            updated {new Date(plan.updated_at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
          </p>
        </div>
      )}

      {editor && (
        <WeekendPlanEditor
          mode={editor.mode}
          draft={editor.draft}
          groups={groups}
          people={idx.people}
          saving={upsert.isPending || del.isPending}
          error={err}
          onChange={(d) => setEditor({ ...editor, draft: d })}
          onCancel={() => { setEditor(null); setErr(null); }}
          onSave={() => void save(editor.draft, editor.id)}
          onDelete={editor.mode === 'edit' ? () => void remove() : undefined}
        />
      )}
    </div>
  );
}

function WeekendPlanEditor({
  mode, draft, groups, people, saving, error, onChange, onCancel, onSave, onDelete,
}: {
  mode: 'new' | 'edit';
  draft: WeekendPlanInput;
  groups: { code: GroupCode; label: string; cluster: Cluster }[];
  /** Active Binney people (engineers + managers) for the pickers. */
  people: ClusterPerson[];
  saving: boolean;
  error: string | null;
  onChange: (d: WeekendPlanInput) => void;
  onCancel: () => void;
  onSave: () => void;
  onDelete?: () => void;
}) {
  // Text areas keep their own string state so typing never fights the parser.
  const [notesText, setNotesText] = useState(planItemsToText(draft.notes));
  const [satText, setSatText] = useState(planItemsToText(draft.saturday_items));
  const [sunText, setSunText] = useState(planItemsToText(draft.sunday_items));
  const [remText, setRemText] = useState(planItemsToText(draft.reminders));

  const setRound = (day: 'saturday' | 'sunday', g: GroupCode, v: string) => {
    const rounds: WeekendRounds = { ...draft.rounds, [day]: { ...(draft.rounds[day] ?? {}), [g]: v } };
    onChange({ ...draft, rounds });
  };

  // Pickers. Cells hold names ("Herb/Kyle" from the sheet, full names once
  // picked here); resolve maps either to a person, the day as crew hint.
  const personById = new Map(people.map((p) => [p.user_id, p]));
  const engineers = people.filter((p) => p.role === 'engineer');
  const managers = people.filter((p) => p.role === 'manager');
  const cellPeople = (day: 'saturday' | 'sunday', g: GroupCode): ClusterPerson[] =>
    splitNames(draft.rounds?.[day]?.[g]).map((t) => resolveName(t, engineers, day)).filter((p): p is ClusterPerson => !!p);
  const writeCell = (day: 'saturday' | 'sunday', g: GroupCode, a: ClusterPerson | null, b: ClusterPerson | null) =>
    setRound(day, g, [a?.full_name, b?.full_name].filter(Boolean).join('/'));
  // Cells showing a second slot (+1): those already holding two people, plus any the user opens.
  const [extra, setExtra] = useState<Set<string>>(() => {
    const s = new Set<string>();
    for (const day of ['saturday', 'sunday'] as const) for (const g of groups) if (splitNames(draft.rounds?.[day]?.[g.code]).length > 1) s.add(`${day}:${g.code}`);
    return s;
  });
  const mgr = draft.manager_on_call ? resolveName(draft.manager_on_call, managers) : null;

  const sunIso = localISODate(addDays(new Date(draft.weekend_start + 'T00:00:00'), 1));
  const ta = 'w-full border rounded px-2 py-1 t-small t-text';

  return (
    <div className="fixed inset-0 z-50 flex justify-end" style={{ background: 'rgba(0,0,0,0.4)' }} onClick={onCancel}>
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => { e.preventDefault(); onSave(); }}
        className="w-full max-w-2xl h-full overflow-y-auto p-6"
        style={{ background: 'var(--color-card)' }}
      >
        <div className="flex items-baseline justify-between mb-4">
          <h3 className="t-section-title">{mode === 'new' ? 'New weekend plan' : 'Edit weekend plan'}</h3>
          <button type="button" onClick={onCancel} className="t-small t-muted hover:underline">Close</button>
        </div>

        <div className="flex gap-3 mb-3">
          <label className="block">
            <span className="t-small t-muted uppercase tracking-wider block mb-1">Saturday</span>
            <input type="date" value={draft.weekend_start} disabled={mode === 'edit'}
              onChange={(e) => {
                // Snap to the Saturday of the picked date's week.
                const d = new Date(e.target.value + 'T00:00:00');
                if (Number.isNaN(d.getTime())) return;
                onChange({ ...draft, weekend_start: localISODate(saturdayOnOrAfter(d)) });
              }}
              className="border rounded px-2 py-1 t-text" style={inputStyle} />
            <span className="t-small t-muted block mt-0.5">through Sun {fmtIsoMd(sunIso)}</span>
          </label>
          <label className="block flex-1">
            <span className="t-small t-muted uppercase tracking-wider block mb-1">Manager on call</span>
            <EngineerSelect value={mgr?.user_id ?? ''} people={people} role="manager" showCrew={false} placeholder="— pick a manager —"
              onChange={(id) => onChange({ ...draft, manager_on_call: personById.get(id)?.full_name ?? '' })} />
            {draft.manager_on_call && !mgr && (
              <span className="t-small t-muted block mt-0.5">Sheet says "{draft.manager_on_call}" — pick the manager above to replace it.</span>
            )}
          </label>
        </div>

        <label className="block mb-3">
          <span className="t-small t-muted uppercase tracking-wider block mb-1">Notes · one per line · start a line with ! for red</span>
          <textarea rows={5} value={notesText} className={ta} style={inputStyle}
            onChange={(e) => { setNotesText(e.target.value); onChange({ ...draft, notes: parsePlanItems(e.target.value) }); }} />
        </label>

        <div className="mb-3">
          <span className="t-small t-muted uppercase tracking-wider block mb-1">Rounds</span>
          <table className="w-full border-collapse" style={{ fontSize: 11 }}>
            <thead>
              <tr>
                <th style={{ width: 64 }}></th>
                {groups.map((g) => (
                  <th key={g.code} className="text-left py-0.5 px-1" style={{ background: `${CLUSTER_STYLE[g.cluster].bg}99`, color: CLUSTER_STYLE[g.cluster].fg, fontWeight: 700 }}>{g.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(['saturday', 'sunday'] as const).map((day) => (
                <tr key={day}>
                  <td className="py-1 pr-1 t-text" style={{ fontWeight: 600 }}>{day === 'saturday' ? 'Sat' : 'Sun'}</td>
                  {groups.map((g) => {
                    const ps = cellPeople(day, g.code);
                    const key = `${day}:${g.code}`;
                    const two = extra.has(key) || ps.length > 1;
                    return (
                      <td key={g.code} className="py-1 px-0.5 align-top">
                        <span className="flex flex-col gap-0.5">
                          <EngineerSelect value={ps[0]?.user_id ?? ''} people={people}
                            onChange={(id) => writeCell(day, g.code, personById.get(id) ?? null, ps[1] ?? null)} />
                          {two ? (
                            <EngineerSelect value={ps[1]?.user_id ?? ''} people={people} placeholder="— +1 —"
                              onChange={(id) => writeCell(day, g.code, ps[0] ?? null, personById.get(id) ?? null)} />
                          ) : (
                            <button type="button" onClick={() => setExtra((s) => new Set(s).add(key))}
                              className="t-small t-accent text-left hover:underline" style={{ fontSize: 10, lineHeight: 1.2 }}>+1</button>
                          )}
                        </span>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="t-small t-muted mt-0.5">+1 adds a second person on a round, e.g. a trainee shadowing.</p>
        </div>

        <div className="grid gap-3 mb-3" style={{ gridTemplateColumns: '1fr 1fr' }}>
          <label className="block">
            <span className="t-small t-muted uppercase tracking-wider block mb-1">Saturday · one per line</span>
            <textarea rows={4} value={satText} className={ta} style={inputStyle}
              onChange={(e) => { setSatText(e.target.value); onChange({ ...draft, saturday_items: parsePlanItems(e.target.value) }); }} />
          </label>
          <label className="block">
            <span className="t-small t-muted uppercase tracking-wider block mb-1">Sunday · one per line</span>
            <textarea rows={4} value={sunText} className={ta} style={inputStyle}
              onChange={(e) => { setSunText(e.target.value); onChange({ ...draft, sunday_items: parsePlanItems(e.target.value) }); }} />
          </label>
        </div>

        <label className="block mb-4">
          <span className="t-small t-muted uppercase tracking-wider block mb-1">Reminders · one per line · ! red · !! WARNING</span>
          <textarea rows={5} value={remText} className={ta} style={inputStyle}
            onChange={(e) => { setRemText(e.target.value); onChange({ ...draft, reminders: parsePlanItems(e.target.value) }); }} />
        </label>

        {error && <p className="t-small t-danger mb-2">{error}</p>}

        <div className="flex items-center justify-between gap-2">
          <div>
            {onDelete && <SmallBtn onClick={onDelete} disabled={saving} danger>Delete plan</SmallBtn>}
          </div>
          <div className="flex items-center gap-2">
            <SmallBtn onClick={onCancel} disabled={saving}>Cancel</SmallBtn>
            <button type="submit" disabled={saving} className="t-small px-3 py-1 rounded border font-medium text-white disabled:opacity-50"
              style={{ background: 'var(--color-accent)', borderColor: 'var(--color-accent)' }}>
              {saving ? 'Saving…' : mode === 'new' ? 'Publish plan' : 'Save changes'}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
