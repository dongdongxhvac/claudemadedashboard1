// notify-pto — Supabase Edge Function.
//
// !! THIS FILE MUST STAY IN SYNC WITH THE DEPLOYED FUNCTION !!
// The CODE below is functionally identical to deployed v16. NOTE: the
// deployed copy carries a THINNER header comment block than this one — when
// you `supabase functions download notify-pto` and diff, expect the header
// comments to differ; the code from the first `import` down must match. Work
// on the laptop deploys straight from `supabase functions deploy`, so diff
// before editing. Deploying a stale copy silently breaks the Power Automate
// flow (see PTO_DATA below).
//
// v17 (2026-07-16): Binney manager-email mute RE-ENABLED — Binney PTO is in
// develop mode; managers get no notification emails until launch. The
// PA-flow calendar email (to jie.lao) still sends. Remove the marked line
// below to go live.
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
//    The .ics is still attached (harmless, and the personal-calendar path
//    still works for UPark).
//
//    Invite recipients per site:
//      UPark  — home-site managers + the requesting engineer, plus extras
//               from pto_cal_recipients (migration 0096, editable in-panel).
//      Binney — ONLY the pto_cal_recipients list, which is deliberately just
//               jie.lao@cwservices.com: that inbox feeds the PA flow, which
//               republishes to the group calendar. The group SMTP address is
//               intentionally NOT here — adding it back emails ~24 people an
//               invite with the raw PTO_DATA line in it. Empty list falls
//               back to the UPark rule.
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

async function calRecipients(
  admin: ReturnType<typeof createClient>,
  siteId: string,
  siteCode: string,
): Promise<string[]> {
  const envV = Deno.env.get(`PTO_CAL_TO_${siteCode.toUpperCase()}`) ?? "";
  if (envV) return envV.split(",").map((s) => s.trim()).filter((e) => /@/.test(e));
  const { data, error } = await admin
    .from("pto_cal_recipients")
    .select("email")
    .eq("site_id", siteId);
  if (error) throw error;
  return (data ?? [])
    .map((r) => ((r.email as string) ?? "").trim())
    .filter((e) => /@/.test(e));
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

    let calTo: string[] = [];
    if (inviteAction) {
      const listed = await calRecipients(admin, site.id as string, site.code as string);
      const merged = new Map<string, string>();
      if (site.code === "binney" && listed.length > 0) {
        for (const e of listed) merged.set(e.toLowerCase(), e);
      } else {
        for (const e of managerEmails) merged.set(e.toLowerCase(), e);
        const reqEmail = (requester?.email ?? "").trim();
        if (/@/.test(reqEmail)) merged.set(reqEmail.toLowerCase(), reqEmail);
        for (const e of listed) merged.set(e.toLowerCase(), e);
      }
      calTo = [...merged.values()];
    }

    let effectiveTo = payload.override_to?.length ? payload.override_to : resolvedTo;
    if (QA_FORCE_TO) {
      const forced = QA_FORCE_TO.split(",").map((s) => s.trim()).filter(Boolean);
      effectiveTo = forced;
      if (calTo.length) calTo = forced;
    }
    if (payload.event === "retracted") effectiveTo = [];

    // DEVELOP MODE (re-enabled 2026-07-16): Binney PTO is not launched — no
    // manager notification emails. The calendar email (feeds the PA flow)
    // still sends. Delete this line at launch and redeploy.
    if (site.code === "binney") effectiveTo = [];

    if (payload.dry_run) {
      return json(200, {
        ok: true, dry_run: true, event: payload.event, site: site.code,
        subject, resolved_to: resolvedTo, effective_to: effectiveTo,
        invite: inviteAction ? { action: inviteAction, to: calTo } : null,
      });
    }
    if (effectiveTo.length === 0 && !(inviteAction && calTo.length)) {
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
          content: asciiSafe(
            (inviteAction === "CANCEL"
              ? `This PTO was retracted - the calendar event is cancelled.\n\n${who} - ${tl} ${range}`
              : `Approved PTO - calendar invite attached.\n\n${who} - ${tl} ${range}\n\nIf your mail client doesn't show Accept, open invite.ics.`)
            + `\n\nPTO_DATA|action:${inviteAction}|id:${r.id}|starts:${r.starts_on}|ends:${r.ends_on}|hours:${r.hours}|engineer:${who}|type:${tl}`,
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
      invite_action: inviteAction,
    });
  } catch (e) {
    return json(500, { error: (e as Error).message });
  }
});
