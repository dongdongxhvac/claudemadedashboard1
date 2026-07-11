// notify-pto — Supabase Edge Function.
//
// Invoked by the DB trigger pto_requests_notify_trg (migration 0094) via
// pg_net on INSERT/UPDATE of pto_requests. Site-aware PTO notifications:
//
//   event 'submitted' (new pending request)
//     → email every ACTIVE user with is_manager=true homed at the
//       requester's site (engineer_profiles.home_site_id; NULL = UPark).
//   event 'decided' (status changed to approved/denied, or inserted
//   directly as approved by a manager)
//     → email those same home-site managers PLUS the requester, so the
//       other managers see it's handled and the engineer gets the outcome.
//
// Recipient control is the users.is_manager toggle in the admin view —
// no hardcoded names. Transport is Gmail SMTP (same as email-report):
// Resend's testing mode only delivers to the account owner, which can't
// reach arbitrary manager/engineer inboxes.
//
// Deployed with verify_jwt ENABLED (tighter than notify-overtime): the DB
// trigger authenticates with the project anon key, which is a valid signed
// JWT. Callers without a project JWT are rejected at the gateway.
//
// Credentials: GMAIL_USER + GMAIL_APP_PASSWORD from edge secrets, falling
// back to the get_app_secret() Vault accessor (migration 0078).
//
// QA hooks (never set by the trigger):
//   payload.dry_run      — resolve recipients + subject, send nothing.
//   payload.override_to  — send to these addresses instead of the real list.
//   env PTO_QA_FORCE_TO  — global override for staging-style testing.
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
  event: "submitted" | "decided";
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

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  let payload: Payload;
  try { payload = await req.json(); } catch { return json(400, { error: "invalid json" }); }
  if (payload.type !== "pto_request" || !payload.record?.id) {
    return json(400, { error: "unknown payload" });
  }
  if (payload.event !== "submitted" && payload.event !== "decided") {
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

    // Compose.
    const who = r.user_full_name ?? requester?.full_name ?? "Unknown";
    const range = fmtRange(r.starts_on, r.ends_on);
    const tl = typeLabel(r.type);
    const partial = partialLabel(r);
    const decision = r.status === "approved" ? "Approved" : r.status === "denied" ? "Denied" : r.status;
    const dashUrl = `${DASHBOARD_BASE}${site.code === "binney" ? "/binney/manager" : "/manager"}`;

    const subject = payload.event === "submitted"
      ? `[PTO · ${site.name}] New request — ${who} · ${tl} ${range}`
      : `[PTO · ${site.name}] ${decision} — ${who} · ${tl} ${range}`;

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
    const text = `${heading}\n\n` +
      rows.map(([k, v]) => `${k}: ${v}`).join("\n") +
      `\n\n${dashUrl}`;

    // QA overrides — the DB trigger never sets these.
    const effectiveTo = payload.override_to?.length
      ? payload.override_to
      : QA_FORCE_TO
        ? QA_FORCE_TO.split(",").map((s) => s.trim()).filter(Boolean)
        : resolvedTo;

    if (payload.dry_run) {
      return json(200, { ok: true, dry_run: true, event: payload.event, site: site.code, subject, resolved_to: resolvedTo, effective_to: effectiveTo });
    }
    if (effectiveTo.length === 0) {
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
    try {
      await client.send({
        from: `${site.name} Dashboard <${gmailUser}>`,
        to: effectiveTo,
        subject,
        content: text,
        html,
      });
    } finally {
      try { await client.close(); } catch { /* already closed */ }
    }

    return json(200, { ok: true, event: payload.event, site: site.code, sent_to: effectiveTo });
  } catch (e) {
    return json(500, { error: (e as Error).message });
  }
});
