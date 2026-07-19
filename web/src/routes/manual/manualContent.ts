// Operations manual content — the words people read at /upark/manual and
// /binney/manual.
//
// ============================================================================
// MAINTENANCE RULE — read this before you change any PTO behavior.
// ============================================================================
// This file is the manual. It is hand-written prose, NOT generated from the
// code, so it only stays true if we update it in the SAME commit that changes
// the behavior. If you touch any of:
//
//   web/src/hooks/usePto.ts            web/src/components/PtoPanel.tsx
//   web/src/routes/binney/hooks/useBinneyPto.ts
//   web/src/routes/binney/BinneyPtoPanel.tsx
//   web/src/components/MyPtoSection.tsx
//   supabase/functions/notify-pto/     any pto_* migration
//
// ...then grep this file for the rule you changed, fix the wording, and bump
// LAST_UPDATED. A manual that lies is worse than no manual: people plan their
// vacations against it.
//
// Every statement below was verified against the code on the date shown. Where
// the app has a real gap or a trap, we say so plainly rather than describing
// how it ought to work — see the "Known gaps" topic.
// ============================================================================

export type ManualSite = 'upark' | 'binney';

export type Block =
  | { kind: 'p'; text: string }
  | { kind: 'bullets'; items: string[] }
  | { kind: 'steps'; items: string[] }
  | { kind: 'table'; head: string[]; rows: string[][] }
  | { kind: 'note'; tone: 'info' | 'warn' | 'danger'; title: string; text: string };

export type Topic = { id: string; title: string; blocks: Block[] };
export type Chapter = { id: string; title: string; summary: string; topics: Topic[] };

export const LAST_UPDATED = '2026-07-19';

export const SITE_LABEL: Record<ManualSite, string> = {
  upark: 'UPark',
  binney: 'Binney St',
};

/** Everything that genuinely differs between the two sites, in one place, so
 *  the prose below can stay readable. Anything not in here is identical at
 *  both sites. */
function siteFacts(site: ManualSite) {
  const binney = site === 'binney';
  return {
    binney,
    label: SITE_LABEL[site],
    other: binney ? SITE_LABEL.upark : SITE_LABEL.binney,
    otherPath: binney ? '/upark/manual' : '/binney/manual',
    dash: binney ? '/binney' : '/upark',
    /** Hours in a standard PTO day at this site. */
    day: binney ? 10 : 8,
    schedule: binney ? '4x10, seven days a week' : '8-hour days, Monday to Friday',
    /** Sick days -> hours at this site's day length. */
    sickHours: (days: number) => `${days * (binney ? 10 : 8)}h`,
    panelTitle: binney ? '§12 PTO & Staffing — Binney St' : '§12 PTO & Staffing',
  };
}

export function buildManual(site: ManualSite): Chapter[] {
  const s = siteFacts(site);

  return [
    {
      id: 'pto',
      title: 'PTO — Time off',
      summary: 'Requesting, approving and tracking vacation, sick and floating-holiday time.',
      topics: [
        // ------------------------------------------------------------------
        {
          id: 'pto-start',
          title: 'Start here',
          blocks: [
            {
              kind: 'p',
              text:
                'An engineer asks for time off from their own page. A manager approves or denies it from the ' +
                s.panelTitle +
                ' panel on the manager dashboard. Three kinds of time off run down a yearly balance — Vacation, Sick and Floating Holiday — and a manager sets those balances by hand at the start of each year.',
            },
            {
              kind: 'table',
              head: ['You are', 'Where you go', 'What you can do'],
              rows: [
                ['Engineer', s.dash + '/engineer — "My time off"', 'Request time off for yourself, see your own balances, withdraw a request that is still pending'],
                ['Manager', s.dash + '/manager — ' + s.panelTitle, 'Approve, deny, add PTO for anyone, set allotments, override the vacation cap'],
                ['Admin', 'Either site', 'Everything a manager can do, at both UPark and Binney St'],
                ['Director', 'Either site, read-only', 'Can open the panel and will see every button, but nothing they click will save'],
              ],
            },
            {
              kind: 'note',
              tone: 'warn',
              title: 'Seeing a button does not mean you may use it',
              text:
                'The PTO panels show every control to everyone who can reach the page. The database is the only thing that actually stops a click — and when it refuses one, nothing appears on screen. The card simply stays put. "I clicked Approve and nothing happened" almost always means you were not allowed to.',
            },
          ],
        },

        // ------------------------------------------------------------------
        {
          id: 'pto-roles',
          title: 'Who can do what',
          blocks: [
            {
              kind: 'p',
              text:
                'There are six account types: Engineer, Manager, Client, Admin, Director and TV. "Lead" is not one of them — a lead is an Engineer account with the lead box ticked on their profile, so every engineer rule here still applies to them.',
            },
            {
              kind: 'bullets',
              items: [
                'Only Admin and Director accounts can move between UPark and Binney St. Managers are locked to their home site, so a ' + s.label + ' manager cannot open the other site’s PTO panel.',
                'Your home site comes from one field on your engineer profile. If it says Binney St you are a Binney person; if it says anything else — including blank — the system treats you as UPark.',
                'Engineers, including leads, are bounced out of both manager panels. Typing the address in by hand sends you back to your own time-off page.',
                'The "access level" number on an account does nothing. It is read but never checked. Ignore it.',
                'Ticking someone Inactive strips their PTO rights immediately.',
              ],
            },
            {
              kind: 'note',
              tone: 'warn',
              title: 'Do not promise leads the Approve button',
              text:
                'The database grants lead engineers full approve, deny, edit and delete rights over PTO at both sites — but the website gives them no way to use it, because leads are Engineer accounts and engineers cannot open a manager panel. A lead’s only PTO screen is their own "My time off". This affects real people on both rosters today.',
            },
            {
              kind: 'note',
              tone: 'danger',
              title: 'Never set anyone to the Client account type',
              text:
                'A Client account is not bounced away from the manager dashboard. They would land on the PTO panel and see every engineer’s name, dates, reasons and balances. No Client accounts exist today. Keep it that way.',
            },
            {
              kind: 'note',
              tone: 'danger',
              title: 'PTO reasons are not private',
              text:
                'Every signed-in account can read every PTO record at both sites — including the free-text Reason field, denial notes and override reasons. The site-by-site split you see is done by the screen, not by the database. Do not type anything into a reason box you would not want the whole team to read.',
            },
          ],
        },

        // ------------------------------------------------------------------
        {
          id: 'pto-types',
          title: 'The kinds of time off',
          blocks: [
            {
              kind: 'table',
              head: ['Type', 'Who can file it', 'Runs down a balance', 'Counts toward the vacation cap'],
              rows: [
                ['Vacation', 'Engineer or manager', 'Yes — Vacation', 'Yes'],
                ['Sick', 'Engineer or manager', 'Yes — Sick', 'No'],
                ['Floating Holiday', 'Engineer or manager', 'Yes — Floating Holiday', 'No'],
                ['Jury Duty', 'Engineer or manager', 'No', 'No'],
                ['Bereavement', 'Manager only', 'No', 'No'],
                ['Leave', 'Manager only', 'No', 'No'],
                ['Short-Term', 'Manager only', 'No', 'No'],
                ['Personal, Unpaid', 'Retired — old records only', 'No', 'No'],
              ],
            },
            {
              kind: 'p',
              text:
                'A manager gets all seven live types. An engineer filing for themselves gets four: Sick, Vacation, Floating Holiday and Jury Duty. Bereavement, Leave and Short-Term have to be entered by a manager on the engineer’s behalf.',
            },
            {
              kind: 'note',
              tone: 'info',
              title: '"Floating Holiday" means the one floating day',
              text:
                'The CBA grants 12 holidays; the client observes 11. The one-day difference is a floating holiday the engineer takes at their own discretion — normally one day (' +
                s.day +
                'h at ' +
                s.label +
                ') per engineer per year. It is not a counter of observed company holidays; those are not PTO at all.',
            },
            {
              kind: 'note',
              tone: 'warn',
              title: 'The system knows nothing about public holidays',
              text:
                'There is no holiday calendar anywhere in PTO. A federal holiday sitting inside a date range is billed as an ordinary working day when hours are auto-calculated. Check the figure yourself on any range that spans one.' +
                (s.binney
                  ? ' One visual exception: the coverage heatmap outlines BMR-observed holidays in green so you can see them while booking — but the hours math still ignores them.'
                  : ''),
            },
            {
              kind: 'note',
              tone: 'info',
              title: 'Old records still show their old type',
              text:
                'Personal and Unpaid cannot be picked for anything new, but existing rows still display and stay editable — you can fix the dates on an old Unpaid entry without being forced to convert it. Old Personal rows show the raw word "personal" because the friendly label was removed.',
            },
          ],
        },

        // ------------------------------------------------------------------
        {
          id: 'pto-balances',
          title: 'Balances — what the numbers mean',
          blocks: [
            {
              kind: 'p',
              text:
                'Only three types carry a balance: Vacation, Sick and Floating Holiday. A manager types the yearly allotment in by hand, once per engineer per year. Nothing accrues automatically — the schedules below are cheat-sheets to read off, not automation.',
            },
            {
              kind: 'bullets',
              items: [
                'Remaining = Allotted − Used. Used counts APPROVED time off only, so a pending request does not reduce your remaining hours. The number on your chip is optimistic until your manager acts.',
                'Time off is charged entirely to the year it STARTS. A vacation running Dec 28 to Jan 3 comes out of the old year and nothing lands in the new one. To split it, file two requests.',
                'Balances are allowed to go negative. Nothing blocks a request or an approval for hours the engineer does not have — the number just turns red.',
                'On a chip, the big number is hours REMAINING and the small grey pair next to it is used/allotted. A balance turns red only once it drops below 4 hours. There is no amber tier.',
                'A dash means no allotment has been set for that type — not zero remaining. The Floating Holiday chip is hidden entirely when the allotment is zero.',
              ],
            },
            {
              kind: 'note',
              tone: 'danger',
              title: 'No allotment set means no chips at all',
              text:
                'If nobody has set an engineer’s allotment for the current year, that engineer opens "My time off" and sees NO balance chips — not zeros, nothing. The request form still works, so they can file time off against a balance that does not exist. Seeding every engineer at the start of the year is a manual job, one person at a time.' +
                (s.binney
                  ? ' Most of the Binney roster is still unseeded from the first pass — anyone with an amber "not set" badge in the Balances table needs this doing.'
                  : ''),
            },
            {
              kind: 'p',
              text: 'Vacation entitlement by length of service. These hours are the same at both sites and do not re-scale to the day length — a 4x10 week is still a 40-hour week.',
            },
            {
              kind: 'table',
              head: ['Length of service', 'Entitlement', 'Hours'],
              rows: [
                ['After probation to under 3 years', '2 weeks', '80h'],
                ['3 to under 8 years', '3 weeks', '120h'],
                ['8 to under 18 years', '4 weeks', '160h'],
                ['18 years and up', '5 weeks', '200h'],
              ],
            },
            {
              kind: 'p',
              text:
                'Sick days by length of service. The policy is identical at both sites in DAYS; the hours differ because a day at ' +
                s.label +
                ' is ' +
                s.day +
                ' hours. The first year builds up in steps; from year one onward you get the full 8 days at the start of every year.',
            },
            {
              kind: 'table',
              head: ['Length of service', 'Days', 'Hours at ' + s.label + ' (' + s.day + 'h/day)'],
              rows: [
                ['Under 3 months', '0 days', '0h'],
                ['3 to under 6 months', '2 days', s.sickHours(2)],
                ['6 to under 9 months', '3 days', s.sickHours(3)],
                ['9 to under 12 months', '4 days', s.sickHours(4)],
                ['1 year and beyond', '8 days each year', s.sickHours(8)],
              ],
            },
            {
              kind: 'note',
              tone: 'info',
              title: 'An engineer can be set to their own day length',
              text:
                'A per-engineer daily-hours setting overrides the site default (' +
                s.day +
                'h at ' +
                s.label +
                '). It drives every automatic hours figure for that person: the sick schedule in the balance editor, their own request form, the manager’s Add PTO form, and the quick call-out log. Justin McCarthy is on 8h days; everyone else at Binney is on 10h.',
            },
          ],
        },

        // ------------------------------------------------------------------
        {
          id: 'pto-engineer-request',
          title: 'Engineer — how to request time off',
          blocks: [
            {
              kind: 'steps',
              items: [
                'Sign in. You land on your own page automatically — you never need to know the site in the address.',
                s.binney
                  ? 'Your whole page is time off: Binney has no PMs, work orders or hours yet. On a phone the header reads "My PTO" and there is no bottom tab bar.'
                  : 'Scroll to the bottom of the page, past your PMs, work orders, NPMs and overtime, to the "My time off" box. On a phone it is at the bottom of the "Mine" tab, not "Now".',
                'Click "+ Request PTO" at the top right of the box. The same button turns into "Cancel" to close the form again.',
                'Pick the Type. The form opens on Vacation even though Sick is first in the list — if you are logging a sick day you must change it yourself.',
                'Set From and To. Both dates count: Monday to Friday is 5 days off, not 4. For a single day, put the same date in both. Past dates are allowed, so you can file yesterday’s sick day.',
                'Leave Hours blank to accept the automatic figure. The grey number in the box is only a placeholder — the Submit button always shows the hours that will actually be filed. ' +
                  (s.binney
                    ? 'At Binney it fills ' + s.day + 'h for every day in the range, weekends included, because both crews work weekends.'
                    : 'At UPark it fills ' + s.day + 'h per weekday and counts Saturday and Sunday as zero.'),
                'For a half day, type the hours (e.g. 4) into the Hours box. It accepts quarter-hour steps. You cannot say WHICH half of the day — the out/return time boxes are manager-only.',
                'Reason is optional free text. Remember everyone with a login can read it.',
                'Click Submit. The form closes itself and the request appears in the amber "Awaiting manager approval" block above your year log. If it fails, the form stays open with the error in red underneath.',
              ],
            },
            {
              kind: 'note',
              tone: 'warn',
              title: 'Only two things can block your Submit',
              text:
                'An end date earlier than the start, and hours of zero or less. Nothing else is checked — not your balance, not duplicates, not the cap.' +
                (s.binney
                  ? ''
                  : ' The one that bites at UPark: a Saturday-or-Sunday-only request auto-calculates to 0h and is refused with "Hours must be > 0." Type the hours in by hand.'),
            },
            {
              kind: 'note',
              tone: 'info',
              title: 'You will not be stopped by the vacation cap',
              text:
                'If two other engineers already have vacation on your dates you get an orange warning naming them, but Submit still works. Your manager makes the call at approval time. The warning counts only engineers at your own building — the same picture your manager sees.',
            },
          ],
        },

        // ------------------------------------------------------------------
        {
          id: 'pto-engineer-after',
          title: 'Engineer — after you submit',
          blocks: [
            {
              kind: 'bullets',
              items: [
                'Your request goes in as Pending, always under your own name. You cannot self-approve and the system rejects any attempt to.',
                'Submitting immediately emails every active manager at your own building. You get no confirmation email yourself.',
                'While it is Pending, a Withdraw link sits on the right of the row. It asks you to confirm first. Withdrawing emails nobody — if you had asked a manager to look at it, tell them.',
                'Once it is approved the Withdraw link is gone. To cancel approved time off you have to ask a manager.',
                'You can never edit a request after filing it — no changing dates, hours or type. Withdraw it and file a new one.',
                'You can never delete a record. Withdrawn requests stay in your year log as "cancelled" so the history stays intact.',
                'When your manager decides, you get an email and the screen updates by itself — no refresh needed. An approval also puts the days on a calendar.',
                'Your year log shows every request that STARTS this calendar year, in every state. Withdrawn and denied ones appear faded.',
              ],
            },
            {
              kind: 'note',
              tone: 'danger',
              title: 'The denial reason exists only in the email',
              text:
                'When a manager denies a request they must type a reason, and it is saved on the record — but no screen anywhere in the app displays it. Not your log, not the manager’s queue. The decision email is the only copy. If you delete that email, the app cannot tell you why you were denied and neither can the manager who denied you. Keep the email, or ask in person.',
            },
          ],
        },

        // ------------------------------------------------------------------
        {
          id: 'pto-manager-queue',
          title: 'Manager — working the pending queue',
          blocks: [
            {
              kind: 'steps',
              items: [
                'Open ' + s.dash + '/manager. ' + (s.binney ? 'PTO is the only panel on the page.' : 'The PTO panel is first — you do not have to scroll.'),
                'Read the header tally without expanding: "N pending · N out today · N upcoming", plus a red conflicts count if there are any.',
                'Expand the section. "Pending approval (N)" is the first block.',
                'Read each card: engineer, type, date range, and days/hours — e.g. "Vacation · 8/3 – 8/7 (5d / 40h)". The grey line underneath says when it was submitted, and adds "by <name>" only when a manager filed it rather than the engineer.',
                'Vacation, sick and floating-holiday cards also show a balance line: hours left now → what approval would leave. It turns red when approval would overdraw. "No balance set" means the year’s allotment was never entered — fix that in Balances below before deciding. Other leave kinds have no allotment, so no line.',
                'Check the left edge. Amber is normal. Red means the two-engineer vacation cap is exceeded, and a red box names exactly who is already booked.',
                'A quiet grey note reading "<name> also off these dates (within cap)" is informational — one other person is off and you are still inside the cap. Approve normally.',
                'To approve: click the green Approve. The card moves to "Upcoming approved", your name and the time are stamped on the record, "by <your name>" appears next to the status in the engineer’s year log, and the decision email says "Approved by <your name>".',
                'To deny: click the red Deny, type a reason — Confirm deny stays greyed out until you do — then Confirm deny.',
                'Check the card actually disappeared. If it did not, the write was refused: nothing on screen will tell you.',
              ],
            },
            {
              kind: 'note',
              tone: 'warn',
              title: 'The queue is sorted by the date off, not by who waited longest',
              text:
                'Cards are ordered by the START DATE of the time off, soonest first. A request filed this morning for next Monday sits above one filed three weeks ago for December. The card shows "submitted <date>" but nothing sorts or highlights by it. Working top-down triages by urgency, not by fairness.',
            },
            {
              kind: 'note',
              tone: 'warn',
              title: 'Nothing ever leaves the queue on its own',
              text:
                'A pending request nobody actioned stays there forever, including after the dates have passed — and because the sort is by date, a stale past-dated request pins itself to the TOP of your queue permanently. There is no dismiss, no auto-expire, no age warning. Cancel or deny the rot yourself.',
            },
            {
              kind: 'note',
              tone: 'danger',
              title: 'Approving wipes any reason already on the record',
              text:
                'The plain Approve button clears the review note. If a request was denied with a reason and is later flipped to approved, that reason is destroyed silently, and the new approver replaces the original reviewer. The note only surfaces as a hover tooltip on the "by <name>" tag in the year log, so the loss is easy to miss.',
            },
          ],
        },

        // ------------------------------------------------------------------
        {
          id: 'pto-manager-add',
          title: 'Manager — adding PTO for someone',
          blocks: [
            {
              kind: 'p',
              text:
                'Use this when an engineer asks by phone, text or in person. There are two ways in: "+ Add PTO" in the panel header for the full form, or clicking an engineer’s chip in the attendance roll for the fast morning call-out.',
            },
            {
              kind: 'steps',
              items: [
                'Click "+ Add PTO". A panel slides in from the right. Clicking the greyed area outside will NOT close it — use the ✕ or Cancel.',
                'Pick the Engineer. Only active engineer-role accounts appear; managers and leads are not in the list.',
                'A balance card appears showing their Vacation and Sick hours left. "No balance row for this engineer yet" is fine — you can set the allotment afterwards.',
                'Choose the Type — Sick, Vacation, Floating Holiday, Bereavement, Leave, Short-Term or Jury Duty.',
                'Choose the Status. It defaults to "Approved (direct)", which logs it immediately with you recorded as the reviewer and skips the queue entirely. Pick "Pending (review queue)" if you want it reviewed instead.',
                'Set the dates. Leave Hours blank to accept the auto figure — read the next box for exactly how that figure is worked out.',
                'For a partial day: "Out from" is when they LEAVE, "Out until" is when they COME BACK. Both blank means a full day. A partial-day engineer still counts as present in the headcount, tagged "partial".',
                'Pick a Request source — Verbal, Phone call, Text, Email, Team or Other. This is required; the save is refused without it. Add a Source detail like "text 3:42pm" if it helps.',
                'Watch for a red cap box. Click Save PTO. Note this fires an email.',
              ],
            },
            {
              kind: 'note',
              tone: s.binney ? 'warn' : 'info',
              title: 'How the Hours auto-fill works',
              text: s.binney
                ? 'Add PTO uses the engineer’s own day length — ' + s.day + 'h for everyone except Justin McCarthy, who is on 8h — times EVERY day in the range, weekends included, because both crews work weekends. The quick call-out log matches: a full day is their day length, a partial day is half of it. One thing to watch: it counts calendar days, not the days that engineer is actually rostered. A Mon–Sun span auto-fills 70h even though a 4×10 crew only works 40h of it. Set From and To to the days they are actually scheduled, or type the hours in yourself.'
                : 'Add PTO uses the engineer’s own day length — ' + s.day + 'h unless someone has a custom day length set — times the number of Mon–Fri days in the range; Saturday and Sunday count as zero. The quick call-out log matches: a full day is their day length, a partial day is half of it.',
            },
            {
              kind: 'note',
              tone: 'info',
              title: 'The quick call-out log',
              text:
                'Clicking an engineer’s chip in the roll opens a small form pre-set for the morning call-out: Sick, source Phone call, reason "called out", that engineer’s own day length in hours, that one day only. Switch the type away from Sick and the "called out" reason clears itself. Anything logged this way saves as APPROVED immediately — it never reaches the queue. Entering a partial-day time halves the hours automatically, unless you typed your own figure first.',
            },
            {
              kind: 'note',
              tone: 'warn',
              title: 'Editing never re-checks the cap',
              text:
                'The Edit panel can move a record to ANY of the four states — including flipping a denied request back to approved or un-cancelling something — with no reason required and no cap re-check. You can stretch dates across a week that is already full and it saves silently. You cannot, however, move an entry to a different engineer: the name is locked. Delete it and add it again.',
            },
            {
              kind: 'note',
              tone: 'info',
              title: 'Cancel versus Delete',
              text:
                'Cancel (the ✕) keeps the row, marks it cancelled and leaves it greyed out in the engineer’s log — the audit trail survives, and cancelling an approved entry also clears the calendar. Delete (the trash) wipes the row permanently with no trace, and leaves any calendar invite stranded on everyone’s calendar forever. Use Cancel when someone changes their mind; Delete only for genuine mistakes and duplicates.',
            },
          ],
        },

        // ------------------------------------------------------------------
        {
          id: 'pto-manager-balances',
          title: 'Manager — setting an engineer’s allotment',
          blocks: [
            {
              kind: 'steps',
              items: [
                'In the PTO panel, scroll to the Balances block. ' +
                  (s.binney
                    ? 'It is split into three side-by-side tables — Saturday crew, Sunday crew, and Mon–Fri / no crew — with the headcount in each heading.'
                    : 'With more than six engineers it splits into two alphabetical halves.'),
                'Find the engineer. An amber "not set" badge with dashes in every column means they have no balance row for this year — the link on their row reads "set" rather than "edit".',
                'Check their seniority from the grey line under their name, e.g. "Hired 3/2/18 · 8.3 yr".',
                'Click set (or edit). A panel slides in titled "<Name> · <year> allotment".',
                'Expand "Vacation entitlement schedule" and type the matching flat hours into Vacation Allotted: 80 / 120 / 160 / 200.',
                'Expand "Sick day schedule (' + s.day + 'h/day · by length of service)" and type the hours it shows into Sick Allotted. At ' + s.label + ' the full 8 days is ' + s.sickHours(8) + '.',
                'Type the Floating Holiday allotment — normally ' + s.day + 'h for the one floating day. Leave it at 0 and the chip is hidden from the engineer entirely.',
                'Click Save. For a "not set" engineer this creates their record: the amber badge disappears and numbers replace the dashes.',
              ],
            },
            {
              kind: 'bullets',
              items: [
                'Only the three annual allotment numbers are editable. Used hours are recalculated from approved requests every time the screen loads — to fix a wrong "used" figure you must fix the underlying PTO entry.',
                'Click a balance column header (Vacation / Sick / Fl. Holiday) to sort by who has the LEAST left first — the fastest way to see who is running out. Click again to flip it. Engineers with no allotment always sink to the bottom. Click "Engineer" to sort by name.',
                'There is only ever one balance row per engineer per year; saving overwrites rather than adding a second.',
                'The balance record has a notes field, but there is no box for it anywhere in the editor — notes can only be set outside the app.',
              ],
            },
            {
              kind: 'note',
              tone: 'warn',
              title: 'This is a January job, every January',
              text:
                'Nothing rolls over and nothing accrues. If nobody sets the new year’s allotments, engineers do not get zeros — they simply vanish from the balances list and their own chips disappear. Put it in the calendar.',
            },
          ],
        },

        // ------------------------------------------------------------------
        {
          id: 'pto-cap',
          title: 'The two-engineer vacation cap',
          blocks: [
            {
              kind: 'p',
              text:
                'No more than two engineers may be on vacation over the same dates. The third person to ask trips the cap and can only be approved with an override. The number is 2 at both sites — it was not raised for Binney’s bigger roster.',
            },
            {
              kind: 'bullets',
              items: [
                'Only Vacation counts. Sick, Floating Holiday, Bereavement, Leave, Short-Term and Jury Duty never count — any number of engineers can be out on those at once.',
                'Pending vacation counts exactly the same as approved, so two requests nobody has looked at yet are enough to block a third person.',
                'A co-worker counts if their vacation touches yours by even one day. It counts distinct people, not requests — one person with three overlapping entries is still one.',
                'Any manager, admin or lead can override. There is no second signature and no limit on how often it is used.',
                'An override always needs a typed reason — the confirm button stays greyed out until you type one — and the reason is stored permanently on the record. Approved-over-cap entries carry an orange OVERRIDE badge; hover it to read the reason back.',
              ],
            },
            {
              kind: 'steps',
              items: [
                'To override while approving: find the card with the red edge. The green Approve button is not there — click the orange "Approve (override cap)" instead.',
                'Type your justification, e.g. "urgent family matter — Dariusz covering UP7", then "Approve with override".',
                'To override while adding directly: set Type to Vacation and Status to "Approved (direct)" on capped dates, then type into the "Override reason (logged)" box that appears. Without it the save is refused.',
                'To avoid the decision now: set Status to "Pending (review queue)" instead. It saves with no override and no reason, and the cap decision waits for whoever works the queue.',
              ],
            },
            {
              kind: 'note',
              tone: 'warn',
              title: 'The warning compares whole ranges, not individual days',
              text:
                'A long request can be flagged "cap exceeded" even when no single day actually has three people out. Asking for Mon–Fri when one engineer is off Mon–Tue and another Thu–Fri counts as two conflicts and trips the cap, though those two never overlap each other. The heatmap counts per day and will show only 1 on those days. Trust the heatmap for the day-by-day picture.',
            },
            {
              kind: 'note',
              tone: 'danger',
              title: 'The cap is a guardrail, not a lock',
              text:
                'Nothing in the database enforces it. It lives entirely in the dashboard screens as a warning. A bulk import, a SQL console, or any future screen that forgets the check will sail straight past it with no error.',
            },
            ...(s.binney
              ? [
                  {
                    kind: 'note' as const,
                    tone: 'warn' as const,
                    title: 'The cap is counted across the whole Binney roster, not per crew',
                    text:
                      'Two Sunday-crew engineers on vacation will block a Saturday-crew engineer for an overlapping date, even though the two crews barely share a workday. Expect to override more often than the rule suggests, and say why.',
                  },
                ]
              : []),
          ],
        },

        // ------------------------------------------------------------------
        {
          id: 'pto-coverage',
          title: 'Coverage — the roll, the heatmap and conflicts',
          blocks: [
            {
              kind: 'p',
              text: s.binney
                ? 'The attendance roll shows today plus the next six CALENDAR days — a full week, Saturday and Sunday included, because weekends are real workdays here. On any given day it hides the crews that are not scheduled, so you only see who is meant to be in. The "No shift" group is the exception and always shows. If the screen is too narrow for all seven day cards, the row scrolls sideways. Busy cards cap how many chips they show — Wednesday lists BOTH crews, so it collapses behind a "+N more" toggle; anyone who is out or partial is always kept visible, the cap only ever hides healthy "in" chips.'
                : 'The attendance roll shows today plus the next two WEEKdays — Saturday and Sunday are skipped.',
            },
            ...(s.binney
              ? [
                  {
                    kind: 'table' as const,
                    head: ['Crew', 'Works'],
                    rows: [
                      ['Sunday crew', 'Sunday through Wednesday'],
                      ['Saturday crew', 'Wednesday through Saturday'],
                      ['Mon–Fri shift', 'Monday through Friday'],
                      ['No shift assigned', 'Treated as working every day, so they never disappear from the roll'],
                    ],
                  },
                  {
                    kind: 'p' as const,
                    text:
                      'Both crews are in on Wednesday. The "X/Y in" headcount counts only the engineers whose crew is scheduled that day, so the Sunday crew does not read as "out" on a Friday. UPark, by contrast, counts every active engineer every day regardless of schedule.',
                  },
                ]
              : []),
            {
              kind: 'p',
              text:
                'The vacation heatmap shows the next 9 weeks by default; the buttons in its corner switch between 4, 9 and 13 weeks. ' +
                (s.binney
                  ? 'Each week is one ROW: days run Monday to Sunday across the top, and every row is labelled on the left with its Monday date — the current week highlighted — so you can locate the exact day to book or check without counting squares; hovering any cell shows the full date. Clicking a future cell opens Add PTO with that date filled in and the type pre-set to Vacation. The grid also keeps the two weeks BEFORE today on screen: past cells are faded but keep their colours and sick/leave markers, so last week’s call-outs stay visible when you are reconciling documented hours after the fact.'
                  : 'Weeks run Monday to Sunday down each column. Clicking a future cell opens Add PTO with that date filled in and the type pre-set to Vacation.'),
            },
            {
              kind: 'table',
              head: ['Cell', 'Means'],
              rows: [
                ['Green', 'Nobody on vacation'],
                ['Amber', '1 person'],
                ['Orange', '2 people — cap pinned, that day is full'],
                ['Red', '3 or more — only possible via an override'],
                s.binney
                  ? ['Faded colours', 'A past day — the two history weeks keep their colours for reference, but are not clickable']
                  : ['Faint grey', 'A past day'],
                ...(s.binney
                  ? [[
                      'Green outline',
                      'A BMR-observed building holiday — hover the cell for its name. Calendar marker only: it is not PTO, does not count toward the cap, and is unrelated to the Floating Holiday PTO type',
                    ]]
                  : []),
                ['Red dot, top-right', 'Someone is sick that day. Does not count toward the cap or change the colour'],
                ['Purple square, bottom-right', 'Someone is on bereavement, leave, short-term or jury duty. Does not count toward the cap'],
              ],
            },
            {
              kind: 'p',
              text:
                'Heatmap cells count pending vacation as well as approved, so a day can look full purely on requests nobody has approved yet. Hover the cell — pending people are marked "(pending)" by name.' +
                (s.binney
                  ? ' At Binney weekend squares look and behave exactly like weekdays. At UPark they are faded to half opacity.'
                  : ' Weekend squares are faded to about half opacity, but they are still clickable.'),
            },
            {
              kind: 'p',
              text: 'The Conflicts strip flags three things against approved, upcoming PTO:',
            },
            {
              kind: 'table',
              head: ['Flag', 'Severity', 'What it means'],
              rows: [
                ['On call that week', 'Red', 'A real double-booking'],
                ['Signed up for overtime inside the PTO', 'Red', 'A real double-booking — but only while the OT post is still OPEN. Filled or closed posts stop being reported'],
                ['Primary on a building', 'Amber', 'A standing reminder, not a clash — see below'],
              ],
            },
            {
              kind: 'note',
              tone: 'warn',
              title: 'The amber "assign coverage" line is not a clash',
              text:
                'It fires for EVERY upcoming approved PTO by anyone who is primary on any building, whatever the dates, and whether or not cover already exists. Only the red on-call and overtime lines represent an actual double-booking.',
            },
            {
              kind: 'note',
              tone: 'warn',
              title: 'Pending requests are never checked for conflicts',
              text:
                'Conflicts are only calculated for PTO that is already approved. A request sitting in your queue is never checked against on-call or overtime — so approving it can create a clash you were never warned about, which only appears in the strip afterwards.',
            },
            ...(s.binney
              ? [
                  {
                    kind: 'note' as const,
                    tone: 'danger' as const,
                    title: 'Read an empty Conflicts row at Binney as "not wired up", not "clear"',
                    text:
                      'The on-call, overtime, shift and building data behind those alerts is read from the UPark hooks with no Binney filter. They only fire for a Binney engineer who is actually in the UPark on-call rotation or OT signups — which in practice nobody is. Do not treat silence here as a verified all-clear.',
                  },
                ]
              : []),
          ],
        },

        // ------------------------------------------------------------------
        {
          id: 'pto-emails',
          title: 'Emails and calendar invites',
          blocks: [
            {
              kind: 'p',
              text: 'Email fires on exactly three moments. Everything else is silent.',
            },
            {
              kind: 'table',
              head: ['When', 'Who gets an email', 'Calendar'],
              rows: [
                ['An engineer submits a request', 'Managers at that engineer’s home site. The engineer gets no confirmation', 'Nothing'],
                ['A request is approved or denied', 'Those same managers plus the engineer. The decider gets a copy of their own decision', 'An approval sends an invite. A denial after an approval cancels it'],
                ['An approved request is cancelled', 'Nobody', 'A calendar cancellation — that is the only notice anyone gets'],
                ['An APPROVED request’s dates, hours or type are edited', 'Nobody', 'The calendar event moves to the new dates — the old event is removed and replaced. Editing a request that is already fully in the past stays silent'],
                ['Anything else — editing the reason, editing a pending request, withdrawing, deleting', 'Nobody', 'Nothing'],
              ],
            },
            {
              kind: 'bullets',
              items: [
                'Subjects read "[PTO — ' + s.label + '] New request — <engineer> — <type> <dates>", or "Approved" / "Denied" once decided. The body is a small table: engineer, type, dates with day count and hours, plus partial day and reason when filled in, and a plain written-out link to the manager dashboard (deliberately not a styled button — corporate mail filters treat those as phishing bait). Decision emails also name the decider: "Approved by <name>" or "Denied by <name>".',
                'A manager adding PTO already marked Approved skips the "new request" email and goes straight to the decision email.',
                'Who counts as a "manager" for email is the Manager on/off switch on each user profile — not the role badge. Someone whose role says Manager with the switch off gets NO email; a lead engineer with the switch on does. Only an Admin can flip it.',
                'If email or the invite fails for any reason, the PTO still saves. A silent email failure leaves no sign in the app.',
              ],
            },
            {
              kind: 'p',
              text: 'Who receives the approved-PTO calendar invite depends on the site, and the two rules are genuinely different:',
            },
            {
              kind: 'table',
              head: ['Site', 'Invite goes to'],
              rows: [
                ['UPark', 'Every active home-site manager, plus the engineer whose PTO it is, plus any extra addresses on the invite list. The list only ADDS people on top'],
                ['Binney St', 'Nobody directly. A sync email goes to the shared-calendar feed inbox, and an automated flow copies the event onto the CW Binney Engineering shared group calendar with the title "PTO — <name> (<type> <hours>h)". Once the system launches, home managers will also get a personal invite; while it is in develop mode they get nothing'],
              ],
            },
            {
              kind: 'p',
              text:
                'The row at the bottom of the panel tells you which rule is in force before you expand it: UPark reads "Calendar invites · N managers · N engineers · N extras"; Binney reads "PTO calendar · N sync inboxes · N personal" and opens into TWO lists. The shared-calendar sync list is ADMIN-ONLY — emptying it turns the shared calendar sync off with no fallback, and the panel warns in red. The personal invite list (home managers built in, extras added below) is editable by admins and managers. Directors can see everything but not edit; engineers cannot see it at all. Changes take effect immediately — there is no Save button.',
            },
            {
              kind: 'note',
              tone: 'warn',
              title: 'An extra address gets everything',
              text:
                'Anyone added as an extra on the personal invite list receives EVERY approved-PTO invite and every cancellation for that site. It cannot be filtered to one engineer or one type of leave. They get invites only — never the New request or Approved/Denied emails. At Binney these invites are muted entirely until launch.',
            },
            ...(s.binney
              ? [
                  {
                    kind: 'note' as const,
                    tone: 'danger' as const,
                    title: 'Two ways the Binney shared calendar breaks silently',
                    text:
                      'If the shared-calendar sync list is ever emptied, the group calendar simply stops updating — there is no fallback and no error anywhere; the panel warns in red. And the copying itself is done by an automated flow that lives outside the dashboard — if that flow is switched off or errors, sync emails keep arriving in the feed inbox but nothing lands on the calendar. Cancellations are not yet removed automatically, so a retracted PTO may need deleting from the group calendar by hand.',
                  },
                ]
              : []),
            {
              kind: 'note',
              tone: 'danger',
              title: 'Two ways to strand a calendar entry',
              text:
                'Changing the dates on an already-approved PTO does NOT re-issue the invite — the original stays on everyone’s calendar showing the OLD dates. And Delete sends nothing, so a deleted approved entry leaves its invite on every calendar forever. To correct a calendar you must Cancel the approved request (which sends the cancellation) and re-enter it.',
            },
          ],
        },

        // ------------------------------------------------------------------
        {
          id: 'pto-gotchas',
          title: 'Known gaps — read before you trust the screen',
          blocks: [
            {
              kind: 'p',
              text:
                'These are real, verified behaviors of the system as it stands today, not hypotheticals. They are listed here rather than quietly left out, because every one of them has a way of biting somebody.',
            },
            {
              kind: 'bullets',
              items: [
                'Approve, Deny, Cancel and Delete never show an error. A refused write does nothing at all and says nothing. Always confirm the card actually moved.',
                'A denial reason and the reviewer’s name are stored but never shown on any screen. The decision email is the only copy.',
                'Denying a request whose last day has already passed notifies NOBODY — the historical guard suppresses the email. Combined with the point above, a late-filed sick day that gets denied leaves the engineer with a faded "denied" badge and no way at all to learn why. Tell them in person.',
                'Approving a request erases any review note already on it, and stamps the new approver over the original reviewer.',
                'The pending queue never empties itself, and sorts by the date off rather than by who has waited longest.',
                'Nothing prevents the same engineer being booked off twice for the same day, or a duplicate week being entered twice. Catching duplicates is a human job.',
                'Nothing compares a request against the balance — not at submit, not at approval. A manager can approve 200h against a 160h allotment with no warning beyond a red chip afterwards.',
                'While the site roster is still loading, the PTO lists — and the cap warning on the engineer form — fail OPEN and briefly render unfiltered: the panel can flash the other site’s people. Do not act on the first paint.',
                'The site split is a screen convenience, not a security boundary. Any signed-in account can read every PTO record at both sites, and the database would let a ' + s.label + ' manager edit the other site’s PTO. Cross-site mix-ups will be UI mistakes, never database refusals.',
                'The engineer type list (four choices) is enforced by the dropdown only. The database does not check the type on an engineer’s own request.',
                'A manager with no home site set on their profile receives NO PTO emails for any site, silently. An ENGINEER with no home site is treated as UPark. New people are added with a blank home site by default — fill it in.',
                'There is currently no in-app way for a manager or admin to file their own PTO: the Add PTO dropdown lists engineer-role accounts only.',
              ],
            },
          ],
        },
      ],
    },
  ];
}
