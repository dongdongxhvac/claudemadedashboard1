# Plan — COVE MEP Ops Platform: Role-based UI, RPG Engineer Profiles, Auto-ingested Supabase Data

## Context

Today, [cove_pm_dashboard_REAL_DATA_v5.html](cove_pm_dashboard_REAL_DATA_v5.html) is a 2,311-line single-page app that does everything client-side: drop three CSVs (PM12, Labor, WOs) → PapaParse → render sections A1–A9 per [layout.md](layout.md), plus TV mode 1 and TV mode 2. Data is ephemeral. There is no auth, no roles, no persistence, no per-user view.

The new system is a full MEP operations platform. The data still starts in CSVs downloaded into a local folder, but everything else becomes a multi-role cloud app:

- **Four role-based views**, each with its own info architecture. **All four use the V5 visual format** (same typography, colours, section layout, stat strips, tables, charts) — only one screen breaks from V5:
  - **Manager view** — the V5 dashboard, expanded: all PMs/WOs across all buildings, all engineers, all snapshots; assign, override, push announcements.
  - **Engineer view** — V5-format work list (own PMs, WOs, today's round, on-call status). The **engineer profile sub-page is the only RPG-styled screen** in the entire app: skill tree, XP bar, badges, levels. Visible to: the engineer themselves, and users with sufficient `access_level` (managers + admins).
  - **Client view** — read-only V5-format for tenants/owners: status of buildings they own/lease, scheduled PMs, open WOs affecting their space.
  - **Admin view** — V5-format config panels: users, buildings, rounds, on-call rotations, SOPs, skill-tree definitions, access control, audit log.
- **Three display modes** (responsive variants of each view where it makes sense):
  - **PC mode** — full-density layout, primary surface for Manager / Admin / Client.
  - **Mobile mode** — phone-first layout, primary surface for Engineer (in the field) and on-the-go Manager/Client checks.
  - **TV mode** — always-on display for Manager (ops huddle TV) and Engineer (shift handoff TV).
- **Auto-ingest** — drop a CSV into the local `CSV DB/` folder; a watcher service classifies, parses, and inserts into Supabase. TV/mobile/PC views update in realtime.
- **Persistent state** — every snapshot retained for trend analysis. Engineer profiles, building maps, rotations, SOPs, alarms all live in Postgres.

User's confirmed choices: **Supabase + realtime** for the data layer, **auto file-watcher** for ingest, **rebuild as React/Vite**, **all CSV history retained**, **standalone watcher service**, **hosted on Vercel**, **mobile = engineer view (read-only of their own data)**.

---

## Role × View × Mode matrix

| View ↓ \ Mode → | PC | Mobile | TV |
|---|---|---|---|
| **Login** | ✓ | ✓ | — |
| **Manager** | ✓ primary (V5-style dashboard, all-up) | ✓ glance + light control | ✓ ops huddle screen |
| **Engineer** | ✓ profile + work list (desk view) | ✓ **primary** (field) — read-only own data | ✓ shift handoff (today's PMs by tech) |
| **Client** | ✓ primary | ✓ glance for their buildings | — |
| **Admin** | ✓ primary | — (emergency only) | — |

Each row maps to a route family; the mode is selected by viewport breakpoint + an explicit `?mode=tv` flag for the always-on screens.

---

## Architecture

```
┌─────────────────────── LOCAL PC ───────────────────────┐
│   CSV DB/  ──watchdog──►  watcher service (Python)     │
│   (drop CSVs)             classify · parse · upsert    │
└──────────────────────────│──────────────────────────────┘
                           ▼ HTTPS (supabase-py, service key)
┌─────────────────────── SUPABASE ───────────────────────┐
│   Postgres (schema below) · Realtime · Storage · Auth   │
└────────────────────────▲ ▲ ▲ ▲ ▲────────────────────────┘
                         │ │ │ │ │  Realtime + REST
   ┌─────────────────────┘ │ │ │ └──────────────────┐
   │       ┌───────────────┘ │ └─────┐              │
   │       │                 │       │              │
┌────────────┐  ┌────────────┐  ┌──────────┐  ┌─────────┐  ┌──────────┐
│ /login     │  │ /manager   │  │/engineer │  │ /client │  │ /admin   │
│            │  │ PC/Mob/TV  │  │PC/Mob/TV │  │ PC/Mob  │  │ PC       │
└────────────┘  └────────────┘  └──────────┘  └─────────┘  └──────────┘
   (Vercel — single React/Vite app, role-aware routing)
```

---

## Data layer (Supabase)

Tables grouped by domain. All have `created_at` / `updated_at` defaults.

### A. Snapshots & CSV ingest (the old data)

| Table | Purpose | Key columns |
|---|---|---|
| `snapshots` | One per ingested CSV | `id`, `kind ('pm12'\|'labor'\|'wo')`, `taken_at`, `filename`, `row_count` |
| `pm_rows` | Every row from every PM12 snapshot | `snapshot_id`, `task_no`, `due_date`, `site`, `building_code`, `equipment`, `name`, `interval`, `status`, `assigned_to_name`, `est_labor_hours`, `labor_hours`, `pm_type` (derived), `object_id` |
| `labor_rows` | Weekly hours by tech | `snapshot_id`, `assigned_to_name`, `labor_hours`, `week_start` |
| `wo_rows` | Work-order rows | `snapshot_id`, `wo_id`, `status`, `assigned_to_name`, `description`, `submitted_date`, `required_due_date`, `building_code`, `is_open` (derived) |
| `ingestion_log` | Audit trail | `id`, `filename`, `kind`, `status`, `rows`, `error_msg`, `at` |

Indexes: `(snapshot_id)`, `(snapshot_id, due_date)`, `(assigned_to_name)`, `(building_code)`, `(status)`.

### B. People (RPG-style profiles)

| Table | Purpose | Key columns |
|---|---|---|
| `users` | Auth + role + identity | `id (uuid, = auth.uid)`, `email`, `full_name`, `role ('engineer'\|'manager'\|'client'\|'admin')`, `access_level (1-5)`, `hiring_date`, `avatar_url`, `active` |
| `engineer_profiles` | RPG fields for engineers | `user_id (pk)`, `cmms_assignee_name` (joins to `pm_rows.assigned_to_name`), `discipline ('M'\|'E'\|'P'\|'BMS'\|'FLS')`, `level` (overall, 1–10), `xp` (int, derived from completed PMs/WOs/SOPs), `skill_tree (jsonb)`, `certifications (text[])`, `badges (jsonb)` |
| `client_profiles` | Tenant/owner info | `user_id (pk)`, `company`, `accessible_building_ids (uuid[])` |
| `sops` | Standard operating procedures library | `id`, `title`, `category`, `body_md`, `version`, `active`, `min_level (int)` |
| `user_sop_signoffs` | Who's signed off on what | `user_id`, `sop_id`, `signed_off_at`, `signed_off_by`, pk `(user_id, sop_id)` |

**`skill_tree` shape** (jsonb on `engineer_profiles`):
```json
{
  "hvac":       {"level": 4, "xp": 1240, "unlocked_at": "2024-08-12", "perks": ["filter-king","chiller-cert"]},
  "electrical": {"level": 2, "xp": 380,  "unlocked_at": "2025-02-01", "perks": []},
  "plumbing":   {"level": 3, "xp": 720,  "unlocked_at": "2024-11-04", "perks": ["backflow"]},
  "bms":        {"level": 1, "xp": 90,   "unlocked_at": "2026-01-15", "perks": []},
  "fire_life_safety": {"level": 2, "xp": 220, "unlocked_at": "2025-06-01", "perks": ["sprinkler-trim"]}
}
```
XP awarded by triggers: PM completed → +XP in matching discipline (via `pm_type` → discipline map). SOP signoff → unlock perk. Manager can manually grant XP/perks via Admin view.

### C. Buildings & assignments

| Table | Purpose | Key columns |
|---|---|---|
| `buildings` | Master list | `id`, `code` (joins `pm_rows.building_code`), `name`, `address`, `active`, `client_company` |
| `building_assignments` | Who covers which building | `building_id`, `user_id`, `role_in_building ('primary'\|'backup'\|'manager')`, `starts_on`, `ends_on (nullable)`, pk `(building_id, user_id, role_in_building, starts_on)` |

### D. Rounds (regular building walks)

| Table | Purpose | Key columns |
|---|---|---|
| `rounds` | Defined patrol routes | `id`, `name`, `building_id`, `schedule_cron`, `estimated_minutes`, `checklist (jsonb)` |
| `round_assignments` | Who runs which round when | `round_id`, `user_id`, `starts_on`, `ends_on`, pk `(round_id, user_id, starts_on)` |
| `round_log` | Each completed walk | `id`, `round_id`, `user_id`, `completed_at`, `notes`, `findings (jsonb)`, `wo_created (text[])` |

### E. On-call rotation

| Table | Purpose | Key columns |
|---|---|---|
| `oncall_rotations` | Week-by-week schedule | `id`, `week_start (date)`, `primary_user_id`, `secondary_user_id`, `notes` |

A view `current_oncall` returns this week's row for fast lookup.

### F. Equipment & downtime

| Table | Purpose | Key columns |
|---|---|---|
| `equipment` | Master equipment list | `id`, `cmms_object_id` (joins `pm_rows.object_id`), `name`, `building_id`, `category`, `discipline`, `status ('operational'\|'degraded'\|'down'\|'maintenance')` |
| `equipment_down` | Active + historical downtime events | `id`, `equipment_id`, `reported_by`, `reported_at`, `resolved_at (nullable)`, `reason`, `workaround`, `priority ('low'\|'med'\|'high'\|'critical')`, `related_wo_id` |

### G. Focus board

| Table | Purpose | Key columns |
|---|---|---|
| `focus_board_items` | Unified pinned-items feed | `id`, `kind ('announcement'\|'alarm'\|'priority'\|'reminder')`, `title`, `body`, `level ('info'\|'warn'\|'urgent'\|'critical')`, `pinned`, `starts_at`, `expires_at`, `created_by`, `target_buildings (uuid[])`, `target_users (uuid[])`, `meta (jsonb)` |
| `alarm_reviews` | BMS / fire / etc. alarms to review | `id`, `alarm_external_id`, `building_id`, `equipment_id`, `triggered_at`, `reviewed_by (nullable)`, `reviewed_at (nullable)`, `classification ('real'\|'false'\|'recurring'\|'maint')`, `action_taken`, `notes` |

`focus_board_items` is the single feed surfaced on Manager TV, Engineer Mobile, and Client PC. Filtered by `target_*` arrays + the viewer's role/building access.

### H. Settings & overrides

| Table | Purpose | Key columns |
|---|---|---|
| `settings` | Tunable config | `key`, `value (jsonb)`, `updated_at` — e.g. `active_pm_snapshot_id`, `overdue_threshold_days`, `tv_sections_visible`, `xp_rules` |
| `overrides` | Manual data corrections layered on top of CSV | `row_kind`, `row_key`, `field`, `value`, `note`, `set_by`, `set_at`, `expires_at` |

### Views

- `current_pm_snapshot`, `current_labor_snapshot`, `current_wo_snapshot` — latest (or `settings.active_*_snapshot_id`) per kind, joined with overrides applied.
- `engineer_dashboard` — per-engineer aggregate: today's PMs, today's WOs, this week's rounds, on-call status, XP earned this week, building they cover.
- `client_dashboard` — per-client aggregate: their buildings' open PMs, overdue PMs, recent WOs, scheduled work.
- `manager_overview` — totals across the org: PMs by status, WOs by status, equipment down count, alarm review backlog.

### RLS policies

- `anon` — no access (every view requires login except `/login`).
- `engineer` — SELECT on their own row in users / engineer_profiles, SELECT on `current_*_snapshot` filtered by `assigned_to_name = my cmms_assignee_name`, SELECT on `focus_board_items` where they're targeted, SELECT on their building/round assignments. No INSERT/UPDATE on data.
- `manager` — full SELECT, INSERT/UPDATE on overrides/settings/focus_board/announcements/equipment_down/alarm_reviews.
- `client` — SELECT only, scoped to `accessible_building_ids`.
- `admin` — full access.
- Watcher uses `SERVICE_ROLE_KEY`, bypasses RLS.

### Realtime

Publication enabled on: `snapshots`, `current_*_snapshot` (where supported), `overrides`, `settings`, `focus_board_items`, `equipment_down`, `alarm_reviews`, `oncall_rotations`.

---

## Local watcher service (`watcher/`)

Unchanged from previous plan — standalone Python process using `watchdog`, separate from [cove_pm_daily.py](cove_pm_daily.py), reusing `classify_pm()` from cove_pm_daily.py:81.

Layout:
```
watcher/
├── main.py              # watchdog loop, dispatch by filename
├── ingest_pm12.py       # parse + insert pm_rows (also computes pm_type/discipline)
├── ingest_labor.py
├── ingest_wo.py
├── supabase_client.py   # supabase-py wrapper, service-role key
├── classify.py          # reuse classify_pm() verbatim
├── xp_calc.py           # award XP to engineers based on completed PMs in new snapshot
├── requirements.txt
└── .env                 # SUPABASE_URL, SUPABASE_SERVICE_KEY, WATCH_DIR
```

Watcher logic adds one step over the original plan: when a new PM12 snapshot lands, diff against the previous snapshot to find newly-completed PMs → award XP to the engineer (resolve via `cmms_assignee_name` → `engineer_profiles.user_id`).

Run as a Windows service via NSSM. README documents install.

---

## Frontend (`web/`)

**Stack:** Vite + React 18 + TypeScript + React Router + TanStack Query + supabase-js + Chart.js + Tailwind (or port V5's CSS variables — design TBD by you).

### Route map

```
/login                           public — magic link
/                                role redirect (engineer → /engineer/me, client → /client, manager → /manager, admin → /admin)
/manager                         PC dashboard (V5 manager view)
/manager?mode=tv                 ops huddle TV (full-screen, ~tv=2 layout, focus board overlay)
/manager?mode=mobile             auto-switched on phones; condensed
/engineer/me                     redirects to /engineer/:myUserId
/engineer/:userId                personal page — V5-style work list + round + SOP list
/engineer/:userId/profile        **RPG-styled** profile (level, XP, skill tree, badges) — access-gated
/engineer?mode=tv                shift handoff TV — today's PMs grouped by tech across the team
/engineer?mode=mobile            auto on phones — read-only own data only (per your spec)
/client                          client home — buildings + open work in their scope
/client?mode=mobile              condensed
/admin                           admin panel (users, buildings, rounds, on-call, SOPs, skill rules)
/print/:assignee/:equipment      printable PM list (existing B1–B6, ported)
```

Mode selection: route reads `?mode=` first, then falls back to viewport (`< 700px` → mobile, `> 1600px && fullscreen` → tv hint).

### Shared component library

Extracted from V5, reused across views:

All components below match V5's visual language (CSS variables, typography, table/card styles). The only RPG-styled component is `<SkillTree>`, used exclusively on the engineer profile sub-page.

| Component | Used in | Style |
|---|---|---|
| `<Header>` | All | V5 |
| `<StatStrip>` (PMs counts) | Manager, Engineer (own counts), Client (their building counts) | V5 |
| `<WeeklyCompletions>` | Manager TV/PC, Engineer TV | V5 |
| `<OpenPmsBreakdown>` | Manager | V5 |
| `<DueNowList>` (PM + WO grouped by assignee) | Manager TV | V5 |
| `<DueThisMonth>` | Manager, Client | V5 |
| `<FocusBoard>` (announcements + alarms + priorities) | Manager TV, Engineer Mobile, Client PC | V5 |
| `<EquipmentDownList>` | Manager, Engineer (own building) | V5 |
| `<MyWorkList>` (PMs + WOs filtered to user) | Engineer Mobile/PC | V5 (plain list/table) |
| `<RoundChecklist>` | Engineer Mobile | V5 |
| `<OncallBadge>` | Header (everywhere) | V5 |
| `<AnnouncementComposer>` | Manager, Admin | V5 |
| `<PrintableList>` | Manager (B1–B6) | V5 |
| **`<EngineerProfile>`** | Only `/engineer/:userId/profile` | **RPG** — level header, XP bar, badges grid, `<SkillTree>` |
| `<SkillTree>` | Inside `<EngineerProfile>` only | RPG branches (HVAC / E / P / BMS / FLS) |

### View-specific composition

**Manager view (PC)** — closest to today's V5 + extras:
- Top: `<StatStrip>` org-wide + `<OncallBadge>` for this week
- §00 `<WeeklyCompletions>`, §01 `<OpenPmsBreakdown>`, §02 `<DueNowList>`, §03 `<DueThisMonth>`
- Sidebar: `<FocusBoard>` (compose announcements, review alarms)
- New tab: `<EquipmentDownList>` (active downtimes, link to WOs)

**Manager view (TV)** — pure display, no inputs:
- Full-screen `tv=2`-style layout
- Includes `<FocusBoard>` overlay banner at top
- Subscribes to all realtime channels

**Engineer view (PC)** — desk page for a tech, V5 visual format:
- V5-style header with name + on-call status + a small "View profile →" link (which opens the RPG profile sub-page)
- `<MyWorkList>` (PMs assigned, WOs assigned) — same table/card style as V5 §02
- `<RoundChecklist>` (today's round, with check-off interaction)
- SOP library — V5 list style; filter to SOPs they've signed off + ones they're eligible for

**Engineer profile sub-page (`/engineer/:userId/profile`)** — **the only RPG-styled screen**:
- Big level header + XP-to-next-level bar
- Badges grid
- `<SkillTree>` (HVAC / E / P / BMS / FLS branches)
- SOP signoff history
- **Access control:** the engineer themselves can view their own profile. Other users can view it only if their `access_level >= 3` (manager, admin) — enforced by RLS on `engineer_profiles` and by route guard.

**Engineer view (Mobile)** — V5-format, **read-only**:
- Bottom-nav: Now / Mine / Profile
  - **Now** — today's PMs/WOs, current on-call, today's `focus_board_items` targeted at them or their building (V5 card style)
  - **Mine** — full list of their assigned PMs + open WOs, sortable by due date (V5 list style)
  - **Profile** — links into the RPG-styled engineer profile sub-page (the only RPG screen in mobile)
- No edit/control. No assignee picker — locked to the logged-in user.

**Engineer view (TV)** — shift handoff, V5 format:
- Today's PMs grouped by tech (V5 cards, same as `?tv=2` §02)
- Each card: tech name, today's PM count, on-call indicator (no level/XP — TV stays V5)
- Focus board banner at top

**Client view (PC)** — read-only:
- Their buildings list with status pills (PMs on track / overdue count / WOs open)
- Per-building drill-in: scheduled work this month, recent completions, open WOs affecting their space
- Focus board filtered to `target_buildings` they own

**Client view (Mobile)** — condensed single-column same data.

**Admin view (PC)** — config:
- Users tab: create/edit users, assign role, set access level, hire date, edit `cmms_assignee_name`
- Buildings tab: master list, building assignments
- Rounds tab: define rounds + schedule, assign to users
- On-call tab: week-by-week rotation editor, calendar view
- SOPs tab: write/edit SOPs in markdown, version control, signoff log
- Skill-tree rules tab: edit XP awards by PM type, define perk unlocks
- Audit log tab: who changed what when (ingestion_log + override history)

### Auth & role routing

- Supabase Auth, email magic link.
- On login, fetch `users` row → cache role in React context.
- `<RoleGate role="manager|admin">` wrapper redirects unauthorized users to their own home.
- Mobile engineer view loaded automatically on `/` for engineer-role users on small screens.

### PWA

- `manifest.json` with two start-URL options (engineer vs. manager) — but a single installable PWA. Service worker caches the app shell, falls through to network for data.

### Source layout

```
web/
├── index.html
├── vite.config.ts
├── public/
│   ├── manifest.json
│   └── icons/...
├── src/
│   ├── main.tsx                       (router + auth provider)
│   ├── lib/
│   │   ├── supabase.ts                (client factory, role-aware)
│   │   ├── types.ts                   (DB types, generated via Supabase MCP)
│   │   └── roleGate.tsx
│   ├── hooks/
│   │   ├── useCurrentSnapshots.ts
│   │   ├── useRealtime.ts
│   │   ├── useMe.ts                   (current user + role + engineer_profile)
│   │   ├── useFocusBoard.ts
│   │   ├── useOncall.ts
│   │   └── useSettings.ts
│   ├── components/                    (shared library — table above)
│   ├── routes/
│   │   ├── Login.tsx
│   │   ├── manager/{Pc,Tv,Mobile}.tsx
│   │   ├── engineer/{Pc,Tv,Mobile}.tsx
│   │   ├── client/{Pc,Mobile}.tsx
│   │   ├── admin/{Users,Buildings,Rounds,Oncall,Sops,SkillRules,Audit}.tsx
│   │   └── Printable.tsx
│   └── styles/dashboard.css           (port V5 CSS variables)
└── package.json
```

---

## Files to create / modify

**New:**
- `watcher/` — full Python service (see layout above)
- `web/` — full Vite project
- `supabase/migrations/0001_init_csv.sql` (tables A)
- `supabase/migrations/0002_people.sql` (tables B)
- `supabase/migrations/0003_buildings_rounds.sql` (C–E)
- `supabase/migrations/0004_equipment_focus.sql` (F–G)
- `supabase/migrations/0005_settings_views.sql` (H + views)
- `supabase/migrations/0006_rls.sql` (RLS policies)

**Reuse:**
- [cove_pm_daily.py](cove_pm_daily.py) — `classify_pm()` (line 81) → `watcher/classify.py`. PM12 download flow stays as-is.
- [layout.md](layout.md) — authoritative section codes for Manager TV layout.
- [cove_pm_dashboard_REAL_DATA_v5.html](cove_pm_dashboard_REAL_DATA_v5.html) — port section render logic 1:1 into React components.

**Untouched during build:**
- V5 HTML stays as a fallback display until cutover.

---

## Build order

Each step is independently verifiable. Phases group related steps; phases can be paused between.

### Phase 1 — Data pipeline (no UI yet)
1. Supabase project + tables A (snapshots/PM/labor/WO) + RLS basic
2. Watcher MVP — PM12 only — drop a CSV, see rows
3. Watcher full — Labor + WO + raw archive to Storage + ingestion_log
4. Install watcher as Windows service (NSSM); verify survives reboot

### Phase 2 — Manager view first (replaces V5)
5. Vite scaffold + Supabase Auth (magic link) + role redirect
6. Manager PC view: port V5 sections one at a time (§00, §02, §03, §01)
7. Realtime wiring — change a Supabase row, watch UI update with no refresh
8. Manager TV mode (`?mode=tv`) — full-screen `tv=2` layout
9. Manager overrides + settings + announcements (focus board basic)
10. Cutover: replace V5 bookmark with `…vercel.app/manager?mode=tv`

### Phase 3 — Engineer view + RPG profile sub-page
11. Tables B (users, engineer_profiles, sops) + seed your engineers from current CSV `assigned_to_name` distinct list
12. Engineer Mobile (read-only, V5-format, bottom-nav: Now / Mine / Profile) — primary surface for techs in field
13. Engineer PC view (V5-format desk page with `<MyWorkList>` + `<RoundChecklist>`)
14. RPG profile sub-page at `/engineer/:id/profile` — `<EngineerProfile>` + `<SkillTree>` + access gate
15. XP calculator hook in watcher (awards XP on PM completion)
16. Engineer TV (V5-format shift handoff screen — today's PMs by tech, no RPG flourishes)

### Phase 4 — Buildings, rounds, on-call
17. Tables C–E (buildings, building_assignments, rounds, round_assignments, round_log, oncall_rotations)
18. Admin: Buildings tab + Rounds tab + Oncall tab editors
19. `<OncallBadge>` in header everywhere; round checklist in Engineer Mobile

### Phase 5 — Equipment, alarms, full focus board
20. Tables F–G (equipment, equipment_down, focus_board_items, alarm_reviews)
21. Manager: `<EquipmentDownList>` + alarm review queue
22. Focus board v2: multi-kind feed, targeted by building/user, surfaced everywhere

### Phase 6 — Client view + Admin polish
23. `client_profiles` + RLS for client role
24. Client PC view (their buildings only)
25. Admin Users / SOPs / Skill rules / Audit tabs

### Phase 7 — PWA + polish
26. Manifest + service worker; install instructions for phone home-screen + TV kiosk mode

Phases 1–2 deliver immediate value (the V5 replacement). Phases 3+ build out the platform.

---

## Verification

Per phase:

**Phase 1.** `mcp__386a4827…__list_tables` shows tables A; dropping `COVE PM12 2026-05-14 6am.csv` into `CSV DB/` creates a `snapshots` row + matching `pm_rows` count; raw CSV appears in Storage; reboot → watcher resumes.

**Phase 2.** Manager PC view shows the same totals as V5 for the same snapshot. Run `update settings set value = '...' where key='banner_level'` in Supabase SQL → banner colour changes on Manager TV in < 1s, no refresh. V5 retired.

**Phase 3.** Log in as engineer on phone → see only your own PMs/WOs; cannot see another engineer's data (RLS verified by attempting a direct PostgREST call). Complete a PM in next snapshot → XP increments on profile.

**Phase 4.** Define a building + assign engineers; on-call rotation for this week renders in header; engineer's mobile Now tab shows today's round checklist.

**Phase 5.** Manager marks equipment down → engineer assigned to that building sees it in their Now tab in < 1s. Manager posts focus-board item targeted at one building → only users with access to that building see it.

**Phase 6.** Client logs in → sees only their buildings; attempts to query another building via REST → RLS blocks.

**Phase 7.** Phone "Add to home screen" launches engineer view fullscreen offline-capable shell; TV kiosk mode auto-launches Manager TV on boot.

---

## Out of scope (call out for later)

- Push notifications to phone (Web Push) — deferred to post-Phase 7.
- BMS direct integration (live alarm feed instead of manual entry) — would replace CSV-style alarm ingest with a webhook; design hook in `alarm_reviews` already supports it.
- Multi-tenant isolation if you ever onboard another customer.
- Auto-downloading CSVs from the CMMS — covered by existing [cove_pm_daily.py](cove_pm_daily.py) and the three Chrome extensions; this plan only handles ingest *after* CSV lands.
