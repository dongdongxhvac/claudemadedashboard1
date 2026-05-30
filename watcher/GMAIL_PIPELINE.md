# Gmail → BMS-alarm pipeline

End-to-end map of how a BMS alarm/heartbeat email becomes a row in
`email_alarm_events` and (sometimes) a tile on the dashboard. Read top
to bottom when **debugging** ("why isn't my alarm showing?") or adding
a **new BMS vendor**.

The canonical source for filter rules is
[`gmail_filters.xml`](./gmail_filters.xml) (exported from the
`bmrupark55@gmail.com` Gmail account's Settings → Filters → Export).

---

## Quick reference

| # | Gmail filter matches | → Gmail label | → Poller env var | → `vendor` in DB | → Dashboard panel |
|---|---|---|---|---|---|
| 1 | `from:jie.lao` AND `noreply@siemens.com` | `UPark Siemens Alarms from Power Automate` | `GMAIL_ALARM_LABEL`¹ | `siemens` | §10 |
| 2 | `from:jie.lao` AND test keywords² | `UPark 4 BMS Heart Beat from Power automate` | `GMAIL_HEARTBEAT_LABEL` | `power_automate` | §09 heartbeat |
| 3 | `from:jie.lao` AND generator keywords³ | `UPark Generator run from power automate` | **(unused)** ⚠ | — | — *(archive only)* |
| 4 | `from:jie.lao` AND Delta senders⁴ | `UPark Delta Alarms from power automate` | `GMAIL_DELTA_ALARM_LABEL` | `delta_10green` / `delta_takeda` | §10 |
| 5 | `from:jie.lao` AND `jll750mainbms@northeast-tech.com` | `UPark 730750 Alarms from power automa`**`tic`** ⚠ | `GMAIL_730750_ALARM_LABEL` | `northeasttech_730_750` | §10 |
| 6 | `subject:(PA Heartbeat)` | `Power Automate Heartbeat` | `GMAIL_PA_HEARTBEAT_LABEL` | `power_automate_pa` | §09 PA-canary |

¹ Legacy variable name — kept for back-compat with the original Siemens-only
deployment. Holds the Siemens label, not a generic "alarms" label.

² `Test_page OR "test alarm" OR testalarm OR LLEngDailyTestAlm` — daily
test alarms the BMSes fire on schedule. Their *absence* is the staleness
signal §09 watches.

³ `EmergencyPowerStatus OR GENERATOR OR Generator_REF1T_BB OR GenStsOn_Al
OR GenComAlm_Al OR 35_PH_GeneratorStatus OR Base_Generator_Status` — all
the BMSes that broadcast generator state during routine generator runs.
Routed to a separate label to keep §10 from filling with weekly test-run
noise.

⁴ `takedabms@albireoenergy.com` (→ `delta_takeda`)
or `deltabms@albireoenergy.com` (→ `delta_10green`)
The poller refines the vendor name from the original sender after
ingestion — see `_process()` in `gmail_alarms_poller.py`.

---

## Two things worth knowing

### ⚠ The "automatic" vs "automate" typo (filter 5)

Filter 5's label is **`UPark 730750 Alarms from power automa`*`tic`*`**
where the other five labels say `automate`. **It is intentional only by
accident** — the label string must match the env var
`GMAIL_730750_ALARM_LABEL` exactly. If you ever clean up the typo in
Gmail, also update the matching env var on the Pi (or wherever
`gmail_alarms_poller.py` runs) in the same change, or the poller will
silently stop pulling 730/750 alarms.

### ⚠ Filter 3 is currently write-only / archival

The poller has no `GMAIL_GENERATOR_LABEL` env var, so the
`UPark Generator run from power automate` label accumulates in Gmail
without being pulled. That's intentional — these are noise during
scheduled generator tests — but if you ever want a §-panel for
generator-run events:

1. Add `GMAIL_GENERATOR_LABEL` to `main()` alongside the others.
2. Add a `_process_generator_event()` parser similar to
   `_process_northeasttech_alarm()`.
3. Add a view (`v_generator_runs_recent` or similar) that the dashboard
   reads.

---

## Heartbeat pipeline (§09)

The 4 BMSes that talk to Power Automate each send a **scheduled daily
test alarm** (filter 2's keywords). Those land under
`UPark 4 BMS Heart Beat from Power automate`. The poller stores them
into `email_alarm_events` with `vendor = power_automate`. §09 reads
`v_bms_heartbeat_latest` to track *the most recent test arrival per
vendor*. If a BMS hasn't sent a test in N hours (weekday-aware
staleness rule), the heartbeat goes red.

The PA flow itself sends a separate `PA Heartbeat` email (filter 6).
That's the **upstream canary** — if PA itself is down, you stop getting
test alarms from BMSes too, so we monitor PA's own pulse separately.

---

## Adding a new BMS vendor (5-step checklist)

When a new BMS comes online:

1. **Add a Gmail filter** matching the new sender's email address.
   Route to a label named `UPark <Vendor> Alarms from power automate`.
   Re-export `gmail_filters.xml` and commit it.

2. **Add an env var** on the poller box, e.g.
   `GMAIL_<VENDOR>_ALARM_LABEL=UPark <Vendor> Alarms from power automate`.

3. **Wire it in `main()`** — append a line to the `alarm_labels` list
   in `gmail_alarms_poller.py`.

4. **Teach `_infer_vendor()`** the new sender's domain, returning a
   distinct vendor string (e.g. `tridium_lab1`).

5. **Add a `_process_<vendor>_alarm()` parser** if the body format
   doesn't fit any existing branch. Wire it into the `_process()`
   vendor dispatch.

If a step gets skipped, alarms land with `vendor = null` and get
filtered out of `v_email_alarms_open` — exactly the bug that hit
730/750 in May 2026 (commit `db64698` fixed it).

---

## Files & code references

| Concern | Lives in |
|---|---|
| Gmail filter rules (source of truth) | [`watcher/gmail_filters.xml`](./gmail_filters.xml) |
| Label-→-env-var wiring | `gmail_alarms_poller.py` → `main()` (`os.environ.get(...)` near `alarm_labels`) |
| Sender-→-vendor classifier | `gmail_alarms_poller.py` → `_infer_vendor()` |
| Per-vendor body parsers | `gmail_alarms_poller.py` → `_process_*_alarm()` |
| DB ingestion target | `email_alarm_events` table |
| §10 panel reads | `v_email_alarms_open` view (filters out `vendor IS NULL`) |
| §09 heartbeat reads | `v_bms_heartbeat_latest` view |
