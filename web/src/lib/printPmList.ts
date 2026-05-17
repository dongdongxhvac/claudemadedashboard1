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
  const win = window.open('', '_blank', 'width=900,height=1100');
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

  const rows = pms
    .map((r) => `
      <tr>
        <td>${r.due_date ? new Date(r.due_date + 'T00:00:00').toLocaleDateString() : '—'}</td>
        <td><code>${esc(r.task_no)}</code></td>
        <td>${esc(r.name)}</td>
        <td>${esc(r.building_code)}</td>
        <td>${esc(r.equipment)}</td>
        <td style="width:60px;"></td>
      </tr>`)
    .join('');

  win.document.write(`<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<title>${esc(engineerName)} — PM List · ${dateStr}</title>
<style>
  body { font-family: Georgia, "Times New Roman", serif; padding: 24px; max-width: 8.5in; margin: 0 auto; color: #000; }
  header { border-bottom: 2px solid #000; margin-bottom: 14px; padding-bottom: 6px; }
  h1 { margin: 0 0 4px; font-size: 18pt; }
  .meta { font-size: 11pt; color: #444; }
  table { width: 100%; border-collapse: collapse; font-size: 10pt; }
  th, td { border: 1px solid #999; padding: 4px 6px; text-align: left; vertical-align: top; }
  th { background: #eee; font-weight: bold; font-size: 9pt; text-transform: uppercase; letter-spacing: 0.5px; }
  code { font-family: ui-monospace, Consolas, monospace; font-size: 9pt; }
  .sign { margin-top: 32px; display: flex; gap: 32px; }
  .sign-line { flex: 1; border-bottom: 1px solid #000; padding-bottom: 28px; }
  .sign-label { font-size: 9pt; color: #666; margin-top: 4px; }
  .toolbar { margin-bottom: 16px; }
  .toolbar button { font-size: 11pt; padding: 6px 14px; cursor: pointer; }
  footer { margin-top: 24px; text-align: center; font-size: 9pt; color: #666; }
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
    <th>Building</th>
    <th>Equipment</th>
    <th>Notes / Initial</th>
  </tr></thead>
  <tbody>${rows}</tbody>
</table>
<div class="sign">
  <div class="sign-line"><div class="sign-label">Technician signature</div></div>
  <div class="sign-line"><div class="sign-label">Date</div></div>
</div>
<footer>COVE · PM Dashboard</footer>
</body></html>`);
  win.document.close();
  setTimeout(() => { try { win.focus(); win.print(); } catch { /* swallow */ } }, 150);
}
