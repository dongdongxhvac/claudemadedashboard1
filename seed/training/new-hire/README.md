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
| The program as data — 8 weeks × verified items, rep tally, evals, cert | `web/src/lib/newHireProgram.ts` (transcribed from the sign-off sheet inside `new_hire_8_week_plan.html`; refers to handouts by manifest key) |
| Progress tables + RLS | `supabase/migrations/0128_new_hire_program.sql` (enrollment, check-offs, rep logs) + `0131_new_hire_doc_activity.sql` (engineer's own opened / quiz rows) |
| Data hooks | `web/src/hooks/useNewHire.ts` (progress + activity), `useTrainingDocs.ts` (documents from the print station), `useQuizWatcher.ts` (detects a finished quiz inside the viewer) |
| UI — the **sign-off sheet**, live (Admin › User Profiles → Training) | `web/src/components/NewHireProgramDrawer.tsx` — mirrors the printed sheet: header strip (new hire · mentor · manager · start), Week × Verified items with Initials + Date, PM rep tally boxes, COVE audit grid, Level-1 certification; then per-handout Reviewed / Quiz-passed ticks and the engineer's activity. "Assign training" for people with nothing assigned (program picker — only Plan B exists today). |
| UI — the **8-week schedule**, live (`/upark/training/new-hire`, "Training" link on the engineer home) | `web/src/routes/engineer/NewHireTraining.tsx` — the printed schedule with the mentor's sign-offs shown read-only on each week's CHECK OFF row, handout chips open the in-page viewer, quiz runs save automatically (best run shows beside the quiz item); UPark only |
| Original build notes for the handouts (conventions, site facts) | `HANDOFF.md` here |

## Decisions (2026-09-21)

- **Engineer view = the schedule printout, live; admin view = the sign-off sheet, live** (per user). No separate library page — the schedule links every handout in the week it belongs to.
- The Sep-21 schedule puts the **boiler plant in Week 2 and the chiller in Week 5** ("why boiler first"). Item keys `w2.boiler_24_verbals` / `w5.chiller_36_fault_drill` replaced the Aug-19 keys (no progress existed on them).
- Programs are data on the enrollment (`program_key`). Only Plan B can be assigned today; Licensed HVAC development and the 5 category tracks are listed as coming in the picker.

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

**Keys are permanent.** Quiz results, "opened" history and the mentor's ticks are stored
against a key derived from each document's TITLE (`keyForTitle` in
`web/src/hooks/useTrainingDocs.ts`: "HVAC Overview" → `hvac`, "Boiler — Find It & Tag It
(24)" → `boiler_tagit`, "Quiz Answer Key — MENTOR COPY" → `answer_key`, …; an unknown
title gets a slug of itself). So:
- retitle a document freely as long as it still matches its rule (the rule for `hvac`
  is "starts with *hvac overview*");
- a brand-new kind of document needs no rule — it appears under its group with a slug
  key. Add a rule only if you want a nicer key, and do it before anyone records against
  the slug;
- the program's weeks (`web/src/lib/newHireProgram.ts`) link documents by key. Three
  keys the weeks reference are NOT in the print station yet — `find_on_screen`
  (Week 6), `find_it_tag_it` (Weeks 7–8, the portfolio 117) and `level2` (Week 8).
  Their chips show "not in print station" until the documents are added to it.

Quiz auto-save rules (the dashboard watches each document's own counters, so the
documents are never edited): keep the ids `qDone`, `qTot`, `qRight`, `qReset`; a run is
saved when every question is answered, "Reset quiz" + answering again saves another run.
Documents in the print station are single pages, so the old `srcdoc`/`data:` caveat is
moot.

Mentor sign-off is separate from the engineer's score: the engineer's best run shows as
a chip; the mentor ticks **Reviewed** and **Quiz passed** per handout in the drawer, and the
weekly items stay as printed on the sign-off sheet.
