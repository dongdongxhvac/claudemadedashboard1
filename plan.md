# UI Layout Map — COVE PM Dashboard (v5)

Reference document for the current UI layout of `cove_pm_dashboard_REAL_DATA_v5.html`.
Use the letter/number codes (A1, A5b, B3 …) to point at specific spots when
requesting changes. e.g. "shrink A4", "remove A6c", "B3 add Due time".

---

## A. Regular mode (no `?tv=1`)

- **A1** Header — brand "COVE · PM dashboard" (left) · today's date + filename (right)
- **A2** Dropzone wrap (visible until all 3 CSVs load) — 3-column grid
  - **A2a** PM12 dropzone — multi-file; loaded state: green border + "Loaded *N* PM12 snapshots · latest: *filename*"
  - **A2b** Labor dropzone — **optional** · single file (`Assigned To · Labor Hours · Week Start`)
    - states: empty / **loaded** (green border + "Loaded Labor CSV · *filename* · *N* weeks") / **skipped** (muted dashed border + "Skipped — no labor data")
    - **`Skip — no labor data` button** inside the zone — toggle to mark labor as skipped; dropping a CSV after skipping un-skips automatically
    - if skipped: A5b labor hours fall back to PM12's `Labor Hours` column (`_hours` per row)
  - **A2c** WOs dropzone — single file (`Assigned To · WO # · Description · Status`); feeds A7 WO sub-block; loaded state: green border + "Loaded WOs CSV · *filename* · *N* rows"
  - *Reveal gate:* A2a (PM12) **and** A2c (WOs) loaded **and** A2b (Labor) loaded *or* skipped
- **A3** Snapshot bar — Snapshot dropdown · As-of date picker · "today" reset · snapshot count + "drop more anywhere" hint
- **A4** Stat strip — 4 cards: Overdue · Due in 2 weeks · Due this month · Total open PMs
- **A5** §00 *Weekly completions · by assignee*
  - **A5a** comp-summary — team totals (PMs completed, labor hours, active techs)
  - **A5b** comp-grid — one card per assignee (name, PM count from PM12, labor hours from Labor CSV)
    - sort: labor hours desc → PM count desc → name asc
- **A6** §01 *Open PMs · by type & by equipment*
  - **A6a** 4 type cards (Major / Filter Swap / Test/Record / Minor — count + %)
  - **A6b** "By equipment family" subhead
  - **A6c** equipment family table (left) + bar chart (right)
- **A7** §02 *Due today or overdue · or WOs · by assignee*
  - grouped list per assignee, header shows `N PMs · N WOs`
  - **PMs sub-block** (only if any): `<ul>` of PMs due today/overdue (Task # · Due · PM Name); Due styled red when before today
  - **WOs sub-block** (only if any): `<ul>` of open WOs (WO # · Status pill · Description); pill-shaped, solid bg, white text, matches CMMS:
    - `ON HOLD` → red `#e34c4c`
    - `IN PROGRESS` → sky blue `#5bb8e0`
    - `SUBMITTED` → amber `#f4b740`
    - `ACCEPTED` → teal `#74b5a3`
    - anything else → muted gray (default)
  - WO source: rows from `_woRows` where status is **not** closed/complete/cancel
  - sort: total items (PMs + WOs) desc → name asc
  - no table, no chart
- **A8** §03 *Due in current month · by assignee*
  - **A8a** assignee table — Assignee · Major · Filter · Test · Minor · Total · Equipment (clickable chips → printable)
  - **A8b** stacked horizontal bar chart
- **A9** Footer — "self-contained · runs locally" + "Load another file" reset button

---

## TV mode 1 (`?tv=1` — or any non-empty `?tv=…` value other than `2`)

```
┌──────────────────────────────────────────────────┐
│ A4 Stat strip (full width)                       │
├────────────────────┬─────────────────────────────┤
│ A5 §00             │ A8 §03                       │
│ Weekly completions │ Due this month               │
│ (~30% width)       │ table only, no chart (~70%)  │
└────────────────────┴─────────────────────────────┘
```

- A1 header, A2 dropzone wrap (until loaded), A3 snapshot bar, A9 footer — unchanged from regular
- **Hidden in TV mode 1:** §01 (A6), §02 (A7), §03's bar chart (A8b)
- Layout: 2-col grid with §00 (~30%) left, §03 table (~70%) right; strip across top
- Fonts, mouse cursor, page scroll — all desktop-default

---

## TV mode 2 (`?tv=2`)

```
┌──────────────────────────────────────────────────┐
│ A1 header (slim, brand 22px)                     │
├──────────────────────────┬───────────────────────┤
│ A2a PM12 │ A2b Labor │ A2c WOs   (always visible,│
│   (compact dropzones, 3 cols)    side-by-side)   │
├──────────────────────────┼───────────────────────┤
│ A5 §00 Weekly comp       │                       │
│ (4-col comp-grid)        │   A8 §03 Due month    │
│                          │   table only, no      │
├──────────────────────────┤   bar chart, keeps    │
│ A7 §02 Due today/overdue │   Equipment chips     │
│ (6×2 card grid,          │                       │
│  up to 12 cards)         │   (40% width,         │
│ (60% width)              │   spans both rows)    │
└──────────────────────────┴───────────────────────┘
```

- **Shown:** A1 header, A2 dropzones (compact, *always visible* — different from regular and TV-1), A5 §00, A7 §02, A8 §03 (table only)
- **Hidden:** A3 snapshot bar, A4 stat strip, A6 §01, A8b bar chart, A9 footer
- Layout: 2-col grid; left col has §00 stacked on §02; right col is §03 spanning both rows
- **A5 / A8 column ratio: 60 / 40** (`grid-template-columns: 60fr 40fr`)
- **A7 in tv=2 is a card grid, not a grouped list** — `#dueTodayContent` becomes `repeat(6, 1fr)`, each `.due-today-group` is a compact card showing assignee name + PM count (Fraunces 22px, warn-red); the per-PM `<ul>` is hidden because 6 cols × ~180px is too narrow to render `Task # · Due · PM Name` legibly
- Compact typography (brand 22px, section h2 17px, comp-card numbers 26px, table 11–12px)
- Mouse cursor visible; page can scroll if anything overflows

---

## B. Printable PM list — opens when an Equipment chip in A8a is clicked

- **B1** Header — title "*{Assignee}* · *{Equipment}* PMs" + Generated date · COVE PM12
- **B2** Controls — Window toggle (`EOM` ⇄ `All open`) · PM count · `Print` button (orange)
- **B3** Table — **Task # · Due · Equipment · PM Name**
  - sort: Equipment ID asc → Due date asc
  - row width fills the page
- **B4** Signature blocks — Tech signature / Date  ·  Notes
- **B5** Footer — "*{Assignee}* · *{Equipment}* · *{window label}*" + "COVE PM12"
- **B6** Print stylesheet — hides B2 on print, 0.5in margins, black table border, signature blocks remain

---

## Data flow summary

- **PM12 CSV** → snapshot store (`_snapshots`) → renders A3, A4, A5b (count), A6, A7, A8
- **Labor CSV** → week-keyed map (`_laborByWeek`) → renders A5a (hours), A5b (hours)
- **WOs CSV** → enriched row store (`_woRows`) → feeds A7 WO sub-block (open WOs grouped by assignee)
  - Expected columns: `Assigned To`, `WO #` (or `ID`), `Description`, `Status` — the column matcher accepts a couple of common aliases
  - Each row enriched with `_assignee`, `_id`, `_desc`, `_status`, `_isOpen`
- Reveal: PM12 + WOs **required**; Labor either loaded **or** skipped via A2b's Skip button (`_laborSkipped` flag)
- Equipment chip click (A8a) → `openPrintableList()` → new tab with section B
