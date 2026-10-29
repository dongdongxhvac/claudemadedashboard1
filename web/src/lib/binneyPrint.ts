// Printable versions of the two Binney manager sheets (user 2026-10-29):
//   * the building-rounds rotation sheet — landscape; Wednesday A/B calendar
//     on the left, Week A / Week B grids, cluster building lists with round
//     points + hours, duties and weekend staffing on the right; stamped with
//     the print date. NO "this week" highlight (user 2026-10-29): the sheet
//     is posted for weeks, so the calendar locates the week by itself —
//     month headers, Sun–Sat span per row, a big A/B letter and a tick box
//     to check off weeks as they pass;
//   * the weekend "hand-out" — portrait, laid out like the paper one (title,
//     manager on call + notes, rounds table, Saturday / Sunday items, red
//     reminders, WARNING).
// Same mechanism as printPmList.ts: a new tab, document.write, print().
import {
  type Cluster, type GroupCode, type RoundsRotation, type WeekLetter, type WeekendPlan, type PlanItem,
  DAY_KEYS, DAY_LABELS, CLUSTER_LABEL, traineesFor, upcomingWednesdays, sundayOf,
} from './binneyRounds';
import { addDays } from './dashboard';

const esc = (s: string | null | undefined) =>
  (s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const monthDay = (d: Date) => d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
const monthYear = (d: Date) => d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
const shortDate = (d: Date) => d.toLocaleDateString(undefined, { month: 'numeric', day: 'numeric', year: '2-digit' });
const stamp = () => new Date().toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

/** Open a tab with the HTML and trigger the print dialog. */
export function openPrintHtml(html: string): void {
  const win = window.open('', '_blank');
  if (!win) {
    alert('Pop-up blocked. Allow pop-ups for this site and try again.');
    return;
  }
  win.document.write(html);
  win.document.close();
  win.focus();
  window.setTimeout(() => { try { win.print(); } catch { /* user closed it */ } }, 350);
}

const BASE_CSS = `
  * { box-sizing: border-box; }
  body { font-family: "Helvetica Neue", Arial, sans-serif; color: #000; margin: 0; padding: 0.35in 0.4in; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  table { border-collapse: collapse; }
  th, td { border: 1px solid #999; padding: 2px 5px; vertical-align: top; }
  .yellow th { background: #fff200; }
  .east { background: #dbeafe; } .west { background: #fef3c7; }
  .muted { color: #555; } .red { color: #c00; } .b { font-weight: 700; }
  .stamp { font-size: 8pt; color: #555; }
  @media print { body { padding: 0.25in 0.3in; } .noprint { display: none; } }
`;

// ── rotation sheet ─────────────────────────────────────────────────────────

export type RotationPrintArgs = {
  rot: RoundsRotation;
  now: Date;
  /** Display label for a sheet token ("Kevin", "Harry", a full name). */
  label: (token: string) => string;
  /** Building codes per rounds group (E1/E2/W1/W2). */
  groupBuildings: Partial<Record<string, string[]>>;
  managers: Partial<Record<Cluster, string | null>>;
  /** Wednesdays to list in the calendar (default 36 ≈ eight months). */
  weeks?: number;
};

export function buildRotationPrintHtml(a: RotationPrintArgs): string {
  const { rot, now, label } = a;
  const weds = upcomingWednesdays(now, a.weeks ?? 36, rot);

  // One row per week, grouped under month headers (the month of the week's
  // Sunday); a tick box per row lets the office check weeks off as they pass.
  let lastMonth = '';
  const calendarRows = weds.map((x) => {
    const sun = sundayOf(x.date);
    const sat = addDays(sun, 6);
    const m = monthYear(sun);
    const head = m !== lastMonth ? `<tr class="month"><td colspan="5">${esc(m)}</td></tr>` : '';
    lastMonth = m;
    return head + `<tr>
      <td class="tick"><span class="box"></span></td>
      <td class="letter">${x.week}</td>
      <td>${esc(monthDay(sun))} – ${esc(monthDay(sat))}</td>
      <td>Wed ${esc(monthDay(x.date))}</td>
      <td>${x.crew === 'saturday' ? 'Sat crew' : 'Sun crew'}</td>
    </tr>`;
  }).join('');

  const groupsFor = (c: Cluster) => rot.groups.filter((g) => g.cluster === c);
  const cellText = (raw: string | undefined) => {
    const v = (raw ?? '').trim();
    if (!v) return '—';
    if (/^floaters?$/i.test(v)) return 'FLOATER';
    return v.split(/\s*[/,&+]\s*|\s+and\s+/i).filter(Boolean).map(label).join('/');
  };
  const weekGrid = (w: WeekLetter) => {
    const trainees = traineesFor(rot, w);
    const hasTrainees = Object.keys(trainees).length > 0;
    return `
      <div class="week">
        <div class="wk-title">WEEK ${w} <span class="muted" style="font-weight:400">· Wednesday round: ${esc(rot.wednesday_rule[w])} crew</span></div>
        <table class="grid">
          <tr><th></th>${(['east', 'west'] as Cluster[]).map((c) => groupsFor(c).map((g) => `<th class="${c} yellowish">${esc(g.label)}</th>`).join('')).join('')}</tr>
          ${DAY_KEYS.map((d) => `<tr><th class="day">${DAY_LABELS[d]}</th>${(['east', 'west'] as Cluster[]).map((c) => groupsFor(c).map((g) => `<td>${esc(cellText(rot.weeks?.[w]?.[d]?.[g.code]))}</td>`).join('')).join('')}</tr>`).join('')}
          ${hasTrainees ? `<tr><th class="day muted">shadow</th>${(['east', 'west'] as Cluster[]).map((c) => groupsFor(c).map((g) => { const v = trainees[g.code as GroupCode]; return `<td class="${v ? 'shadow' : ''}">${v ? esc(label(v)) : ''}</td>`; }).join('')).join('')}</tr>` : ''}
        </table>
      </div>`;
  };

  const stats = rot.group_stats ?? {};
  const cstats = rot.cluster_stats ?? {};
  const clusterBox = (c: Cluster, codes: string[]) => `
    <div class="cluster">
      <div class="cl-title ${c}">${esc(CLUSTER_LABEL[c])}${a.managers[c] ? ` · ${esc(a.managers[c])}` : ''}${cstats[c] ? ` <span class="muted">· ${cstats[c]!.points} pts · ${cstats[c]!.hours} hrs</span>` : ''}</div>
      ${codes.map((code) => `
        <div class="grp">
          <div class="grp-title">${esc(code)}${stats[code as GroupCode] ? ` <span class="muted">${stats[code as GroupCode]!.points} pts · ${stats[code as GroupCode]!.hours} hr</span>` : ''}</div>
          <div class="bldgs${(a.groupBuildings[code] ?? []).length > 6 ? ' two' : ''}">${(a.groupBuildings[code] ?? []).map((b) => `<div>${esc(b)}</div>`).join('') || '<div class="muted">—</div>'}</div>
        </div>`).join('')}
    </div>`;

  const duties = (rot.roles ?? []).map((r) => `<div><span class="b">${esc(r.role)}</span> — ${esc(r.duty)}</div>`).join('');
  const staffing = rot.weekend_staffing
    ? `<div>Sat: <span class="b">${rot.weekend_staffing.saturday.floaters}</span> floaters + <span class="b">${rot.weekend_staffing.saturday.leads}</span> lead${rot.weekend_staffing.saturday.leads === 1 ? '' : 's'}
       &nbsp;·&nbsp; Sun: <span class="b">${rot.weekend_staffing.sunday.floaters}</span> floaters + <span class="b">${rot.weekend_staffing.sunday.leads}</span> lead${rot.weekend_staffing.sunday.leads === 1 ? '' : 's'}</div>`
    : '';

  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<title>Building Rounds · Rotation — printed ${esc(stamp())}</title>
<style>
  ${BASE_CSS}
  @page { size: letter landscape; margin: 0.3in; }
  body { font-size: 8.5pt; }
  header { display: flex; justify-content: space-between; align-items: baseline; border-bottom: 2px solid #000; padding-bottom: 3px; margin-bottom: 8px; }
  h1 { font-size: 14pt; margin: 0; }
  .layout { display: grid; grid-template-columns: 3.1in 1fr; gap: 14px; align-items: start; }
  .cal { width: 100%; }
  .cal th, .cal td { padding: 0 3px; font-size: 7pt; line-height: 1.05; white-space: nowrap; }
  .cal th { background: #eee; text-align: left; }
  .cal tr.month td { background: #ddd; font-weight: 700; font-size: 7pt; letter-spacing: 0.04em; }
  .cal td.tick { width: 12px; text-align: center; }
  .cal .box { display: inline-block; width: 7px; height: 7px; border: 1px solid #000; vertical-align: middle; }
  .cal td.letter { font-weight: 800; font-size: 8.5pt; text-align: center; width: 16px; }
  .week { margin-bottom: 8px; }
  .wk-title { font-weight: 700; margin: 0 0 2px; font-size: 9.5pt; }
  .grid { width: 100%; table-layout: fixed; }
  .grid th, .grid td { font-size: 8pt; padding: 1px 4px; }
  .grid th.day { text-align: left; width: 0.8in; background: #f4f4f4; }
  .grid th.yellowish { background: #fff200; }
  .grid td.shadow { background: #c6efce; }
  .bottom { display: grid; grid-template-columns: 1fr 1fr 1.4fr; gap: 12px; margin-top: 6px; }
  .cl-title { font-weight: 700; font-size: 9.5pt; padding: 2px 4px; margin-bottom: 4px; }
  .grp { margin-bottom: 5px; } .grp-title { font-weight: 700; background: #fff200; display: inline-block; padding: 0 4px; margin-bottom: 1px; }
  .bldgs { border: 1px solid #999; padding: 2px 5px; }
  .bldgs.two { column-count: 2; column-gap: 8px; }
  .duties div { margin-bottom: 2px; }
</style></head><body>
<header>
  <div><h1>Building Rounds · Rotation — Binney St</h1>
    <div class="muted"><b>Find today's date in the calendar:</b> the WEEK letter says which grid applies; the last column says which crew walks that Wednesday's round (week A → ${esc(rot.wednesday_rule.A)} crew, week B → ${esc(rot.wednesday_rule.B)} crew). Tick the box as each week passes.</div></div>
  <div class="stamp">Printed ${esc(stamp())}</div>
</header>
<div class="layout">
  <div>
    <div class="b" style="margin-bottom:3px">A/B weeks — Sunday to Saturday</div>
    <table class="cal"><tr><th></th><th>WEEK</th><th>Week of</th><th>Wednesday</th><th>Wed round</th></tr>${calendarRows}</table>
    <div class="muted" style="margin-top:6px">Sat/Sun plan from manager week to week.</div>
  </div>
  <div>
    ${weekGrid('A')}
    ${weekGrid('B')}
    <div class="bottom">
      ${clusterBox('east', ['E1', 'E2'])}
      ${clusterBox('west', ['W1', 'W2'])}
      <div class="duties">
        <div class="cl-title">Duties · weekend staffing</div>
        ${duties}
        <div style="margin-top:6px">${staffing}</div>
        ${rot.note ? `<div class="muted" style="margin-top:6px">${esc(rot.note)}</div>` : ''}
      </div>
    </div>
  </div>
</div>
</body></html>`;
}

// ── weekend hand-out ───────────────────────────────────────────────────────

export type WeekendPrintArgs = {
  plan: WeekendPlan;
  groups: { code: GroupCode; label: string; cluster: Cluster }[];
  managerLabel: string;
  label: (token: string) => string;
};

export function buildWeekendPlanPrintHtml(a: WeekendPrintArgs): string {
  const { plan, groups, label } = a;
  const sat = new Date(plan.weekend_start + 'T00:00:00');
  const sun = addDays(sat, 1);
  const item = (it: PlanItem) => {
    const cls = it.level === 'warning' ? 'red b warn' : it.level === 'alert' ? 'red' : '';
    return `<li class="${cls}">${esc(it.text)}</li>`;
  };
  const list = (items: PlanItem[] | null | undefined) => (items && items.length ? `<ul>${items.map(item).join('')}</ul>` : '<ul><li class="muted">—</li></ul>');
  const cellText = (raw: string | undefined) => {
    const v = (raw ?? '').trim();
    if (!v) return '—';
    return v.split(/\s*[/,&+]\s*|\s+and\s+/i).filter(Boolean).map(label).join('/');
  };
  const reminders = plan.reminders ?? [];
  const info = reminders.filter((r) => !r.level || r.level === 'info');
  const alerts = reminders.filter((r) => r.level === 'alert');
  const warns = reminders.filter((r) => r.level === 'warning');

  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<title>Weekend Plans ${esc(shortDate(sat))}–${esc(shortDate(sun))}</title>
<style>
  ${BASE_CSS}
  @page { size: letter portrait; margin: 0.5in; }
  body { font-size: 11pt; max-width: 7.5in; margin: 0 auto; }
  h1 { text-align: center; font-size: 18pt; text-decoration: underline; margin: 0 0 14px; }
  ul { margin: 4px 0 10px 0; padding-left: 26px; } li { margin: 2px 0; }
  li.warn { font-size: 11.5pt; }
  table.rounds { width: 100%; margin: 10px 0 14px; }
  table.rounds th, table.rounds td { font-size: 10.5pt; padding: 3px 6px; }
  table.rounds th { background: #fff200; text-align: left; }
  table.rounds td.day { font-weight: 400; }
  h2 { font-size: 11.5pt; text-decoration: underline; margin: 10px 0 2px; }
  .rem { margin-top: 18px; }
  .rem p { margin: 6px 0; }
  .warn-head { color: #c00; font-weight: 900; font-size: 22pt; letter-spacing: 0.02em; }
  .stamp { margin-top: 24px; text-align: right; }
</style></head><body>
<h1>Weekend Plans ${esc(shortDate(sat))}–${esc(shortDate(sun))}</h1>
<ul>
  <li>Manager On Call – ${esc(a.managerLabel)}</li>
  ${(plan.notes ?? []).map(item).join('')}
</ul>
<table class="rounds">
  <tr><th style="background:#fff;border-color:#999"></th>${groups.map((g) => `<th>${esc(g.label)}</th>`).join('')}</tr>
  <tr><td class="day">Saturday</td>${groups.map((g) => `<td>${esc(cellText(plan.rounds?.saturday?.[g.code]))}</td>`).join('')}</tr>
  <tr><td class="day">Sunday</td>${groups.map((g) => `<td>${esc(cellText(plan.rounds?.sunday?.[g.code]))}</td>`).join('')}</tr>
</table>
<h2>Saturday:</h2>${list(plan.saturday_items)}
<h2>Sunday:</h2>${list(plan.sunday_items)}
<div class="rem">
  ${alerts.map((r) => `<p class="red">- ${esc(r.text)}</p>`).join('')}
  ${info.map((r) => `<p>${esc(r.text)}</p>`).join('')}
  ${warns.map((r) => {
    const m = /^warning\s*[–-]\s*(.*)$/i.exec(r.text);
    return m ? `<p><span class="warn-head">WARNING</span><span class="red b"> – ${esc(m[1])}</span></p>` : `<p class="red b">${esc(r.text)}</p>`;
  }).join('')}
</div>
<div class="stamp">Printed ${esc(stamp())}</div>
</body></html>`;
}
