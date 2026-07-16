// notify-pto — Supabase Edge Function.
//
// !! THIS FILE MUST STAY IN SYNC WITH THE DEPLOYED FUNCTION !!
// This file was deployed VERBATIM as v19 — repo and live are identical.
// Work on the laptop deploys straight from `supabase functions deploy`, so
// before editing here run `supabase functions download notify-pto` and diff.
// Deploying a stale copy silently breaks the Power Automate flow (see
// PTO_DATA below).
//
// v19 (2026-07-16): two recipient lists (migration 0102 adds kind):
//   * kind='feed'   — SHARED calendar sync inboxes (admin-only in panel).
//     Binney sends the body-only PTO_DATA email here (jie.lao); Power
//     Automate writes the event onto the group calendar. Always on.
//     No .ics = can never book a personal calendar.
//   * kind='invite' — PERSONAL calendar extras on top of the built-ins
//     (home managers + requester at UPark; home managers at Binney).
// Binney's .ics invites + notification emails are gated behind BINNEY_LIVE.
//
// BINNEY_LIVE — THE DEVELOP-MODE SWITCH. Resolved per event: env var
// BINNEY_LIVE first, then Vault. Anything except the string "true" =
// develop mode (managers get NOTHING; only the PA feed sends). Flip it
// WITHOUT a redeploy, from the Supabase SQL editor:
//   select set_app_secret('BINNEY_LIVE', 'true');   -- launch
//   select set_app_secret('BINNEY_LIVE', 'false');  -- back to develop mode
//
// Invoked by the DB trigger pto_requests_notify_trg (migrations 0094/0095)
// via pg_net on INSERT/UPDATE of pto_requests. The trigger also carries a
// backfill/past-date guard: it suppresses sends when request_source =
// 'ontheclock_csv' or ends_on < current_date. Two jobs:
//
// 1) NOTIFICATION EMAILS (site-aware)
//    'submitted' → active is_manager users homed at the requester's site
//                  (engineer_profiles.home_site_id; NULL = UPark).
//    'decided'   → those managers PLUS the requester.
//    NOTE: is_manager is ALSO a permission flag — current_user_is_manager()
//    (migration 0031) gates buildings/on-call proposal publishing, MRO
//    receipt capture + billing, and overtime management. NEVER flip it just
//    to silence email; it silently strips those rights.
//
// 2) CALENDAR EVENTS — via Power Automate, NOT via the .ics
//    Direct invites do not work here: accepting an .ics only books a
//    PERSONAL calendar, Outlook blocks importing to a shared calendar, and
//    Mimecast strips the .ics attachment in transit. So the invite email's
//    BODY carries a machine-readable line that survives Mimecast:
//
//      PTO_DATA|action:REQUEST|id:<uuid>|starts:<iso>|ends:<iso>|hours:<n>|engineer:<name>|type:<label>
//
//    A Power Automate flow ("PTO to Binney shared calendar", cloud-only —
//    NOT in this repo) watches the Binney Gmail folder, parses that line and
//    writes the event onto the M365 group calendar via the Office 365 Groups
//    connector. GOTCHAS, learned the hard way:
//      * Delimit with ':' — NEVER '='. Quoted-printable uses '=' as its
//        soft-wrap/escape char and corrupts the line depending on length.
//      * The flow strips %0D/%0A before parsing so wraps can't split a marker.
//      * The first attachment is the "External Mail" banner (0.jpg), not the
//        .ics — parse the BODY, never attachments.
//    Recipients per site (v19, kinds from migration 0102):
//      UPark  — .ics invite → home-site managers + the requesting engineer,
//               plus kind='invite' extras. 'feed' rows are ignored until
//               UPark gets its own PA flow.
//      Binney — PA feed (body-only, PTO_DATA, no .ics) → kind='feed' rows
//               (jie.lao); .ics invite → home managers + kind='invite'
//               extras, only when BINNEY_LIVE. The group SMTP address must
//               NOT be added to either list — that emails ~24 people
//               directly.
//
// Transport is Gmail SMTP, per-site sender: GMAIL_USER_<SITE> +
// GMAIL_APP_PASSWORD_<SITE> (env first, then the get_app_secret Vault
// accessor, migration 0078), falling back to the default GMAIL_USER pair.
// Resend's testing mode can't reach arbitrary recipients.
//
// Deployed with verify_jwt ENABLED: the trigger authenticates with the
// project anon key (a valid signed JWT, public by design).
//
// QA hooks (never set by the trigger):
//   payload.dry_run      — resolve recipients + invite plan, send nothing.
//   payload.override_to  — notification emails only: replace the real list.
//   env PTO_QA_FORCE_TO  — global override for BOTH sends (staging-style).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const DASHBOARD_BASE = Deno.env.get("PTO_DASHBOARD_BASE") ?? "https://claudemadedashboard1.vercel.app";
const QA_FORCE_TO = Deno.env.get("PTO_QA_FORCE_TO") ?? "";

/** Binney launch switch (develop mode when false) — env first, then Vault,
 *  so it flips with SQL and no redeploy:
 *    select set_app_secret('BINNEY_LIVE', 'true' | 'false');
 *  Unset/anything-but-"true" = develop mode. */
async function binneyLive(admin: ReturnType<typeof createClient>): Promise<boolean> {
  let v = (Deno.env.get("BINNEY_LIVE") ?? "").trim();
  if (!v) {
    const { data } = await admin.rpc("get_app_secret", { k: "BINNEY_LIVE" });
    v = ((data as string) ?? "").trim();
  }
  return v.toLowerCase() === "true";
}

type PtoRecord = {
  id: string;
  user_id: string;
  type: string;
  starts_on: string;
  ends_on: string;
  hours: number;
  status: string;
  reason: string | null;
  out_from: string | null;
  out_until: string | null;
  request_source: string | null;
  reviewed_by: string | null;
  review_note: string | null;
};

type Payload = {
  type: "pto_request";
  event: "submitted" | "decided" | "retracted";
  prev_status?: string | null;
  record: PtoRecord;
  dry_run?: boolean;
  override_to?: string[];
};

const TYPE_LABELS: Record<string, string> = {
  vacation: "Vacation",
  sick: "Sick",
  bereavement: "Bereavement",
  holiday: "Floating Holiday",
  unpaid: "Unpaid",
};

function typeLabel(t: string): string {
  return TYPE_LABELS[t] ?? t;
}

function fmtDay(iso: string): string {
  const d = new Date(iso + "T00:00:00Z");
  const wd = d.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });
  const [, m, dd] = iso.split("-").map(Number);
  return `${wd} ${m}/${dd}`;
}

function fmtRange(starts: string, ends: string): string {
  return starts === ends ? fmtDay(starts) : `${fmtDay(starts)} - ${fmtDay(ends)}`;
}

function fmtTime12(hhmm: string | null): string {
  if (!hhmm) return "";
  const [hStr, mStr] = hhmm.split(":");
  const h = Number(hStr);
  const m = Number(mStr ?? "0");
  const ampm = h < 12 ? "a" : "p";
  const h12 = h % 12 || 12;
  return m === 0 ? `${h12}${ampm}` : `${h12}:${String(m).padStart(2, "0")}${ampm}`;
}

function partialLabel(r: PtoRecord): string | null {
  if (!r.out_from && !r.out_until) return null;
  if (!r.out_from) return `in at ${fmtTime12(r.out_until)}`;
  if (!r.out_until) return `out from ${fmtTime12(r.out_from)}`;
  return `${fmtTime12(r.out_from)}-${fmtTime12(r.out_until)}`;
}

function asciiSafe(s: string): string {
  return s
    .replace(/[·]/g, "-")
    .replace(/[—–]/g, "-")
    .normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/[^\x20-\x7E\n\r\t]/g, "?");
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" } as Record<string, string>)[c]);
}

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function icsEscape(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

function icsFold(line: string): string {
  const out: string[] = [];
  let s = line;
  while (s.length > 74) {
    out.push(s.slice(0, 74));
    s = " " + s.slice(74);
  }
  out.push(s);
  return out.join("\r\n");
}

function icsDate(iso: string): string {
  return iso.replaceAll("-", "");
}

function icsAddDays(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function buildIcs(opts: {
  method: "REQUEST" | "CANCEL";
  uid: string;
  summary: string;
  description: string;
  startIso: string;
  endIso: string;
  organizerEmail: string;
  organizerName: string;
  attendees: string[];
}): string {
  const dtstamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const lines = [
    "BEGIN:VCALENDAR",
    "PRODID:-//UPark Dashboard//PTO//EN",
    "VERSION:2.0",
    `METHOD:${opts.method}`,
    "BEGIN:VEVENT",
    `UID:${opts.uid}`,
    `DTSTAMP:${dtstamp}`,
    `DTSTART;VALUE=DATE:${icsDate(opts.startIso)}`,
    `DTEND;VALUE=DATE:${icsDate(icsAddDays(opts.endIso, 1))}`,
    `SUMMARY:${icsEscape(asciiSafe(opts.summary))}`,
    `DESCRIPTION:${icsEscape(asciiSafe(opts.description))}`,
    `ORGANIZER;CN=${icsEscape(asciiSafe(opts.organizerName))}:mailto:${opts.organizerEmail}`,
    ...opts.attendees.map((a) =>
      `ATTENDEE;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=FALSE:mailto:${a}`),
    `STATUS:${opts.method === "CANCEL" ? "CANCELLED" : "CONFIRMED"}`,
    "TRANSP:TRANSPARENT",
    "X-MICROSOFT-CDO-BUSYSTATUS:FREE",
    "X-MICROSOFT-DISALLOW-COUNTER:TRUE",
    `SEQUENCE:${opts.method === "CANCEL" ? 1 : 0}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.map(icsFold).join("\r\n") + "\r\n";
}

/** pto_cal_recipients split by kind (migration 0102):
 *  feed = shared-calendar sync inboxes (Binney PA flow; admin-only in panel),
 *  invite = personal-calendar .ics extras. PTO_CAL_TO_<SITE> env override
 *  (QA) replaces the site's primary list: feed at Binney, invite at UPark. */
async function calRecipients(
  admin: ReturnType<typeof createClient>,
  siteId: string,
  siteCode: string,
): Promise<{ feed: string[]; invite: string[] }> {
  const envV = Deno.env.get(`PTO_CAL_TO_${siteCode.toUpperCase()}`) ?? "";
  if (envV) {
    const list = envV.split(",").map((s) => s.trim()).filter((e) => /@/.test(e));
    return siteCode === "binney" ? { feed: list, invite: [] } : { feed: [], invite: list };
  }
  const { data, error } = await admin
    .from("pto_cal_recipients")
    .select("email, kind")
    .eq("site_id", siteId);
  if (error) throw error;
  const rows = (data ?? []) as { email: string | null; kind: string | null }[];
  const clean = (k: string) => rows
    .filter((r) => (r.kind ?? "invite") === k)
    .map((r) => (r.email ?? "").trim())
    .filter((e) => /@/.test(e));
  return { feed: clean("feed"), invite: clean("invite") };
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  let payload: Payload;
  try { payload = await req.json(); } catch { return json(400, { error: "invalid json" }); }
  if (payload.type !== "pto_request" || !payload.record?.id) {
    return json(400, { error: "unknown payload" });
  }
  if (!["submitted", "decided", "retracted"].includes(payload.event)) {
    return json(400, { error: "unknown event" });
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

  try {
    const { data: reqRows, error: reqErr } = await admin
      .from("v_pto_requests_enriched")
      .select("*")
      .eq("id", payload.record.id);
    if (reqErr) throw reqErr;
    const r = reqRows?.[0];
    if (!r) return json(404, { error: "request not found" });

    const { data: requester, error: uErr } = await admin
      .from("users")
      .select("id, email, full_name, engineer_profiles(home_site_id)")
      .eq("id", r.user_id)
      .maybeSingle();
    if (uErr) throw uErr;
    type EpRow = { home_site_id: string | null };
    const ep = Array.isArray(requester?.engineer_profiles)
      ? (requester?.engineer_profiles as EpRow[])[0]
      : (requester?.engineer_profiles as EpRow | null);

    const { data: sites, error: sErr } = await admin.from("sites").select("id, code, name");
    if (sErr) throw sErr;
    const upark = (sites ?? []).find((s) => s.code === "upark");
    const site = (sites ?? []).find((s) => s.id === ep?.home_site_id) ?? upark;
    if (!site) return json(500, { error: "sites table empty" });

    const { data: managers, error: mErr } = await admin
      .from("users")
      .select("id, email, full_name, engineer_profiles!inner(home_site_id)")
      .eq("is_manager", true)
      .eq("active", true)
      .eq("engineer_profiles.home_site_id", site.id);
    if (mErr) throw mErr;

    const managerEmails = (managers ?? [])
      .map((m) => (m.email ?? "").trim())
      .filter((e) => /@/.test(e));

    const recipients = new Set(managerEmails.map((e) => e.toLowerCase()));
    if (payload.event === "decided") {
      const reqEmail = (requester?.email ?? "").trim();
      if (/@/.test(reqEmail)) recipients.add(reqEmail.toLowerCase());
    }
    const resolvedTo = [...recipients];

    const who = r.user_full_name ?? requester?.full_name ?? "Unknown";
    const range = fmtRange(r.starts_on, r.ends_on);
    const tl = typeLabel(r.type);
    const partial = partialLabel(r);
    const decision = r.status === "approved" ? "Approved" : r.status === "denied" ? "Denied" : r.status;
    const dashUrl = `${DASHBOARD_BASE}${site.code === "binney" ? "/binney/manager" : "/upark/manager"}`;

    const subject = asciiSafe(payload.event === "submitted"
      ? `[PTO - ${site.name}] New request - ${who} - ${tl} ${range}`
      : `[PTO - ${site.name}] ${decision} - ${who} - ${tl} ${range}`);

    const rows: [string, string][] = [
      ["Engineer", who],
      ["Type", tl],
      ["Dates", `${range} (${r.days} day${r.days === 1 ? "" : "s"} - ${r.hours}h)`],
    ];
    if (partial) rows.push(["Partial day", partial]);
    if (r.reason) rows.push(["Reason", r.reason]);
    if (payload.event === "submitted") {
      rows.push(["Status", "Pending approval"]);
      if (r.submitted_by_name && r.submitted_by !== r.user_id) {
        rows.push(["Entered by", r.submitted_by_name]);
      }
    } else {
      rows.push(["Decision", decision]);
      if (r.reviewed_by_name) rows.push(["By", r.reviewed_by_name]);
      if (r.review_note) rows.push(["Note", r.review_note]);
    }

    const heading = payload.event === "submitted"
      ? "New PTO request - needs review"
      : `PTO request ${decision.toLowerCase()}`;
    const html = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, sans-serif; max-width: 560px;">
        <h2 style="margin:0 0 12px 0;">${escapeHtml(heading)}</h2>
        <table style="border-collapse: collapse; font-size: 14px;">
          ${rows.map(([k, v]) =>
            `<tr><td style="padding: 4px 12px 4px 0; color:#666;">${escapeHtml(k)}</td><td><strong>${escapeHtml(String(v))}</strong></td></tr>`
          ).join("")}
        </table>
        <p style="margin-top:16px;">
          <a href="${dashUrl}" style="display:inline-block; padding:8px 14px; background:#4f46e5; color:#fff; border-radius:4px; text-decoration:none;">
            Open ${escapeHtml(site.name)} dashboard
          </a>
        </p>
      </div>`;
    const text = asciiSafe(`${heading}\n\n` +
      rows.map(([k, v]) => `${k}: ${v}`).join("\n") +
      `\n\n${dashUrl}`);

    let inviteAction: "REQUEST" | "CANCEL" | null = null;
    if (payload.event === "decided" && r.status === "approved") {
      inviteAction = "REQUEST";
    } else if (payload.event === "retracted") {
      inviteAction = "CANCEL";
    } else if (payload.event === "decided" && r.status === "denied" && payload.prev_status === "approved") {
      inviteAction = "CANCEL";
    }

    const live = site.code === "binney" ? await binneyLive(admin) : true;

    let calTo: string[] = [];     // .ics invite — books personal calendars
    let paFeedTo: string[] = [];  // Binney body-only PTO_DATA email — PA flow feed
    if (inviteAction) {
      const lists = await calRecipients(admin, site.id as string, site.code as string);
      if (site.code === "binney") {
        // PA feed → 'feed' rows (jie.lao). No .ics attached, so it can never
        // book a personal calendar. Always on.
        paFeedTo = lists.feed;
        // Real .ics invite → home managers + 'invite' extras. Launch only.
        if (live) {
          const merged = new Map<string, string>();
          for (const e of managerEmails) merged.set(e.toLowerCase(), e);
          for (const e of lists.invite) merged.set(e.toLowerCase(), e);
          calTo = [...merged.values()];
        }
      } else {
        const merged = new Map<string, string>();
        for (const e of managerEmails) merged.set(e.toLowerCase(), e);
        const reqEmail = (requester?.email ?? "").trim();
        if (/@/.test(reqEmail)) merged.set(reqEmail.toLowerCase(), reqEmail);
        for (const e of lists.invite) merged.set(e.toLowerCase(), e);
        calTo = [...merged.values()];
      }
    }

    let effectiveTo = payload.override_to?.length ? payload.override_to : resolvedTo;
    if (QA_FORCE_TO) {
      const forced = QA_FORCE_TO.split(",").map((s) => s.trim()).filter(Boolean);
      effectiveTo = forced;
      if (calTo.length) calTo = forced;
      if (paFeedTo.length) paFeedTo = forced;
    }
    if (payload.event === "retracted") effectiveTo = [];

    // Develop mode: no Binney manager notification emails until launch.
    if (site.code === "binney" && !live) effectiveTo = [];

    if (payload.dry_run) {
      return json(200, {
        ok: true, dry_run: true, event: payload.event, site: site.code,
        subject, resolved_to: resolvedTo, effective_to: effectiveTo,
        invite: inviteAction ? { action: inviteAction, to: calTo } : null,
        pa_feed: paFeedTo.length ? paFeedTo : null,
        binney_live: site.code === "binney" ? live : null,
      });
    }
    if (effectiveTo.length === 0 && !(inviteAction && (calTo.length || paFeedTo.length))) {
      return json(200, { ok: true, skipped: "no recipients" });
    }

    async function lookupCreds(userKey: string, passKey: string): Promise<{ user: string; pass: string }> {
      let user = Deno.env.get(userKey) ?? "";
      let pass = Deno.env.get(passKey) ?? "";
      if (!user || !pass) {
        const [u, p] = await Promise.all([
          admin.rpc("get_app_secret", { k: userKey }),
          admin.rpc("get_app_secret", { k: passKey }),
        ]);
        user = user || ((u.data as string) ?? "");
        pass = pass || ((p.data as string) ?? "");
      }
      return { user: user.trim(), pass: pass.replace(/\s+/g, "") };
    }
    const siteSuffix = (site.code as string).toUpperCase();
    let { user: gmailUser, pass: gmailPass } = await lookupCreds(
      `GMAIL_USER_${siteSuffix}`, `GMAIL_APP_PASSWORD_${siteSuffix}`,
    );
    if (!gmailUser || !gmailPass) {
      ({ user: gmailUser, pass: gmailPass } = await lookupCreds("GMAIL_USER", "GMAIL_APP_PASSWORD"));
    }
    if (!gmailUser || !gmailPass) return json(500, { error: "gmail credentials not configured" });

    const client = new SMTPClient({
      connection: {
        hostname: "smtp.gmail.com",
        port: 465,
        tls: true,
        auth: { username: gmailUser, password: gmailPass },
      },
    });
    let inviteSentTo: string[] = [];
    let paFeedSentTo: string[] = [];
    try {
      if (effectiveTo.length > 0) {
        await client.send({
          from: `${site.name} Dashboard <${gmailUser}>`,
          to: effectiveTo,
          subject,
          content: text,
          html,
        });
      }

      // Binney PA feed: body-only, NO .ics — Power Automate parses the
      // PTO_DATA line and writes the event to the group calendar. Subject
      // must keep containing "PTO" (the flow's trigger filter).
      if (inviteAction && paFeedTo.length > 0) {
        const feedSubject = asciiSafe(
          (inviteAction === "CANCEL" ? "Canceled: " : "") + `PTO - ${who} (${tl}) ${range}`,
        );
        await client.send({
          from: `${site.name} Dashboard <${gmailUser}>`,
          to: paFeedTo,
          subject: feedSubject,
          content: asciiSafe(
            (inviteAction === "CANCEL"
              ? `PTO retracted - remove from the group calendar.`
              : `Approved PTO - group calendar sync record.`) +
            `\n\n${who} - ${tl} ${range} (${r.hours}h)` +
            `\n\nPTO_DATA|action:${inviteAction}|id:${r.id}|starts:${r.starts_on}|ends:${r.ends_on}|hours:${r.hours}|engineer:${who}|type:${tl}`,
          ),
        });
        paFeedSentTo = paFeedTo;
      }

      if (inviteAction && calTo.length > 0) {
        const ics = buildIcs({
          method: inviteAction,
          uid: `pto-${r.id}@claudemadedashboard1.vercel.app`,
          summary: `PTO - ${who} (${tl})`,
          description:
            `${who} - ${tl} ${range} (${r.hours}h)` +
            (partial ? ` - ${partial}` : "") +
            (r.reason ? `\nReason: ${r.reason}` : "") +
            `\n${dashUrl}`,
          startIso: r.starts_on,
          endIso: r.ends_on,
          organizerEmail: gmailUser,
          organizerName: `${site.name} Dashboard`,
          attendees: calTo,
        });
        const invSubject = asciiSafe(
          (inviteAction === "CANCEL" ? "Canceled: " : "") + `PTO - ${who} (${tl}) ${range}`,
        );
        await client.send({
          from: `${site.name} Dashboard <${gmailUser}>`,
          to: calTo,
          subject: invSubject,
          // No PTO_DATA line here — the PA feed email carries it; keep the
          // human-facing invite clean.
          content: asciiSafe(
            inviteAction === "CANCEL"
              ? `This PTO was retracted - the calendar event is cancelled.\n\n${who} - ${tl} ${range}`
              : `Approved PTO - calendar invite attached.\n\n${who} - ${tl} ${range}\n\nIf your mail client doesn't show Accept, open invite.ics.`,
          ),
          attachments: [{
            filename: "invite.ics",
            content: btoa(ics),
            encoding: "base64",
            contentType: `text/calendar; method=${inviteAction}; charset=utf-8`,
          }],
        });
        inviteSentTo = calTo;
      }
    } finally {
      try { await client.close(); } catch { /* already closed */ }
    }

    return json(200, {
      ok: true, event: payload.event, site: site.code,
      sent_to: effectiveTo, invite_sent_to: inviteSentTo,
      pa_feed_sent_to: paFeedSentTo, invite_action: inviteAction,
    });
  } catch (e) {
    return json(500, { error: (e as Error).message });
  }
});
