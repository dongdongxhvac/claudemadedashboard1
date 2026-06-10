---
tags:
  - meeting-prep
  - leadership
  - dashboard
  - pitch
date: 2026-06-10
type: personal-positioning
status: ready-to-rehearse
---

# Three Seats, One Operator — my positioning for the leadership meeting

> [!info] What this note is
> My personal value-proposition beat for the directors/presidents meeting —
> delivered **after** the dashboard value/risk sections, **before** the roadmap
> and asks. This version was red-teamed through three skeptical-executive
> lenses (cost-minded president, politically-astute ops director, exec comms
> coach) and rewritten to survive them. **This note is private prep — do not
> print or circulate it.** The Q&A answers marked *live-only* exist so I'm
> ready if asked; printing them would plant the questions.

---

## The 60-second spoken version (~150 words — rehearse to under a minute)

> "One word on how this got built, because it points at what the company
> should do next. The hard part was never the code. The hard part was knowing
> **what** to build: why 10:30 in the morning is the deadline that actually
> matters on rounds, what a red lock versus a green lock means to the engineer
> holding it, which numbers the client asks about every Thursday. That came
> from years in **three seats** — technician, client-facing, and manager.
> AI did the engineering. I'm not a software engineer, and I don't pretend to
> be — my part was judgment: specify, review, verify against the floor. And
> the engineers shaped it with me; they pushed back on early versions, and
> what shipped is better for it. **The AI is available to everyone. The
> judgment isn't.** That combination is repeatable — and \[MANAGER NAME\]'s
> backing gave me the room to prove it. That's what I'd ask you to see today."

> [!tip] Delivery mechanics
> - **One metaphor only: "three seats."** Say it in the speech, return to it
>   in the close. No "bridge," no "translator" — one image repeated is what
>   survives the meeting.
> - **The hallway line** is "The AI is available to everyone; the judgment
>   isn't." It sits second-to-last on purpose — right before the close, where
>   it lands hardest. Don't bury it, don't rush past it.
> - Lead with **judgment**, credit AI matter-of-factly mid-speech. Never open
>   with "AI wrote the code" — that hands the room the *passenger* frame
>   before the *pilot* evidence arrives. Saying it plainly mid-speech IS the
>   transparency; announcing "I want to be transparent" reads as confession.

---

## The three seats (expanded, if there's room to elaborate)

I've sat in all three seats this dashboard serves:

- **Technician** — rounds, lockout/tagout, alarm chasing. The compliance and
  safety features encode field reality: rLOTO red lock, gLOTO green lock,
  ISOTO tag, the 10:30 AM rounds deadline.
- **Client-facing** — the weekly forecast meeting, the questions the client
  actually asks. That became the meeting module and the reporting views.
- **Manager** — staffing, PTO, overtime, coverage, accountability. That
  became the coverage forecast and workload visibility.

Every feature traces back to a problem someone on this account actually
handled — many of them mine, plenty of them the engineers'. **They pushed
back on early versions and shaped what shipped** — which is why it needed no
training rollout: it matches how the work actually happens, and it
complements the systems we already own rather than fighting them.

> [!tip] If the client has reacted
> If BMR has referenced the dashboard, asked for something from it, or
> commented on it in a Thursday meeting — **that single sentence outranks
> everything else in this note.** Presidents care about client retention above
> all. Have it ready: "*\[client name/person\] now asks for \[X\] from it in
> our weekly meeting.*"

---

## The honest division of labor (the AI talking point, welded to controls)

AI (Claude) did the engineering execution: code, database, interface. My part
was the part that requires **standing on the plant floor**: choosing the
right problems, specifying them in operational terms, setting priorities,
and accepting or rejecting the result against reality every shift.

Said with controls attached (never naked):

> "AI wrote most of the code — with all of it in our private, version-
> controlled repository, no client operational data used to train any model,
> and a complete technical handoff package ready for IT review."

A domain expert without AI ships software too — slowly and expensively,
through vendor backlogs. AI without domain context builds the wrong thing
beautifully. The value is in the pairing.

---

## What this means for the company (softened to survive skeptics)

- The constraint on useful operational AI isn't licenses or budget — it's
  pairing **site-level domain context** with the ability to direct the
  tools. I won't claim that's rare; I'll show what it produced and let the
  output be judged: a system eight engineers run their shifts on, built
  alongside my regular duties, for under $50/month in infrastructure.
- **Repeatable — as a hypothesis with a cheap test.** One site is one data
  point. If leadership wanted a second proof, somewhere like Binney St is a
  natural fit — done **with the account team there: their site, their lead,
  me in support.**
- **Growable in-house.** This project shows the capability is something we
  can develop rather than buy. If leadership sees value, I'd welcome
  supporting other account teams **in whatever format my manager and the
  directors think fits** — documentation, shadowing, a pilot.
- **A story the business could use.** If sales leadership ever wants an
  "AI-enabled operations" example for clients, a working one now exists —
  with a client who sees it in action every Thursday.

> [!warning] Lines I am NOT saying (red-team kill list)
> - ~~"That's rare today, and we have it in-house"~~ — self-crowning; let them say it.
> - ~~"I'd like to develop other managers"~~ — claims a role nobody gave me; route through leadership.
> - ~~"The same method works at any account"~~ / ~~"every account has this problem"~~ — n=1 generalized, invites the one counterexample in the room.
> - ~~"Marketable / put in front of clients"~~ — GTM belongs to sales and legal, not the builder.
> - ~~"Human-reviewed"~~ — review hasn't happened; claiming it invites the kill shot.
> - ~~"How a vendor imagines it"~~ — knocks the execs who bought our vendor systems.
> - ~~"I performed in each seat"~~ — self-grading; the specifics carry the claim.

---

## Q&A prep — *live-only* answers (do not print in any handout)

**"Couldn't anyone do this with AI now?"**
> "The AI is available to everyone; the judgment isn't. This dashboard
> embodies hundreds of small calls — what counts as a missed round, when a
> chattering alarm needs a human, what the client must see versus what's
> noise — that only come from having done the work. AI without specific
> operational context produces a generic tool. This one worked because the
> context was deep, specific, and corrected on the floor every shift."

**"How do we know the AI didn't build it wrong?"** *(most dangerous question in the room — answer straight)*
> "Eight engineers run their shifts on it every day — wrong data gets caught
> by lunch. Everything is version-controlled, and the technical handoff
> package is ready for IT's formal review. And to be straight: an independent
> technical review hasn't happened yet — that's why it's my **first** ask
> today, not my last. Until it passes, the dashboard is decision-support;
> Cove and the systems of record stay authoritative for anything
> compliance-touching."

**"Whose AI? Who owns the code? Did client data go to a model?"** *(IP/liability — verify before the meeting, then answer in one breath)*
> "Commercial AI tooling under \[company/personal paid\] terms; all output is
> in our private repository; no client operational data was used to train any
> model — the AI wrote code, the data stays in our database. Full detail is
> in the IT handoff document."

**"Are you trying to change jobs?"** *(only if asked — never raise it)*
> "No. Running University Park is my job, and the whole point is this made
> that job run better. If the company wants to reuse what we learned here,
> I'll support that however my leadership thinks makes sense — the site
> comes first."

**"What do you want from us?"**
> Bridge to the asks: IT review sponsorship · ~$500 kiosk hardware ·
> service accounts · Binney St pilot **with that account's team**.

---

## Pre-meeting checklist

- [ ] Fill in **\[MANAGER NAME\]** in the spoken version — crediting my chain
      of command is load-bearing, not polite garnish. Consider giving them a
      heads-up before the meeting so they're inside the tent.
- [ ] Verify the **AI-controls sentence is entirely true** before saying it:
      private repo ✓ · no client data in model training (confirm tooling
      terms) · which machine the tooling runs on.
- [ ] Confirm the **cost number** ("under $50/month") against current
      Vercel/Supabase plans.
- [ ] Get the **client-reaction sentence** if one exists (Thursday meeting).
- [ ] Rehearse the 60-second version out loud twice — target under a minute
      at a calm pace; the hallway line gets its own beat of silence after it.
- [ ] Do **not** print this note or the live-only Q&A into the circulating
      talking-points handout.

---

*Related: the circulating doc is `LEADERSHIP_TALKING_POINTS.md`; the IT
handoff is `IT_DEPLOYMENT_REVIEW.md`. This note stays private.*
