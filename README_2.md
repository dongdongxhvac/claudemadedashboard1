# COVE PM Dashboard

A self-contained operations dashboard for tracking preventive maintenance (PM) work at COVE. Two deliverables that share the same analysis logic:

1. **`cove_pm_dashboard.html`** — single-file drag-drop tool. Open in any browser, drop a CSV, dashboard renders. No build step, no server, no dependencies (CDNs only).
2. **`cove_pm_daily.py`** — automation script. Downloads CSV from PM12 via Playwright, uploads to Google Drive, generates a pre-loaded HTML dashboard for the day.

The HTML and Python implementations are designed to produce identical numbers from the same input — the JS classifier (`classifyPM`) and Python classifier (`classify_pm`) must stay in lockstep.

---

## Quick start

### Just want to look at PM data?

Open `cove_pm_dashboard.html` in Chrome. Drag your tasks CSV onto it. Done.

### Want full automation?

```bash
pip install playwright pandas google-api-python-client google-auth-oauthlib
playwright install chromium
cp .env.example .env  # then fill in PM12_URL and DRIVE_FOLDER_ID
python cove_pm_daily.py --auth   # one-time CMMS login
python cove_pm_daily.py          # daily run
```

The Playwright selectors in `download_csv()` are placeholders — they need to be customized for your specific CMMS. See "Wiring up the automation" below.

---

## What this dashboard does

Given a CSV export of PMs (open and/or completed), the dashboard surfaces:

- **Section 00 — Weekly completions by assignee.** Stat cards showing each tech's PM count and labor hours for the current week. Requires a CSV with completed rows (e.g. `tasks(1).csv`).
- **Section 01 — Open PMs by type and equipment.** Four PM-type cards (Major / Filter Swap / Test/Record / Minor) plus an equipment-family chart and table for all open work.
- **Section 02 — Due in 2 weeks by assignee.** Table with Major/Filter/Test/Minor columns, an Equipment column showing each assignee's equipment families with counts, and a stacked-bar chart. Equipment chips are clickable — they open a printable per-assignee, per-equipment PM list in a new tab.
- **Section 03 — Due in current month by assignee.** Same layout as section 02. **Note: month-bounded** — only PMs due in the current calendar month, not "everything before EOM."

Above all sections, a summary strip shows: Overdue count, Due in 2 weeks, Due this month, Total open.

A snapshot bar at the top supports:
- **Snapshot dropdown** — switch between multiple loaded CSVs (different days)
- **As-of date picker** — recompute date windows against any chosen "today"

---

## Architecture

### Single-file HTML, no build

The dashboard is one HTML file with inlined CSS and JS. External libraries come from CDN: `PapaParse` (CSV parsing), `Chart.js` (charts), Google Fonts (Fraunces, Inter Tight, JetBrains Mono).

This is intentional. The dashboard needs to work:
- Offline (after first load, browsers cache CDN assets)
- Without a build pipeline
- When emailed to coworkers as a static file
- When opened directly from a Google Drive download

### Python automation reuses the HTML template

`cove_pm_daily.py` doesn't have its own rendering logic. It runs analysis in pandas (deterministic counts), then injects the CSV content as a JS string into the HTML template before `</body>`. The dashboard auto-loads the embedded data on `DOMContentLoaded`.

This is why `analyze()` in Python and `render()` in JS produce the same numbers — the Python script's analysis output is just for the terminal log; the actual dashboard math is done in JS at load time.

### Snapshot model

The dashboard supports multiple loaded CSVs (one per day). Each becomes a "snapshot" identified by date (parsed from filename: `COVE PM12 2026-05-02.csv` → May 2, or fallback to max `Updated At`). Sections 01-03 render the active snapshot; section 00 (completions) currently only uses the active snapshot's completed rows.

When the Python script runs, it bundles up to 5 days of history from `./downloads/` automatically, so the dashboard ships with trend data without needing manual file-drops.

---

## Data model

### Expected CSV columns

```
Task #, Due Date, Site, Building, Equipment, Name, Interval,
Status, Assigned To, Open Date, Category, Est Labor Hours,
Labor Hours, Equipment Category, Updated At, Object ID
```

The dashboard tolerates extra columns. Missing critical columns trigger an alert with the list of missing fields.

### Date format

The CSV uses ISO format with timestamps: `2026-03-31 16:00:00`. The parser also accepts MM/DD/YYYY for compatibility with other potential exports. Times are ignored — all bucketing is by date.

### Status values

Observed values: `to_do`, `on_hold`, `in_progress`, `completed`. The filter logic:

- **Open rows** (used by sections 01-03): status does NOT contain `closed`, `complete`, or `cancel`. So `to_do`, `on_hold`, `in_progress` all pass through.
- **Completed rows** (used by section 00): status equals `completed`, `closed`, or `complete`.

### PM type classifier

**Priority order (first match wins):**

1. **Major** — name contains `major`, OR `sand filter disinfection`, OR `annual` (but NOT `semi-annual`)
2. **Filter Swap** — name contains `filter swap`, `filter replace`, `filter change`, OR `filter order`
3. **Test/Record** — name contains `gen test`, `water test`, `churn test`, `water meter`, `water reading`, OR (whole-word) `SPCC`, `DEP log`, `rounds`
4. **Minor** — everything else

Implemented identically in:
- JS: `classifyPM(name)` in dashboard HTML
- Python: `classify_pm(name)` in `cove_pm_daily.py`

**If you change one, change the other.** This is the single biggest source of potential drift.

### Equipment normalization

The CMMS's `Equipment Category` column has 28 distinct values, many semantically duplicate (`Air Handling Unit` vs `Air Handler Unit`). The dashboard collapses them via `EQUIPMENT_MAP`:

| Clean family | Source values |
|---|---|
| AHU | Air Handling Unit, Air Handler Unit, Exhaust Air Handling Unit |
| Fan | Exhaust Fan, Supply Fan |
| Pump | Pump, Circ Pump |
| Cooling Tower | Cooling Tower |
| Water Heater | Gas Water Heater, Electric Water Heater |
| Filters | Filters (Box/Bag), Sand Filter |
| Building/Roof | Building, Roof |
| Rounds | Rounds |
| VFD | Variable Frequency Drive |
| Generator | Generator |
| Fire Protection | Fire Protection System |
| (others passed through) | Expansion Tank, Water Treatment, Split System, etc. |

Families with fewer than 3 entries collapse into "Other" (pinned to the bottom of the equipment table). This map exists in both the HTML's `EQUIPMENT_MAP` (JS) and `cove_pm_daily.py`'s `EQUIPMENT_MAP` (Python).

### Date semantics

- **Overdue:** `due_date < today` (or as-of date)
- **Due in 2 weeks:** `due_date <= today + 14 days` — includes overdue. NOT month-bounded by design.
- **Due this month:** `start_of_month <= due_date <= end_of_month` — month-bounded. Excludes overdue from previous months.

This split was deliberate (see "Versions" → v4 below).

---

## Versions and what changed

The dashboard evolved across 5 versions. Earlier versions are kept in the outputs folder for design comparison.

| Version | Major changes |
|---|---|
| **v1** | Initial: PM type cards + assignee tables for 2-week and EOM windows |
| **v2** | Added "Equipment" column to assignee tables (sections 02/03). Each cell shows family chips like `Pump(15) Fan(8)` |
| **v3** | Added snapshot bar (multi-CSV support), as-of date picker, trend charts (PM type over time + per-assignee). Trend charts removed in v4 because daily numbers were nearly flat. |
| **v4** | Month-bounded the EOM count (was `due <= EOM` which included overdue from previous months; now `start_of_month <= due <= EOM`). Removed v3 trend charts; left placeholder for completion chart. Renamed "Due by EOM" → "Due this month." |
| **v5** | Replaced section 00 placeholder with weekly-completion stat cards. 12 cards (one per assignee) showing PM count + labor hours for the current week. Falls back to most recent week with data if current week is empty. |

The current version is **v5**. Earlier versions exist for design comparison only.

### Why some choices were made

- **Equipment chips clickable → printable list.** Field techs need to walk a building with a list. Clicking a chip opens a new tab with a print-formatted PM list filtered to that assignee + equipment combo, sorted by Building then Equipment ID. Includes signature/notes blocks for paper workflows.
- **Stat cards instead of small multiples for completions.** The original design called for small multiples (12 mini line charts). User pivoted to current-week-only, which made small multiples meaningless (one data point per chart). Cards are the right primitive for "current state per person."
- **Why month-bound EOM but not 2-week.** EOM is a monthly KPI — including last month's overdue muddied the picture. 2-week is a "next fortnight" planning window where overdue is genuinely relevant. Different metrics, different scoping.

---

## Known issues and rough edges

### Things to validate against real-world use

1. **`Updated At` as completion date.** This is the only date field with completion info, but any edit to a row updates it. If a tech edits a closed PM weeks after closing it, the completion date shifts. Worth spot-checking against the CMMS UI.

2. **Building → assignee mismatch.** Earlier exploration showed most buildings have 2-5 assignees and most assignees work across 2-10 buildings. The user's mental model was "1 building = 1 assignee." Either the data is wrong or the mental model is. Worth investigating before shipping printable lists to actual techs.

3. **High hours on low PM counts.** Recent week showed one tech at 192h on 15 PMs (mean 12.8h vs team mean 2.4h). Likely a mis-keyed labor hours entry (one row at 151.75h dominates). Dashboard surfaces but doesn't flag — could add an outlier warning.

4. **Snapshot date inference.** Filenames like `COVE PM12 2026-05-02.csv` parse cleanly. Files without dates fall back to max `Updated At`, which might be wrong for older exports. Standardizing the export filename is the cleanest fix.

### Code quality issues

5. **Two parallel classifier implementations.** JS `classifyPM` and Python `classify_pm` must stay in sync. There's no shared source of truth or test that compares them. In code mode, consider extracting the rules into a shared JSON config that both consume, or generating one from the other.

6. **The HTML template is large (~1500 lines).** Inlined CSS and JS made sense for the drag-drop tool, but at this size it's hard to navigate. In code mode: split into separate HTML/CSS/JS source files, plus a small bundler that produces the single-file version for end users.

7. **No tests.** The Python `analyze()` function and the JS classifier have hand-spot-checks but no automated tests. In code mode: pytest for Python, vitest or similar for JS, with shared fixture CSVs.

8. **Playwright selectors are placeholders.** The `SELECTORS` dict in `download_csv()` has guesses for "Due Date" header and "Export" button — they need to be replaced with actual selectors from the live PM12 page. This is the single biggest blocker to running the automation end-to-end.

9. **Embedded `</script>` tag escaping.** When generating the printable PM list HTML, the JS template literal contains `<script>` and `</script>` tags. Without escaping, the browser parser would terminate the parent script tag early. Currently fixed by string concatenation: `'<' + 'script>'`. Easy to break accidentally. In code mode: a build step that processes templates would solve this cleanly.

10. **Path equality bug fixed but worth knowing about.** In the Python script, comparing relative `--csv` arg paths against absolute glob results silently fails (`Path('downloads/x.csv') != Path('/abs/downloads/x.csv')`). Fixed with `.resolve()` calls but the pattern is easy to forget when adding new comparisons.

---

## File inventory

### Active code

- `cove_pm_dashboard.html` — current dashboard (v5). The single-file drag-drop tool. End users get this.
- `cove_pm_daily.py` — automation script. Sysadmins run this on a schedule.
- `.env.example` — config template for the Python script.

### Test/example data

- `sample.csv` — synthetic data matching the schema, useful for quickly testing the dashboard without exposing real PM data.

### Output (generated)

- `output/cove_pm_dashboard_YYYY-MM-DD.html` — daily output from the Python script, with that day's CSV pre-embedded.
- `downloads/COVE PM12 YYYY-MM-DD.csv` — accumulated daily exports, used for historical snapshots.

### Reference (don't ship)

- `cove_pm_dashboard_v2.html` through `_v4.html` — earlier versions kept for design comparison. Not used at runtime.
- `cove_pm_dashboard_REAL_DATA_*.html` — versioned templates with real data pre-embedded for visual review. Useful for showing stakeholders what their data looks like.
- `cove_pm_dashboard_with_sample_data.html` — sample.csv pre-embedded for demos.

---

## Wiring up the automation

The Python script is mostly complete but needs three pieces of one-time setup before it can run end-to-end:

### 1. Customize Playwright selectors

In `download_csv()`, the `SELECTORS` dict currently has guesses:

```python
SELECTORS = {
    "due_date_header": 'th:has-text("Due Date")',
    "export_button": 'button:has-text("Export"), a:has-text("Export to CSV")',
    "export_confirm": 'button:has-text("CSV")',
}
```

After running `python cove_pm_daily.py --auth` (which opens a browser and lets you log in once), open Chrome DevTools on the PM12 page. Inspect the "Due Date" column header and the export button, copy unique CSS selectors, and update the dict.

Common patterns by CMMS:
- **ServiceNow:** export usually under right-click context menu on the list, or gear icon → Export → CSV
- **Maximo:** action menu (≡) at top of list → Download
- **Fiix:** download icon at top-right of work order list

### 2. Google Drive setup

1. Go to https://console.cloud.google.com
2. Enable the Google Drive API
3. Create OAuth 2.0 credentials (Desktop app type)
4. Download the JSON, save as `credentials.json` next to the script
5. Get your COVE folder ID from its URL: `https://drive.google.com/drive/folders/THIS_PART` → set as `DRIVE_FOLDER_ID` in `.env`

### 3. Schedule daily runs

**macOS / Linux** (crontab):
```
0 7 * * 1-5  cd /path/to/cove_pm && /usr/bin/python3 cove_pm_daily.py >> daily.log 2>&1
```

**Windows** (Task Scheduler): Trigger daily at 7am weekdays, action = `python.exe cove_pm_daily.py`.

---

## Roadmap for code mode

Suggested priorities when migrating:

1. **Set up the repo properly.** `git init`, sensible `.gitignore` (downloads/, output/, browser_state/, credentials.json, token.json, .env), README at root, license.
2. **Split the HTML monolith.** `src/dashboard.html` + `src/dashboard.css` + `src/dashboard.js`, plus a build script that produces the single-file output.
3. **Extract classifier rules to JSON.** One source of truth, consumed by both JS and Python. Eliminates the drift risk between `classifyPM` and `classify_pm`.
4. **Write tests.** Fixtures: a small "open-only" CSV, a small "with completions" CSV, edge cases (empty assignee, malformed dates, weird PM names). Pytest for Python, vitest for JS, with a cross-check that both classifiers produce the same output on the same fixtures.
5. **Wire up the Playwright selectors against the live CMMS.** Until this is done, the automation can't actually fetch CSVs.
6. **Decide on building → assignee semantics.** Either fix the CMMS data, or update the dashboard to acknowledge multi-assignee buildings.
7. **Consider a "completion trend" view.** Section 00 currently only shows the current week. A 4-8-week historical view would show whether team output is trending up or down — but it needs aggregated tasks data from multiple snapshots. Could be a v6 if it's valuable.
8. **CI/CD.** Once tests exist, run them on every PR. The dashboard is small enough that GitHub Actions free tier covers it.

### Suggested folder structure for code mode

```
cove-pm-dashboard/
├── src/
│   ├── dashboard.html        # template
│   ├── dashboard.css         # styles
│   ├── dashboard.js          # main app logic
│   ├── classifier.js         # PM type + equipment normalization
│   ├── printable.js          # printable list generator
│   └── classifier-rules.json # shared rule source (consumed by JS + Python)
├── automation/
│   ├── cove_pm_daily.py      # main script
│   ├── classifier.py         # mirrors classifier.js, reads same JSON
│   ├── analyze.py            # pandas analysis
│   └── render.py             # HTML template injection
├── tests/
│   ├── fixtures/             # sample CSVs
│   ├── test_classifier.py    # Python tests
│   ├── test_analyze.py
│   ├── classifier.test.js    # JS tests
│   └── test_parity.py        # cross-checks JS vs Python outputs
├── scripts/
│   └── build.js              # bundles src/ into single-file dashboard.html
├── dist/
│   └── cove_pm_dashboard.html  # built output, this is what end users get
├── .env.example
├── .gitignore
├── package.json
├── pyproject.toml
└── README.md
```

---

## License / attribution

Internal project. Adjust as needed for your org's policies.
