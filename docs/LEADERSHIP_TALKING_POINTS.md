# UPark Operations Dashboard — Leadership Briefing Talking Points

*Prepared for: meeting with directors / presidents · June 2026*
*Presenter: Jie Lao, Technical Operations Manager, BMR @ University Park*

---

## 30-second opener

> "Over the past two months, on top of my regular duties, I built an
> operations dashboard that pulls everything we run at University Park —
> work orders, engineer rounds, four brands of building automation alarms,
> staffing, and our weekly client meeting agenda — into one live screen.
> It runs for under $50 a month, COVE remains our system of record, and
> the team uses it every shift. Today I want to show you what it does,
> what it costs, and ask for IT's engagement so we can harden it and
> scale it to other accounts."

---

## 1. The problem we had

- Operational truth was scattered across **six systems**: COVE (CMMS),
  plantlog.com (engineer rounds), and **four separate BMS platforms**
  (Delta, Siemens, Northeast Tech, Schneider) — plus spreadsheets and email.
- A manager answering "are we on top of things today?" had to log into
  4–6 systems, or wait for someone to compile it.
- BMS alarms arrived as **emails nobody could see in aggregate** — no
  cross-vendor view, no history, no accountability when an alarm chattered
  for hours.
- Institutional knowledge (what broke before, how we fixed it, which
  parts, which valve to isolate) lived **in people's heads** — and left
  with them.
- The weekly client forecast meeting ran off a passed-around Excel file.

## 2. What it is today — at a glance

| Metric | Value |
|---|---|
| Site covered | BMR @ University Park — 15 buildings + 3 garages |
| Team | 8 engineers, 2 shifts, on-call rotation |
| Live data feeds | 7 (COVE PMs, WOs, labor · Plant Log rounds · Delta BMS direct · multi-vendor alarm email · BMS heartbeats) |
| Refresh cadence | 5 seconds (critical alarms) to hourly (CMMS data) |
| BMS brands integrated | Delta, Siemens, Northeast Tech (Schneider pending site access) |
| Views | Manager dashboard · engineer phone view · shop-floor TV · building knowledge base · admin |
| Infrastructure cost | **Under $50/month** (cloud database + hosting + one small VM) |
| Build cost | In-house, zero external spend |

## 3. What it does — five value stories

**a. Compliance, automated.**
Engineer rounds have hard deadlines (morning rounds logged by 10:30 AM,
afternoon by 5:55 PM). The dashboard tracks every building against those
deadlines in real time and **emails me automatically the moment a deadline
is missed** — once, with the exact buildings listed. Same for monthly
water-meter readings and weekly generator/water tests. Nothing slips
silently anymore.

**b. One alarm picture across four BMS brands.**
Every alarm email from every vendor lands in one feed with building
attribution, history, and statistics ("noisiest building this month").
It even detects **flapping alarms** — a point that trips and clears 3
times in 20 minutes looks "resolved" to the BMS but is really a failing
sensor; the dashboard flags it for review. That's a failure mode we used
to miss entirely.

**c. Labor and workload visibility.**
PM completions, hours, and per-engineer workload trends — live, not at
month-end. The shop-floor TV shows the crew their own numbers, coverage,
and open overtime slots at shift start. Self-correcting behavior without
micromanagement.

**d. Institutional knowledge that survives turnover.**
Every piece of equipment has a living record: parts, location, SOP,
photo, lockout/tagout requirements, and — critically — **every past
issue with how it was resolved**. Closing an issue *requires* writing
the fix. Six months later, anyone can search "freeze stat" and find
exactly what was done, by whom, with which part. This is the
retain-and-transfer half of how I train: bring equipment back to its
as-built design, improve it, retain what we learned, transfer it to the
next person.

**e. The weekly client meeting, digitized.**
The forecast-meeting agenda that lived in Excel is now a live, editable
grid — filtered by building, with open-item counts. Walk into the BMR
meeting, open one screen, and run it.

## 4. Governance — what it is NOT

- **It does not replace COVE.** COVE remains the authoritative system of
  record for C&W and the client. The dashboard is a read-mostly
  integration layer on top; every work order number on it points back to
  COVE.
- **Access is role-gated at the database layer** — admin, lead, engineer,
  client roles — not just hidden buttons. Engineers see their view;
  managers see everything.
- **No client financial data, no payment data** lives in it. Operational
  and staffing data only.

## 5. Honest risk picture (and why I'm here)

- Today it's **single-maintainer** (me) on consumer-grade infrastructure
  (the data pollers are mid-migration from a personal PC to a small cloud
  VM). That was right for proving value fast; it's not right for
  company-wide reliance.
- That's exactly the ask: **IT engagement** to review, harden, and bless
  it — I have a full technical handoff document ready (architecture,
  credential inventory, network requirements, data classification, and a
  list of what we'd need from IT).

> *Speaker note (not for handout): the personal-positioning beat ("Three
> Seats, One Operator") is delivered here, between the risk picture and the
> roadmap. It lives in a separate private prep note —
> `Three-Seats-One-Operator-Pitch.md` — and is intentionally not printed in
> circulating copies.*

## 6. Roadmap

| When | What |
|---|---|
| Now | IT security review (handoff doc ready) |
| ~July 2026 | 2 shop-floor TV kiosks (mini-PCs, ~$200 each) |
| Q3 2026 | Training & competency module (SOP spine is already built) |
| Q3–Q4 2026 | **Second site pilot: Binney St** — 28 buildings, 19 techs, brand-new account where day-one visibility matters most |
| Future | Corporate SSO, corporate domain, IT-managed service accounts |

## 7. The asks

1. **Sponsor the IT review** — the gating step for anything company-wide.
2. **~$500 hardware budget** — two TV kiosk mini-PCs + mounts.
3. **IT-provisioned service accounts** — a proper COVE API account and a
   corporate mailbox for alarm ingestion (replacing personal-tier accounts).
4. **Support the Binney St pilot** as the proof of multi-site scalability.

---

## Anticipated questions — prepared answers

**"What happens if you leave?"**
All code, database schema, and import history are in version control on
a mainstream stack (React, Postgres) any web developer knows. There's a
written IT handoff document. But candidly — reducing single-person risk
is *why* I'm asking for IT engagement now, while it's a strength story
and not an incident story.

**"Why didn't we buy something?"**
Nothing off the shelf integrates COVE + plantlog.com + four BMS brands —
that's custom integration work regardless of which BI tool sits on top,
and integration consulting alone typically runs well into five figures.
This was built in-house, tailored to our exact workflow, at effectively
zero marginal cost.

**"Is the client's data safe?"**
The data is our operational data — work order references, alarm events,
rounds, staffing. No financials. Hosted on SOC 2–audited vendors
(Supabase/Vercel), encrypted in transit, role-gated at the database
layer. The IT document includes the full inventory for security review.

**"Can this go to other accounts?"**
Yes — the architecture already supports multiple sites, and Binney St is
the natural pilot: brand-new account, 28 buildings, where we'd otherwise
spend months building visibility from scratch.

**"How much of your time does it consume?"**
Built alongside my regular duties using AI-assisted development. Run-rate
maintenance is low — the system monitors itself (every data feed has a
heartbeat on the dashboard, and failures email me).
