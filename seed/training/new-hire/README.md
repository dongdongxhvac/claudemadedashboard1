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
| The handouts themselves (21 self-contained HTML pages) | `web/public/training/new-hire/` — served as static files at `/training/new-hire/…` (Vercel serves real files before the SPA rewrite) |
| The program as data — 8 weeks × verified items, rep tally, evals, cert | `web/src/lib/newHireProgram.ts` (transcribed from the sign-off sheet inside `new_hire_8_week_plan.html`) |
| Progress tables + RLS | `supabase/migrations/0128_new_hire_program.sql` |
| Data hooks | `web/src/hooks/useNewHire.ts` |
| UI — tracker drawer, opened from Admin › User Profiles → Training | `web/src/components/NewHireProgramDrawer.tsx` |
| Original build notes for the handouts (conventions, site facts) | `HANDOFF.md` here |

## Decisions (2026-08-19)

- **Plan B (interleaved 8-week schedule) is canonical.** The older phase
  tracker's two-phase split (Foundations wk 1–4 / Development wk 5–8) is not
  the model; its categories (Safety / Ops / Orientation / Controls / PM /
  Theory) survive only as colour tags on items.
- Item keys in `newHireProgram.ts` are permanent — progress is keyed on them.
  Change labels freely; never rename a key.
- Handouts are hosted inside the dashboard (works on the kiosk/phones, no
  Downloads dependency). To update a handout, replace the file under
  `web/public/training/new-hire/` and rebuild.
