# UPark New-Hire Training — handoff note

Paste this into a new chat to pick up where we left off.

## What exists (all in the outputs folder)

**Five discipline overviews** — self-contained pages, each with sections, diagrams and a
tap-to-answer quiz:
`new_hire_hvac_overview.html` · `new_hire_life_safety_overview.html` ·
`new_hire_plumbing_overview.html` · `new_hire_electrical_overview.html` ·
`new_hire_bms_overview.html`
Combined tabbed version: `new_hire_overviews_all.html`

**Four equipment deep-dives**, each an Overview + a Find It & Tag It field sheet in a
two-tab SPA, plus the two standalone pages:
- Boiler — `new_hire_boiler_plant.html` (24 tag items)
- Chiller — `new_hire_chiller_plant.html` (36 items, chiller + tower)
- Cooling tower — `new_hire_cooling_tower.html` (18 items)
- AHU — `new_hire_ahu.html` (17 items)

**Field exercises**
- `new_hire_find_it_tag_it.html` — portfolio-wide, 117 items across 8 systems, with a
  fault index (symptom → tag numbers)
- `new_hire_find_it_on_screen.html` — BMS navigation, six systems, finding the page is
  the exercise. Worked example: `new_hire_find_it_on_screen_EXAMPLE.html`
- `new_hire_building_check.html` — per-building access / BMS / remote access, two tabs
  (printable + fillable)
- `upark_site_map.html` — schematic UPark map, three tabs (printable / blank / fillable)

**Reference**
- `training_level2_curriculum.html` — 48 Level-2 modules, filterable by field and by
  equipment/knowledge point
- `new_hire_quiz_answer_key.html` — mentor copy, all disciplines
- `new_hire_equipment_glossary.html`, `new_hire_terminology_spa.html`,
  `new_hire_coverage_map.html`

## Conventions to keep

- Light theme, Space Grotesk + IBM Plex Mono, discipline accents:
  HVAC cyan · Life Safety red · Plumbing blue · Electrical amber · BMS violet
- Every tag row carries: access badge (TAG IT / TAG THE ACCESS / READ ONLY / VERIFY),
  purpose badge (Move / Carry / Control / Prove / Protect / Isolate), an
  **IF IT IS WRONG** consequence line, and a **proof you were there** requirement
- Escalation always ends at **senior engineer, lead, or manager** — never "call the vendor"
- Overviews end with a "before you pick up the phone" checklist
- SPAs embed documents via base64 + **iframe srcdoc** (not data: URLs — sandboxes block those)
  and give each tab its own print button that prints that document in full
- Tag sheets print with **no forced page breaks**: atomic rows, repeating table headers,
  orphans/widows control

## Site facts established

- Every boiler in the portfolio is **hot water** — no steam boilers
- 75SS Boiler 1 = Cleaver-Brooks CB-700-350-125 (gas only, 350 BHP, non-condensing, 1999)
- A Patterson-Kelley N-2000 (Thermific) also in service — non-condensing, return >130°F,
  two-stage lo-hi-lo, flow-switch LWCO
- UPark map: Mass Ave north, Pacific St south, Sidney St N–S, Landsdowne diagonal,
  Purrington beyond it, Green St below 350 Mass, Franklin St above 38 Sidney.
  Garages: 55 Franklin, 80 Landsdowne, 30 Pilgrim. 730/750 Main sit in the wedge
  north of Mass Ave.

## Open / possible next

- `training_level2_curriculum.html` did not get the last font-size increase
- `new_hire_overviews_all.html` currently has six tabs (five disciplines + Boiler Plant);
  could be rebuilt to include Chiller, Tower and AHU under an Equipment group
- Remaining tag sheets that could get their own two-tab SPA: Life Safety, Plumbing, Electrical
- Coupon rack, shutoff head and access-door switch appear only in Level 2, not in any
  Level 1 overview
