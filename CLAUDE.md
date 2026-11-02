# Project conventions (read every session)

UPark engineer dashboard: React 19 + Vite + TypeScript (`erasableSyntaxOnly`), Tailwind, TanStack Query,
Supabase project `iujuibvcahuapzowjtym`, Vercel deploys `master`. Work directly on `master` and push it;
the user pulls and hard-refreshes. Before every push: `cd web && node --experimental-strip-types
src/lib/trainingBoard.test.ts && npx tsc -b && npm run lint && npm run build` — lint baseline is
64 problems (32 errors, 32 warnings) and must not grow.

## Training — 8-week board (Admin › User Profiles › Tracker)

Source of truth: `web/src/lib/trainingBoard.ts` (pure), `trainingBoardPrint.ts` (fills the real
print-station document), `web/src/components/tracker/{TrainingSection,TrainingBoard,WeeklyLog,PlanBoard,
InviteCard,FirstMeetingCard,ResetLog}.tsx`, hooks in `useTrainingBoard.ts`, tables `training_board`
(rows per item × week, week 0..52) and `training_board_log` (one line per changed field). Meta rows
(`meta.weeks`, `meta.plan`, `meta.first_meeting`, `meta.invite`) are never logged.

Rules the user has fixed — keep them unless told otherwise:

- **Status pill** cycles none → done → next week. No "more work". Score 1–4 on sections 3–5 only
  (1–3 ⇒ next week, 4 ⇒ done). Sections 1, 2, 6 have no score.
- **Notes**: several per item per week, each with its own mark: ✗ missed · ★ good. On the rounds item
  (7 PlantLog · building round) the marks are ◐ learning · ✓ solo · → next week and the latest note's
  mark is the round's state; the hours box is just hours (whole numbers).
- **Items 7 + 9 are one item**; equipment rows in "Find It & Tag It" (boiler, cooling tower, AHU,
  chiller, BMS) are two parts: `a` overview + quiz, `b` find it / tag it.
- **Week chips** are review sessions, not calendar weeks. Exactly one selected at a time, click again
  to unselect, nothing is written on click; Save needs a selected week and stamps today's date on it
  the first time. "+ week" adds sessions past 8. "↺ reset W{n}" clears a session's date (and, on a
  second confirm, its rows). Week-0 meta rows (first meeting, invite, plan) save without a week.
- **Weekly log**: Review lists every logged change *except* anything set to next week (that is Focus
  only). Note lines read "note: missed · text" (mark as a word), highlighted with the mark's colour and
  the text underlined. Every line is `10/30·32` (compact date·item number, small mono) then the item
  name bold, then the rest. Section tallies are **accrued**: items done by the end of the week over the
  section total ("2/5"), count large, with the delta vs the previous week ("+2"). COVE = hours that
  week, PlantLog = "10 h · solo". Columns: Done wide, Focus narrow.
- **Invite** (page 4): Focus = next-week items with notes; To do = that week's unmarked or missed notes
  on items not on next week; Review with Jie = done items + notes; Done = n / total.
- **Plan tab**: blank board, pick a plan week, click items to assign them (one week per item), note per
  item and per week, "+ week"; the review column shows each item's *board status*, not its notes.
- **Section 0 · First meeting**: bookmark header above section 1 on the Board tab; the checklist and the
  three report dates sit at the bottom of the board (not on the Invite tab).
- **Print** = the real tracker document filled in: board (page 1) + weekly log (pages 2–3) only; page 4
  (invite) is dropped. The first meeting prints as section 0 under section 2 in the board's row style.
  Under each item: a bold header per part ("overview · ✓ W5 · score 4"), then its notes indented with a
  hanging indent ("W5 ★ text"), proportional 0.7rem font — compact, no wasted rows. Mark symbols print
  in their colours; next-week items show "→ W5" in the date slot; hours past week 8 print under item 1.
  Verify print changes with a Chromium render (esbuild bundle of the lib + Playwright) before pushing.
- **Progress reports** (PDF per engineer) are generated from the same lib; header = trainee, title,
  hired, schedule; KPIs; progress by section; summary (focus, missed, good, hours, rounds); every item;
  weekly log; signature lines.
- Visibility: the board is for managers / directors / admins (`current_user_can_manage_users`), never
  leads or the engineer. Profile and tracker pages use the light theme.

Deeper history of every decision is in `seed/training/new-hire/README.md`.
