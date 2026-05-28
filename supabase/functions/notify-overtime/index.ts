// notify-overtime — Supabase Edge Function.
//
// Invoked by DB triggers on AFTER INSERT into overtime_posts and
// overtime_signups. Looks up the enriched post (and signup user, if any)
// then sends an email via Resend to the configured recipient.
//
// Verify_jwt is disabled so the DB triggers can call it without holding a
// user JWT. The function URL is the only secret protecting it; if abuse
// becomes a concern, switch to shared-secret header auth.
//
// Required environment / Supabase project secrets:
//   RESEND_API_KEY        — from resend.com dashboard
//   SUPABASE_URL          — set automatically by Supabase
//   SUPABASE_SERVICE_ROLE_KEY — set automatically by Supabase
// Optional:
//   OT_NOTIFY_RECIPIENTS  — comma-separated email list (default: Mark)
//   OT_NOTIFY_FROM        — sender email (default: onboarding@resend.dev)
//   OT_DASHBOARD_URL      — link surfaced in the email body
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

type IncomingPostPayload = {
  type: "overtime_post";
  record: { id: string };
};
type IncomingSignupPayload = {
  type: "overtime_signup";
  record: { id: string; post_id: string; user_id: string };
};
type IncomingPayload = IncomingPostPayload | IncomingSignupPayload;

function fmtWhen(starts: string, ends: string | null): string {
  const s = new Date(starts);
  const e = ends ? new Date(ends) : null;
  const tz = "America/New_York";
  const dateStr = (d: Date) =>
    d.toLocaleDateString("en-US", { weekday: "short", month: "numeric", day: "numeric", timeZone: tz });
  const timeStr = (d: Date) =>
    d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: tz });
  if (!e) return `${dateStr(s)} ${timeStr(s)}`;
  const sameDay =
    s.toLocaleDateString("en-US", { timeZone: tz }) ===
    e.toLocaleDateString("en-US", { timeZone: tz });
  return sameDay
    ? `${dateStr(s)} ${timeStr(s)} – ${timeStr(e)}`
    : `${dateStr(s)} ${timeStr(s)} – ${dateStr(e)} ${timeStr(e)}`;
}

const CATEGORY_LABEL: Record<string, string> = {
  cold_weather:      "Cold Weather",
  major_off_hour_pm: "Major Off-Hour PM",
  off_hour_repair:   "Off-Hour Repair",
  vendor_escort:     "Vendor Escort",
};

async function fetchEnrichedPost(supabaseUrl: string, serviceKey: string, postId: string) {
  const r = await fetch(
    `${supabaseUrl}/rest/v1/v_overtime_posts_with_signups?id=eq.${postId}&select=*`,
    {
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
      },
    },
  );
  if (!r.ok) throw new Error(`Fetch post failed: ${r.status} ${await r.text()}`);
  const arr = await r.json();
  return arr[0] ?? null;
}

async function fetchUserName(supabaseUrl: string, serviceKey: string, userId: string): Promise<string | null> {
  const r = await fetch(
    `${supabaseUrl}/rest/v1/users?id=eq.${userId}&select=full_name`,
    {
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
      },
    },
  );
  if (!r.ok) return null;
  const arr = await r.json();
  return arr[0]?.full_name ?? null;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" } as Record<string, string>)[c]);
}

function buildPostEmail(post: any, dashboardUrl: string) {
  const cat = CATEGORY_LABEL[post.category] ?? post.category;
  const when = fmtWhen(post.starts_at, post.ends_at);
  const building = post.building_short_code || post.building_code || post.building_label || "—";
  const subject = `[OT] New ${cat}: ${building} · ${when}`;
  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, sans-serif; max-width: 560px;">
      <h2 style="margin:0 0 12px 0;">New overtime coverage posted</h2>
      <table style="border-collapse: collapse; font-size: 14px;">
        <tr><td style="padding: 4px 12px 4px 0; color:#666;">Category</td><td><strong>${escapeHtml(cat)}</strong></td></tr>
        <tr><td style="padding: 4px 12px 4px 0; color:#666;">When</td><td>${escapeHtml(when)}</td></tr>
        <tr><td style="padding: 4px 12px 4px 0; color:#666;">Building</td><td>${escapeHtml(String(building))}</td></tr>
        <tr><td style="padding: 4px 12px 4px 0; color:#666;">Scope</td><td>${escapeHtml(post.scope ?? "")}</td></tr>
        <tr><td style="padding: 4px 12px 4px 0; color:#666;">Slots</td><td>${post.slots_filled} / ${post.slots_needed} filled</td></tr>
        ${post.notes ? `<tr><td style="padding: 4px 12px 4px 0; color:#666;">Notes</td><td>${escapeHtml(post.notes)}</td></tr>` : ""}
      </table>
      <p style="margin-top:16px;">
        <a href="${dashboardUrl}" style="display:inline-block; padding:8px 14px; background:#4f46e5; color:#fff; border-radius:4px; text-decoration:none;">
          Open dashboard
        </a>
      </p>
    </div>`;
  return { subject, html };
}

function buildSignupEmail(post: any, userName: string | null, dashboardUrl: string) {
  const cat = CATEGORY_LABEL[post.category] ?? post.category;
  const when = fmtWhen(post.starts_at, post.ends_at);
  const building = post.building_short_code || post.building_code || post.building_label || "—";
  const who = userName ?? "Someone";
  const subject = `[OT] ${who} signed up · ${cat} ${building} ${when}`;
  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, sans-serif; max-width: 560px;">
      <h2 style="margin:0 0 12px 0;">${escapeHtml(who)} signed up for overtime</h2>
      <table style="border-collapse: collapse; font-size: 14px;">
        <tr><td style="padding: 4px 12px 4px 0; color:#666;">Category</td><td><strong>${escapeHtml(cat)}</strong></td></tr>
        <tr><td style="padding: 4px 12px 4px 0; color:#666;">When</td><td>${escapeHtml(when)}</td></tr>
        <tr><td style="padding: 4px 12px 4px 0; color:#666;">Building</td><td>${escapeHtml(String(building))}</td></tr>
        <tr><td style="padding: 4px 12px 4px 0; color:#666;">Scope</td><td>${escapeHtml(post.scope ?? "")}</td></tr>
        <tr><td style="padding: 4px 12px 4px 0; color:#666;">Slots</td><td>${post.slots_filled} / ${post.slots_needed} filled</td></tr>
      </table>
      <p style="margin-top:16px;">
        <a href="${dashboardUrl}" style="display:inline-block; padding:8px 14px; background:#4f46e5; color:#fff; border-radius:4px; text-decoration:none;">
          Open dashboard
        </a>
      </p>
    </div>`;
  return { subject, html };
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const resendKey   = Deno.env.get("RESEND_API_KEY");
  const recipients  = (Deno.env.get("OT_NOTIFY_RECIPIENTS") ?? "bmrupark55@gmail.com")
    .split(",").map((s) => s.trim()).filter(Boolean);
  const fromAddr    = Deno.env.get("OT_NOTIFY_FROM") ?? "COVE Ops <onboarding@resend.dev>";
  const dashboard   = Deno.env.get("OT_DASHBOARD_URL") ?? "https://covemepops.vercel.app/manager";

  if (!supabaseUrl || !serviceKey) {
    return new Response("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY", { status: 500 });
  }
  if (!resendKey) {
    return new Response("Missing RESEND_API_KEY — set it in Supabase project secrets.", { status: 500 });
  }

  let payload: IncomingPayload;
  try {
    payload = await req.json();
  } catch {
    return new Response("Invalid JSON body", { status: 400 });
  }

  try {
    let subject: string, html: string;
    if (payload.type === "overtime_post") {
      const post = await fetchEnrichedPost(supabaseUrl, serviceKey, payload.record.id);
      if (!post) return new Response("Post not found", { status: 404 });
      ({ subject, html } = buildPostEmail(post, dashboard));
    } else if (payload.type === "overtime_signup") {
      const post = await fetchEnrichedPost(supabaseUrl, serviceKey, payload.record.post_id);
      if (!post) return new Response("Parent post not found", { status: 404 });
      const userName = await fetchUserName(supabaseUrl, serviceKey, payload.record.user_id);
      ({ subject, html } = buildSignupEmail(post, userName, dashboard));
    } else {
      return new Response("Unknown payload.type", { status: 400 });
    }

    const sendR = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: fromAddr,
        to: recipients,
        subject,
        html,
      }),
    });

    if (!sendR.ok) {
      const errBody = await sendR.text();
      return new Response(`Resend error ${sendR.status}: ${errBody}`, { status: 502 });
    }
    return new Response(JSON.stringify({ ok: true }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(`Handler error: ${(e as Error).message}`, { status: 500 });
  }
});
