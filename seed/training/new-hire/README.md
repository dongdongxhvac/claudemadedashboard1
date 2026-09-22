# UPark New-Hire 8-Week Program — source material

Imported 2026-08-19 from Don's `~/Downloads/new hire 8 weeks training package/`
(the final Plan B set, printed + photographed that morning) plus a few
reference pages pulled from the older full working set
(`old1 8weeks new hire training.zip`, 08-17): `HANDOFF.md`, the quiz answer
key, the equipment glossary, the portfolio Find It & Tag It, Find It On Screen
(+ worked example) and the Level-2 curriculum.

## Where things live

| What | Where |
|---|---|
| **All training content — one file** | `web/public/training/new hire 8 weeks training package/new_hire_print_station.html` — the Print Station SPA embeds every document (27 today: schedule, sign-off sheet, week guides/checklists, both site maps, building check, 5 overviews, 8 equipment pages, worked example, glossary, terminology, answer key, manager SOP). Served as a static file under `/training/…`. The dashboard reads the documents out of it at load time. |
| How the dashboard reads it | `web/src/hooks/useTrainingDocs.ts` — parses the print station's `TITLES` / `DOCS` arrays and group headings, derives a permanent key per document from its title (alias rules in that file), detects quizzes (`id="qDone"`). |
| **The program definition** — groups, verified items, rep tally, COVE audit, certification | The **Master Sign-Off Sheet document inside the print station**, parsed at load time by `web/src/lib/signoffSheet.ts` (served by `hooks/useSignoffSheet.ts`). Nothing is transcribed into code. `web/src/lib/newHireProgram.ts` keeps only the week-from-start-date rule and the per-handout tick / note keys. |
| **The list of programs** (key, title, print station path) | `web/src/lib/programs.ts` — new-hire 8-week, Licensed HVAC development (print station at `web/public/training/licensed hvac development program/print_station.html`), 5 categories (coming). See "Adding a program". |
| Progress tables + RLS | `supabase/migrations/0128_new_hire_program.sql` (enrollment, check-offs, rep logs) + `0131_new_hire_doc_activity.sql` (engineer's own opened / quiz rows) + `0132_training_programs_per_person.sql` (everything keyed per person **and program**) |
| Data hooks | `web/src/hooks/useNewHire.ts` (progress + activity), `useTrainingDocs.ts` (documents from the print station), `useQuizWatcher.ts` (detects a finished quiz inside the viewer) |
| UI — the **sign-off sheet**, live (Admin › User Profiles → Training) | `web/src/components/NewHireProgramDrawer.tsx` + `LiveDoc.tsx` — one tab per assigned program; in each, the actual sheet document rendered in the drawer: click an item's Initials/Date cell to verify (your initials + date), NOTES to add a note (independent of the initials), rep tally / COVE boxes to tick, signature lines to sign. "+ Assign training" (program · start · mentor) adds another program. Header links: the program's Print station, a blank sheet. |
| UI — the engineer's page (`/upark/training/new-hire`, "Training" link on the engineer home) | `web/src/routes/engineer/NewHireTraining.tsx` + `LiveDoc.tsx` — one tab per assigned program (nothing assigned → the new-hire material, read only); inside: the program's **Schedule** document when it has one (file chips open the handout; Check off ticks mirror the mentor's sign-offs), **My sign-off record** (the sheet, read-only, filled in), All handouts. Quiz runs save automatically from the viewer under that program. UPark only. |
| Career timeline on the engineer profile (`/engineer/:id/profile`) | `web/src/lib/careerTimeline.ts` turns the training records above (enrolled, weeks signed off, quiz passes, reps, certified) plus hiring date, PMs, on-call, overtime, PTO counts and admin-entered events (`career_events`, migration 0133) into one dated stream; `certifications` (0133) holds licenses with expiry. Components in `web/src/components/profile/`. |
| Original build notes for the handouts (conventions, site facts) | `HANDOFF.md` here |

## Decisions (2026-09-21)

- **Engineer view = the schedule printout, live; admin view = the sign-off sheet, live** (per user). No separate library page — the schedule links every handout in the week it belongs to.
- The Sep-21 schedule puts the **boiler plant in Week 2 and the chiller in Week 5** ("why boiler first"). Item keys `w2.boiler_24_verbals` / `w5.chiller_36_fault_drill` replaced the Aug-19 keys (no progress existed on them).
- Programs are data on the enrollment (`program_key`), and a person can be in more than one (2026-09-22, migration 0132). New-hire 8-week and Licensed HVAC development are assignable; the 5 category tracks are listed as coming in the picker.

## Decisions (2026-08-19)

- **Plan B (interleaved 8-week schedule) is canonical.** The older phase
  tracker's two-phase split (Foundations wk 1–4 / Development wk 5–8) is not
  the model; its categories (Safety / Ops / Orientation / Controls / PM /
  Theory) survive only as colour tags on items.
- Item keys in `newHireProgram.ts` are permanent — progress is keyed on them.
  Change labels freely; never rename a key.
- Handouts are hosted inside the dashboard (works on the kiosk/phones, no
  Downloads dependency). To update a handout, replace the file in the package
  folder under `web/public/training/` (see "How to add or update training").

## How to add or update training (2026-09-21)

**One file.** The dashboard takes every handout from
`web/public/training/new hire 8 weeks training package/new_hire_print_station.html`.
Change that file, push to `master` — Vercel deploys, and the schedule page, the sign-off
sheet and the viewer pick the documents up. No other file to edit.

Two ways to change it:

1. **Rebuild the whole print station** (the way it was made in Claude chat) and overwrite
   the file. Fine when many documents change.
2. **Edit one document** with the tool in this folder — the documents are base64 inside
   the file, so you can't edit them directly:
   ```
   python3 seed/training/new-hire/print_station.py unpack      # → seed/training/new-hire/print-station-src/ (27 .html files + index.json)
   #   replace 09_hvac_overview.html with the new build, or edit it in place;
   #   add a document: drop the .html in the folder + add an entry to index.json (file, title, group);
   #   remove / reorder / retitle / regroup: edit index.json
   python3 seed/training/new-hire/print_station.py pack        # rebuilds the print station in place
   python3 seed/training/new-hire/print_station.py list        # what's inside, with the dashboard keys
   ```
   Then commit the print station and push. `print-station-src/` is git-ignored scratch —
   the print station itself stays the only source of truth.

What the dashboard reads from it:
- `const TITLES=[…]` and `const DOCS=[…]` (base64, index-aligned) — the documents;
- the list's group headings (`.grp` / `.row[data-g]`) — the shelf a document sits on
  (`Mentor only` is hidden from engineers);
- `id="qDone"` inside a document — it has a quiz the dashboard records.

**The sign-off sheet is the program.** Its groups (`tbody.wkgrp`), items (`tbody.pair`
rows), rep tally (P/D/S or plain boxes), COVE audit boxes and signature lines are what the
dashboard records against. Keys: item = `<group>.<slug of the item text>` (e.g.
`wk1.all_assigned_workday_trainings_complete`, `admin_first_day_on_site.uniform_issued`),
rep = `rep.<slug of the label>`, `cove.<n>`, `cert.new_hire|mentor|manager`. **Rewording an
item changes its key** — the mentor re-ticks it (the old tick stays in the DB, harmless);
reordering, regrouping or adding items is free. The sheet's markup (classes `idrow`, `wkgrp`,
`wkhead`, `wkeys`, `pair`, `init`, `date`, `noter`, `reps`, `box`, `lv`, `cert`, `sig`,
`sigline`, `sigk`) must survive a rebuild — if it doesn't, both pages show a parse error
instead of a blank record. The schedule's Check off ticks are matched to sheet items by
words (same week); a tick with no close item shows as "not tracked" — harmless.

**Document keys are permanent.** Quiz results, "opened" history and the per-handout ticks are
stored against a key derived from each document's TITLE (`keyForTitle` in
`web/src/hooks/useTrainingDocs.ts`: "HVAC Overview" → `hvac`, "Boiler — Find It & Tag It
(24)" → `boiler_tagit`, "Quiz Answer Key — MENTOR COPY" → `answer_key`, …; an unknown
title gets a slug of itself). So:
- retitle a document freely as long as it still matches its rule (the rule for `hvac`
  is "starts with *hvac overview*");
- a brand-new kind of document needs no rule — it appears under its group with a slug
  key. Add a rule only if you want a nicer key, and do it before anyone records against
  the slug;
- the schedule's file chips (`new_hire_hvac_overview.html` …) map to documents by file
  name (`docKeyForFile` in `signoffSheet.ts`); a chip whose document is not in the print
  station stays plain (today: `new_hire_find_it_on_screen.html`,
  `training_level2_curriculum.html`).

Quiz auto-save rules (the dashboard watches each document's own counters, so the
documents are never edited): keep the ids `qDone`, `qTot`, `qRight`, `qReset`; a run is
saved when every question is answered, "Reset quiz" + answering again saves another run.
Documents in the print station are single pages, so the old `srcdoc`/`data:` caveat is
moot.

Mentor sign-off is separate from the engineer's score: the engineer's best run shows as
a chip; the mentor ticks **Reviewed** and **Quiz passed** per handout in the drawer, and the
weekly items stay as printed on the sign-off sheet.

## Adding a program (2026-09-22)

Every program is the same two things: **one Print Station file** and **one entry in
`web/src/lib/programs.ts`**. The Licensed HVAC Development Program is already listed there
and expects its print station at

```
web/public/training/licensed hvac development program/print_station.html
```

Until that file exists, the admin drawer and the engineer page show "Print station … not
found yet — expected at …" for it (it can still be assigned). Drop the file in, push, done.

Rules for the print station of any program:
- same format as the new-hire one (a Print Station SPA: `const TITLES=[…]` / `const DOCS=[…]`,
  the document list with `.row[data-g]` groups) — build it in chat the same way;
- it must contain a document titled **Master Sign-Off Sheet** in the sheet markup described
  above (groups, items, rep tally, COVE audit, signature lines — any subset is fine, an empty
  section is skipped). That sheet IS the program: the drawer and the engineer's record are
  rendered from it, and progress is counted from its items;
- a document whose title ends in "Schedule" (key `plan`) is optional — it becomes the
  engineer's first tab; without one the record tab comes first;
- document keys, item keys and quiz detection work exactly as above (same `keyForTitle`
  rules; new titles get slug keys).

To register a new program: add an entry to `PROGRAMS` in `web/src/lib/programs.ts`
(`key` — permanent, stamped on every record; `title`; `short` — the roster pill / tab label;
`printStation` — its URL under `web/public`; `available: true`) and add a
`useSignoffSheet(PROGRAMS[n])` line in `web/src/routes/admin/UserProfilesTab.tsx` next to
the existing two (that page needs each sheet for the roster pills' percentages). To turn a
"coming" program on, set `available: true` and give it a `printStation`.

`print_station.py` works on any print station — pass the file:
```
python3 seed/training/new-hire/print_station.py --station "web/public/training/licensed hvac development program/print_station.html" --src /tmp/hvac-src unpack
python3 seed/training/new-hire/print_station.py --station "web/public/training/licensed hvac development program/print_station.html" --src /tmp/hvac-src pack
```
