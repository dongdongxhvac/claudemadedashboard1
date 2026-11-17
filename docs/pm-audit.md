# PM Audit — build spec for Claude Code

Status: database layer is **live** in Supabase (`iujuibvcahuapzowjtym`). This spec covers the two
remaining pieces: the VM poller hook and the dashboard section. Both sites (UPark + Binney) share
one schema, keyed on `site_code`.

Design canvas (3 artboards: queue → review card → scorecard): `COVE PM Audit UI` in Claude artifacts.

---

## 1. What it does

Every Sunday 23:05 ET a pg_cron job scores last week's closed recurring PMs, builds a review queue
(flagged + 5 random per site), and prunes old task history. Monday morning the manager reviews the
queue in COVE (~15 min), gives each task Pass / Coach / Fail, and the scorecard rolls up per tech.

Evidence comes from Cove's `GetPMTaskDetails` GraphQL query — steps, attachments, history — pulled
per task by the VM and stored in `pm_task_details`.

---

## 2. Database (already applied — do not recreate)

Migrations: `pm_audit_schema`, `pm_audit_flags_batch_close_requires_no_photos`,
`pm_audit_weekly_hours_gate_and_multi_notes`.

### Tables

| Table | Written by | Purpose |
|---|---|---|
| `pm_task_details` | VM (service role) | One row per Cove task: steps, attachments, history, notes, derived timestamps |
| `pm_audit_rules` | manager (UI later) | Photo / note minimums by template regex or pm_type |
| `pm_audit_note_stoplist` | seed | Boilerplate notes that count as empty |
| `pm_audit_queue` | cron | `(week_start, task_no)` → reason `flagged`/`random`, `flags[]` |
| `pm_audit_reviews` | UI | `(week_start, task_no)` → verdict, reason_tags[], note, reviewer_id |

### Views

| View | Grain | Use |
|---|---|---|
| `v_pm_task_details_backlog` | task | VM: closed recurring PMs with no (or stale) detail row |
| `v_tech_week_hours` | tech × week | latest weekly labor total from `labor_rows` |
| `v_pm_audit_flags` | close event | **UI reads this for the queue and review card** |
| `v_pm_audit_scorecard` | site × tech × week | **UI reads this for the scorecard** |

### Functions / cron

- `classify_pm(name)` — SQL twin of `classifyPM` (JS) / `classify_pm` (Python). Keep all three in sync.
- `build_pm_audit_queue(week_start date, random_per_site int)` — idempotent; random picks are seeded by week.
- `prune_pm_task_history(days)` — nulls `history` JSONB after 180 d unless the task was ever queued.
- cron `pm_audit_weekly` — `5 4 * * 1` UTC = Sunday 23:05 ET. Runs both of the above.

### `v_pm_audit_flags` columns the UI needs

```
task_no, site_code, building_code, equipment, task_name, assigned_to_name,
completed_on, completed_date_local, week_start, pm_type,
labor_hours, est_labor_hours, tech_week_hours,
has_details,                      -- false = detail row not loaded yet; photo/steps/note columns are null
cove_task_id, started_at, completed_at, close_note, note_count, note_chars,
steps_total, steps_checked, photo_count, attachment_count,
first_attachment_at, last_attachment_at,
min_photos, min_note_chars, note_must_match,
f_low_photos, f_steps_incomplete, f_thin_note, f_desk_close, f_low_labor, f_batch_close,
flags text[], flag_count
```

### Flag rules (as implemented)

| Flag | Fires when |
|---|---|
| `low_photos` | has_details AND photo_count < min_photos |
| `steps_incomplete` | has_details AND steps_checked < steps_total |
| `thin_note` | has_details AND (note < min_note_chars OR note in stoplist OR fails `note_must_match`) |
| `desk_close` | has_details AND photo_count = 0 AND completed − started < 2 min |
| `low_labor` | est ≥ 0.5 h AND labor < 25 % est **AND tech_week_hours < 30** |
| `batch_close` | est ≥ 0.5 h AND ≥ 4 other closes by same tech within ±5 min AND photo_count < min_photos |

Scope: `pm_close_events.cmms_type = 'recurring'` only. On-demand tasks are excluded.

Rule lookup: first active `pm_audit_rules` row with `match_kind='template'` whose regex matches
`task_name` (by `priority`), else the `pm_type` row, else 1 photo / 15 chars.

### RLS

- `pm_task_details`: admin/manager/director/lead read all; engineer reads own (`assignee_name = current_user_cmms_name()`).
- `pm_audit_queue`, `pm_audit_reviews`: admin/manager/director/lead read; admin/manager/lead write reviews.
- `pm_audit_rules`: everyone reads; admin/manager write.
- Views inherit the underlying tables' RLS. Engineers will see their own rows in `v_pm_audit_flags` only.

---

## 3. VM — wire `cove_task_details.py` into `pm12_poller.py`

File: `cove_task_details.py` (in repo). Already handles fetch, normalize, upsert, backfill.

1. Import it in `pm12_poller.py`.
2. After the poller inserts new `pm_close_events` rows, collect their `cove_task_id`s (from `pm_rows`,
   same `task_no`) and call `on_close_events(session, supabase_client, ids)`.
   `session` must be the `requests.Session` that already carries the Cove auth cookie.
3. One-time: `python cove_task_details.py backfill 5000` drains `v_pm_task_details_backlog`
   (~5,900 tasks at 0.5 s each ≈ 50 min). Run it detached.
4. Verify: `select count(*), count(*) filter (where photo_count > 0) from pm_task_details;`

GraphQL endpoint `https://api.cove.is/gql`, operation `GetPMTaskAudit` (trimmed from the browser's
`GetPMTaskDetails`). Variable `{"id": "<cove_task_id>"}`. Auth rides in the `cove_manage_auth` cookie.

Photo URLs are plain Parse-server links (`https://api.cove.is/parse/files/<app>/<hash>.jpg`).
**Verified public (loads in incognito, no cookie).** Use `<img src>` directly; no proxy or Storage mirror.
Because they are unauthenticated, never put photo URLs in emails, exports or the client report.

---

## 4. Dashboard — new section "05 PM Audit" in `web/src/`

Three screens, matching the design canvas. Site toggle (UPark / Binney / Both) at the top of each.

### 4.1 Queue (`/audit`)

Data: `pm_audit_queue` for the selected `week_start`, joined to `v_pm_audit_flags` and
left-joined to `pm_audit_reviews`.

```sql
select q.*, f.*, r.verdict, r.reviewed_at
from pm_audit_queue q
join v_pm_audit_flags f on f.task_no = q.task_no and f.week_start = q.week_start
left join pm_audit_reviews r on r.task_no = q.task_no and r.week_start = q.week_start
where q.week_start = $1 and ($2 is null or q.site_code = $2)
order by (r.id is null) desc, q.reason, f.assigned_to_name, f.completed_on desc;
```

- Stat tiles: closed this week (from `v_pm_audit_flags` count), flagged, random, reviewed n/N, photo rate
  (`v_pm_audit_scorecard` aggregate; show “—” when `with_details = 0`).
- Filter pills: All / Flagged / Random / Open (unreviewed). Tech and Flag selects.
- Table columns: Task · PM + equipment/building · Tech · Closed (local, `Thu 2:54 PM`) · Labor `x / est` ·
  Photos `count / min_photos` · Steps `checked / total` · Note (`note_chars`, or the boilerplate word in red) · Flags (chips) · Verdict · action.
- When `has_details = false`: Photos/Steps/Note show “—” in grey, never red.
- Flag chip colors: red for `low_photos` with 0 photos and `desk_close`; orange for the rest; blue for Random sample.
- Week picker: ← / → by `week_start`. Default = most recent `week_start` in `pm_audit_queue`.

### 4.2 Review card (`/audit/:week/:task_no`)

Data: one `v_pm_audit_flags` row + `pm_task_details` (steps, attachments, notes, history) +
prior notes on the same equipment (`pm_task_details where equipment_id = $eq and task_no <> $task order by completed_at desc limit 3`) + existing `pm_audit_reviews` row.

Layout (left 60 % / right 40 %, stacks at phone width):

- Header: task_no, flag chips, task name, equipment · building, Tech / Closed / Labor / “Open in Cove” link (`https://manage.cove.is/` — exact task URL TBD; see §6).
- **Photos**: grid, `photo_count` thumbnails + dashed “missing” slots up to `min_photos`. Caption: uploaded time + uploader from `attachments[].uploadedAt/uploadedBy`. Click → lightbox.
- **Checklist**: `steps[]` with checked state; unchecked rows highlighted.
- **Timeline**: `history[]` sorted by `createdAt`; render `opened`, `assignee_changed`, `attachment_added` (n photos), `status_changed`, `labor_item_added`. Highlight the `in_progress`→`completed` pair when < 2 min.
- **Notes**: all `notes[]` entries with source badge; show `note_chars` vs `min_note_chars` and the Thin-note chip when `f_thin_note`.
- **Prior notes on this equipment**: up to 3, date + tech + task_no.
- **Verdict box**: Pass / Coach / Fail; reason pills (`missing_photos`, `wrong_photo`, `note_too_thin`, `steps_skipped`, `timing`, `follow_up_wo`); note textarea; **Save & next** → upsert `pm_audit_reviews` (`reviewer_id` = current `users.id`), then navigate to next unreviewed row in the same filter. Enter = Save & next.
- Prev / Skip in the header.

### 4.3 Scorecard (`/audit/scorecard`)

Data: `v_pm_audit_scorecard` for the last 4 / 8 / 13 weeks.

- Team tiles: photo rate, steps rate, note rate, flag rate, reviewed · pass %.
- Per-tech table: closed, photo %, steps %, flagged %, week_hours, pass %, 8-week sparkline of photo %, `top_flag`.
- Bars: flags by reason (unnest `flags` from `v_pm_audit_flags` over the window), photo rate by `pm_type`.
- Everything greys out with “needs backfill” while `with_details = 0`.

### 4.4 Rules editor (later, admin only)

CRUD on `pm_audit_rules`. Not in scope for the first PR.

---

## 5. Manager workflow (so the UI serves it)

1. Sunday night: cron builds the queue. Nothing for the manager to do.
2. Monday: open queue, work through Open rows. 30–60 s each. ~40 rows the first weeks, dropping as behavior changes.
3. Feedback to the tech happens in a 1:1 or message, not in the tool. The note field is for the manager.
4. Scorecard is manager-only for the first month; expose per-tech self-view after that.
5. Monthly: photo rate + pass rate → “PM quality verification” line in the BMR client report.

---

## 6. Open items / decisions already made

- **Photo minimums**: by pm_type (Major 3 / Filter 1 / Minor 1 / Test 0) with four template overrides
  (belt|sheave 3, lubricat|greas 2, check valve|strainer 2, water readings must contain a digit). Add rows as needed.
- **Note minimums**: Major 40 chars, others 15, stoplist applies. Combined across all notes on the task.
- **Low labor** is gated on the tech's week < 30 h (manager's call). Brandon G. and Austin M. sit at 31–32 h with 7 short closes each — borderline by design.
- **Batch close** only counts when the batch lacks photos; normal end-of-day paperwork closes are not flagged.
- **Cove task URL**: `https://manage.cove.is/networks/{network_id}/pm-tasks/{cove_task_id}?tab=task_steps`
  (tabs: `overview`, `task_steps`). Binney network = `moBABfC2ZR`; UPark network = `OoxMP8BZJF`.
  Add `sites.cove_network_id` and build the link from it.
- **Photo lightbox**: Cove opens photos in an overlay with prev/next + filmstrip; the review card should match.
- **Duplicate uploads**: PM-ROG-7497 appears to have the same 6 photos uploaded twice (12 attachments).
  Consider deduping by content hash in the poller so `photo_count` isn't inflated.
- **Photo URL auth**: public, verified (see §3).
- **`pm_type` on `pm_close_events`** is wrong (annuals typed Minor). The audit uses `classify_pm()` instead; the poller's classifier should be fixed separately.
- **Vision pass** (is the photo actually a sheave?) is phase 3, only on queued tasks.

---

## 7. Acceptance

- [ ] `pm_task_details` has rows for ≥ 95 % of `pm_close_events` where `cmms_type='recurring'` in the last 90 days.
- [ ] `select * from build_pm_audit_queue(<last Monday>, 5)` returns both sites.
- [ ] Queue page loads for the current week in < 1 s on Nano.
- [ ] Review card: all 12 photos for PM-ROG-7497 render; Save & next writes `pm_audit_reviews` and advances.
- [ ] Engineer login sees only their own rows; director sees everything read-only.
- [ ] Cron ran Sunday night (check `cron.job_run_details` for `pm_audit_weekly`).

---

## 8. As built (2026-11-17)

- **Hook**: `pm12_poller.py` calls `pull_close_details()` after the snapshot's bookkeeping; it takes the Cove
  ids straight from the closed fetch (no `pm_rows` lookup) and is capped at 150 tasks per run.
- **Backfill**: `v_pm_task_details_backlog` only sees closes whose task appeared in `pm_rows` after
  `cove_task_id` was added (0156, 2026-11-06) — 472 tasks, not ~5,900. Older closes are covered by
  `pm12_poller.py backfill-details [days]` (per site: `COVE_SITE=binney …`), which re-reads the closed list
  from Cove to get the ids. Safe to re-run; it fetches only what is still missing.
- **UI**: `web/src/routes/audit/` (`Queue`, `Review`, `Scorecard`), logic in `web/src/lib/pmAudit.ts`
  (tests: `node --experimental-strip-types web/src/lib/pmAudit.test.ts`), data in `web/src/hooks/usePmAudit.ts`.
  Routes `/audit`, `/audit/:week/:taskNo`, `/audit/scorecard`; the manager pages carry a `§05 PM audit` card.
- **Cove link**: network ids are a constant in `pmAudit.ts` (`COVE_NETWORK`), not a `sites` column — no schema change.
- **Review card** opens any closed recurring PM of the week, queued or not ("spot check").
- **Flags shown are live** (`v_pm_audit_flags`), so a queue frozen before the backfill shows more flags per
  row than it was queued for. The queue itself is not rebuilt by the UI.
