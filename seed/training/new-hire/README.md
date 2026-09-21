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
| The handouts themselves (23 self-contained HTML pages) | `web/public/training/new hire 8 weeks training package/` (the Sep-21 package: 5 overviews, 4 equipment SPAs, plan, site maps, building check, print station, terminology, answer key, plus five Aug-19 pages carried over — glossary, Find It & Tag It, Find It On Screen + example, Level-2 curriculum — because the sign-off items link them). Served as static files under `/training/…` (Vercel serves real files before the SPA rewrite). The folder is whatever `base` in the manifest says. |
| **The handout list (what the dashboard shows)** | `web/public/training/manifest.json` — see "How to add or update training" below |
| The program as data — 8 weeks × verified items, rep tally, evals, cert | `web/src/lib/newHireProgram.ts` (transcribed from the sign-off sheet inside `new_hire_8_week_plan.html`; refers to handouts by manifest key) |
| Progress tables + RLS | `supabase/migrations/0128_new_hire_program.sql` (enrollment, check-offs, rep logs) + `0131_new_hire_doc_activity.sql` (engineer's own opened / quiz rows) |
| Data hooks | `web/src/hooks/useNewHire.ts` (progress + activity), `useTrainingManifest.ts` (handout list), `useQuizWatcher.ts` (detects a finished quiz inside the viewer) |
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

The dashboard reads `web/public/training/manifest.json` at runtime — no TypeScript
change for any of these. Push to `master` and Vercel deploys it.

| I want to… | Do this |
|---|---|
| **Replace a handout** with a newer build | Overwrite the file, same name. Done. |
| **Add a handout** | Drop the HTML into the folder and add one entry to `docs`: `{ "key": "…", "label": "…", "file": "…html", "group": "overview\|equipment\|field\|reference\|program\|mentor", "week": 3, "quiz": true }` |
| **Move / rename the package folder** | Copy the files there, set `base` to the new folder (spaces are fine — the current one is `/training/new hire 8 weeks training package`), fix each `file` if names changed, delete the old folder. |
| **Retire a handout** | Delete its entry. Recorded quiz results and sign-offs stay in the database under its key. |
| **Rename a handout** | Change `label` only. **Never change `key`** — quiz results, "opened" history and the mentor's ticks are all stored against it. |
| Hide a handout from engineers | `"group": "mentor"` (answer key etc.). |
| Turn the mentor ticks off for a print-only sheet | `"signoff": false`. |

Quiz auto-save rules (the dashboard watches the handout's own counters, so the
handout is never edited):
- the quiz must keep the element ids `qDone`, `qTot`, `qRight`, `qReset` (all the
  Aug-19 handouts do);
- a multi-document shell (tabbed SPA) must embed its tabs with `iframe.srcdoc`, **not**
  `data:` URLs — a `data:` frame is a different origin and the dashboard cannot see
  inside it. The equipment pages use `srcdoc` (quizzes save); `new_hire_overviews_all.html`
  uses `data:` (marked `"quiz": false`; its five quizzes save from the single overview pages);
- set `"quiz": true` only on pages that really have one; a run is saved when every
  question is answered, and "Reset quiz" + answering again saves another run;
- the Print Station (`new_hire_print_station.html`) previews all 27 documents through
  `srcdoc`, so its quizzes *would* be visible — it is deliberately `"quiz": false` so
  results are only recorded under the handout's own key, never under `print_station`.

Mentor sign-off is separate from the engineer's score: the engineer's best run shows as
a chip; the mentor ticks **Reviewed** and **Quiz passed** per handout in the drawer, and the
weekly "quiz passed" items stay as they were.
