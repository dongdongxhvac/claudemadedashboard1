// notify-pto — Supabase Edge Function.
//
// Invoked by the DB trigger pto_requests_notify_trg (migrations 0094/0095)
// via pg_net on INSERT/UPDATE of pto_requests. Two jobs:
//
// 1) NOTIFICATION EMAILS (site-aware)
//    event 'submitted' (new pending request)
//      → email every ACTIVE user with is_manager=true homed at the
//        requester's site (engineer_profiles.home_site_id; NULL = UPark).
//    event 'decided' (status → approved/denied, or inserted as approved)
//      → email those home-site managers PLUS the requester.
//
// 2) CALENDAR INVITES (.ics) — no Power Automate required
//    approved            → iCalendar METHOD:REQUEST (all-day, shows as Free)
//                          to the site's calendar list.
//    approved→cancelled  → event 'retracted': METHOD:CANCEL with the same
//                          UID retracts it (no notification email — the
//                          calendar cancel itself lands in inboxes).
//    approved→denied     → 'decided' Denied email + METHOD:CANCEL.
//    Recipients per site: env PTO_CAL_TO_UPARK / PTO_CAL_TO_BINNEY, falling
//    back to get_app_secret() Vault keys of the same name (comma-separated
//    emails — currently the test users, later a group address). Empty/unset
//    = no site list — but the REQUESTER's own email is always included, so
//    the engineer's work calendar gets the event at both sites. Attendees
//    carry RSVP=FALSE + X-MICROSOFT-CDO-BUSYSTATUS:FREE: on M365 the event
//    auto-appears on arrival and Outlook asks for no response.
//
// Recipient control for notifications is the users.is_manager toggle in the
// admin view — no hardcoded names. Transport is Gmail SMTP (email-report
// pattern); Resend's testing mode can't reach arbitrary recipients.
//
// Deployed with verify_jwt ENABLED: the DB trigger authenticates with the
// project anon key (a valid signed JWT, public by design).
//
// Credentials: GMAIL_USER + GMAIL_APP_PASSWORD from edge secrets, falling
// back to the get_app_secret() Vault accessor (migration 0078).
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

/** 'YYYY-MM-DD' → 'Mon 7/13' without timezone drift (UTC-pinned). */
function fmtDay(iso: string): string {
  const d = new Date(iso + "T00:00:00Z");
  const wd = d.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });
  const [, m, dd] = iso.split("-").map(Number);
  return `${wd} ${m}/${dd}`;
}

function fmtRange(starts: string, ends: string): string {
  return starts === ends ? fmtDay(starts) : `${fmtDay(starts)} – ${fmtDay(ends)}`;
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
  return `${fmtTime12(r.out_from)}–${fmtTime12(r.out_until)}`;
}

/** SMTP header + text-part safety: denomailer 1.6 folds RFC2047-encoded
 *  headers incorrectly, so a non-ASCII subject ('·', '—') breaks the whole
 *  header block and Gmail renders raw MIME as the body. Subjects, the
 *  plain-text part, and ICS content are forced to ASCII; the HTML part
 *  keeps the pretty typography (safely QP-encoded once headers are valid). */
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

// ── iCalendar helpers ───────────────────────────────────────────────

function icsEscape(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

/** RFC 5545 line folding: max 75 octets per line, continuation indented. */
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
  startIso: string;      // inclusive first day off
  endIso: string;        // inclusive last day off (DTEND is +1, exclusive)
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
    // RSVP=FALSE: no accept/decline expected — Exchange/M365 still places
    // the event on the calendar automatically when the request arrives.
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

/** Per-site calendar recipient list: env first, Vault fallback. */
async function calRecipients(
  admin: ReturnType<typeof createClient>,
  siteCode: string,
): Promise<string[]> {
  const key = `PTO_CAL_TO_${siteCode.toUpperCase()}`;
  let v = Deno.env.get(key) ?? "";
  if (!v) {
    const r = await admin.rpc("get_app_secret", { k: key });
    v = ((r.data as string) ?? "");
  }
  return v.split(",").map((s) => s.trim()).filter((e) => /@/.test(e));
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
    // Re-read the enriched row (names for requester/reviewer) — the trigger
    // payload carries ids only.
    const { data: reqRows, error: reqErr } = await admin
      .from("v_pto_requests_enriched")
      .select("*")
      .eq("id", payload.record.id);
    if (reqErr) throw reqErr;
    const r = reqRows?.[0];
    if (!r) return json(404, { error: "request not found" });

    // Requester (email + home site).
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

    // Site: NULL home_site_id = UPark (historical default, same rule as the
    // frontend's useSiteScope).
    const { data: sites, error: sErr } = await admin.from("sites").select("id, code, name");
    if (sErr) throw sErr;
    const upark = (sites ?? []).find((s) => s.code === "upark");
    const site = (sites ?? []).find((s) => s.id === ep?.home_site_id) ?? upark;
    if (!site) return json(500, { error: "sites table empty" });

    // Home-site managers: the curated is_manager toggle in the admin view.
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

    // Compose the notification email.
    const who = r.user_full_name ?? requester?.full_name ?? "Unknown";
    const range = fmtRange(r.starts_on, r.ends_on);
    const tl = typeLabel(r.type);
    const partial = partialLabel(r);
    const decision = r.status === "approved" ? "Approved" : r.status === "denied" ? "Denied" : r.status;
    const dashUrl = `${DASHBOARD_BASE}${site.code === "binney" ? "/binney/manager" : "/manager"}`;

    const subject = asciiSafe(payload.event === "submitted"
      ? `[PTO - ${site.name}] New request - ${who} - ${tl} ${range}`
      : `[PTO - ${site.name}] ${decision} - ${who} - ${tl} ${range}`);

    const rows: [string, string][] = [
      ["Engineer", who],
      ["Type", tl],
      ["Dates", `${range} (${r.days} day${r.days === 1 ? "" : "s"} · ${r.hours}h)`],
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
      ? "New PTO request — needs review"
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

    // ── Calendar invite plan ──────────────────────────────────────
    let inviteAction: "REQUEST" | "CANCEL" | null = null;
    if (payload.event === "decided" && r.status === "approved") {
      inviteAction = "REQUEST";
    } else if (payload.event === "retracted") {
      inviteAction = "CANCEL";
    } else if (payload.event === "decided" && r.status === "denied" && payload.prev_status === "approved") {
      inviteAction = "CANCEL";
    }
    let calTo = inviteAction ? await calRecipients(admin, site.code as string) : [];
    // The engineer's own calendar always gets the event (and its CANCEL),
    // even when the site has no group list configured.
    if (inviteAction) {
      const reqEmail = (requester?.email ?? "").trim().toLowerCase();
      if (/@/.test(reqEmail) && !calTo.some((e) => e.toLowerCase() === reqEmail)) {
        calTo.push(reqEmail);
      }
    }

    // Notification recipients — QA overrides never set by the trigger.
    let effectiveTo = payload.override_to?.length ? payload.override_to : resolvedTo;
    if (QA_FORCE_TO) {
      const forced = QA_FORCE_TO.split(",").map((s) => s.trim()).filter(Boolean);
      effectiveTo = forced;
      if (calTo.length) calTo = forced;
    }
    // 'retracted' sends no notification email — the calendar CANCEL is the
    // message.
    if (payload.event === "retracted") effectiveTo = [];

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

    // Gmail creds: env secrets first, Vault fallback (migration 0078).
    let gmailUser = Deno.env.get("GMAIL_USER") ?? "";
    let gmailPass = Deno.env.get("GMAIL_APP_PASSWORD") ?? "";
    if (!gmailUser || !gmailPass) {
      const [u, p] = await Promise.all([
        admin.rpc("get_app_secret", { k: "GMAIL_USER" }),
        admin.rpc("get_app_secret", { k: "GMAIL_APP_PASSWORD" }),
      ]);
      gmailUser = gmailUser || ((u.data as string) ?? "");
      gmailPass = gmailPass || ((p.data as string) ?? "");
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
      invite_action: inviteAction,
    });
  } catch (e) {
    return json(500, { error: (e as Error).message });
  }
});
