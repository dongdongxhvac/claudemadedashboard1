import type { PmRow } from '../hooks/useCurrentSnapshots';

/**
 * Open a separate browser window with a print-friendly PM list and auto-
 * trigger the print dialog. Matches V5's section-B "printable PM list"
 * shape (clean serif header, equipment table, signature lines at bottom).
 */
export function openPrintWindow(
  engineerName: string,
  pms: PmRow[],
  filter: 'month' | 'all',
  equipmentFilter: string | null,
): void {
  // No window features → browsers open a real tab instead of a popup.
  const win = window.open('', '_blank');
  if (!win) {
    alert('Pop-up blocked. Allow pop-ups for this site and try again.');
    return;
  }

  const esc = (s: string | null | undefined) =>
    (s ?? '—')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  const filterDesc =
    (filter === 'month' ? 'Due this month' : 'All open') +
    (equipmentFilter ? ` · ${equipmentFilter}` : '');

  const dateStr = new Date().toLocaleDateString(undefined, {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });

  // Sort by due date first, then building (numeric-aware tiebreak). The list
  // reads chronologically so a tech can see what's next; buildings cluster
  // for any rows due the same day.
  const sorted = [...pms].sort((a, b) => {
    const da = (a.due_date ?? '').localeCompare(b.due_date ?? '');
    if (da !== 0) return da;
    return (a.building_code ?? '').localeCompare(b.building_code ?? '', undefined, { numeric: true });
  });

  const rows = sorted
    .map((r) => `
      <tr>
        <td>${r.due_date ? new Date(r.due_date + 'T00:00:00').toLocaleDateString() : '—'}</td>
        <td><code>${esc(r.task_no)}</code></td>
        <td>${esc(r.name)}</td>
        <td>${esc(r.equipment)}</td>
        <td style="width:60px;"></td>
      </tr>`)
    .join('');

  win.document.write(`<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<title>${esc(engineerName)} — PM List · ${dateStr}</title>
<style>
  body { font-family: Georgia, "Times New Roman", serif; padding: 18px; max-width: 8.5in; margin: 0 auto; color: #000; font-size: 9pt; }
  header { border-bottom: 2px solid #000; margin-bottom: 10px; padding-bottom: 4px; }
  h1 { margin: 0 0 2px; font-size: 14pt; }
  .meta { font-size: 9pt; color: #444; }
  table { width: 100%; border-collapse: collapse; font-size: 8.5pt; }
  th, td { border: 1px solid #999; padding: 2px 4px; text-align: left; vertical-align: top; }
  th { background: #eee; font-weight: bold; font-size: 7.5pt; text-transform: uppercase; letter-spacing: 0.4px; }
  code { font-family: ui-monospace, Consolas, monospace; font-size: 8pt; }
  .sign { margin-top: 24px; display: flex; gap: 24px; }
  .sign-line { flex: 1; border-bottom: 1px solid #000; padding-bottom: 22px; }
  .sign-label { font-size: 7.5pt; color: #666; margin-top: 3px; }
  .toolbar { margin-bottom: 12px; }
  .toolbar button { font-size: 10pt; padding: 5px 12px; cursor: pointer; }
  footer { margin-top: 18px; text-align: center; font-size: 7.5pt; color: #666; }
  @media print { body { padding: 0; } .toolbar { display: none; } }
</style>
</head><body>
<div class="toolbar">
  <button onclick="window.print()">Print</button>
  <button onclick="window.close()">Close</button>
</div>
<header>
  <h1>${esc(engineerName)} — PM List</h1>
  <div class="meta">${dateStr} · ${filterDesc} · ${pms.length} PM${pms.length === 1 ? '' : 's'}</div>
</header>
<table>
  <thead><tr>
    <th>Due Date</th>
    <th>Task #</th>
    <th>PM Name</th>
    <th>Equipment</th>
    <th>Notes / Initial</th>
  </tr></thead>
  <tbody>${rows}</tbody>
</table>
<div class="sign">
  <div class="sign-line"><div class="sign-label">Technician signature</div></div>
  <div class="sign-line"><div class="sign-label">Date</div></div>
</div>
<footer>UPark · PM Dashboard</footer>
</body></html>`);
  win.document.close();
  // Don't auto-print — user clicks the Print button in the new tab when ready.
}
