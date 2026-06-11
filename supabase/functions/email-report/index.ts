// email-report — send a dashboard-generated report file to an email address.
//
// Built for the Water Billing tab's "Email report" button (xlsx attachment),
// but intentionally generic: any admin-view tab can send a small report
// attachment through it.
//
// Request:  POST {
//   to: string,                // recipient email
//   subject: string,
//   text: string,              // plain-text body
//   filename: string,          // e.g. "water-billing_2026-05-01_2026-05-31.xlsx"
//   attachment_base64: string, // file content, base64 (<= ~5 MB)
// }
// Auth:     caller's JWT must map to an active public.users row with
//           role='admin' OR an engineer_profiles.is_lead=true — the same
//           population that can see the admin view.
// Response: 200 { ok: true } | 4xx/5xx { error }
//
// Transport: Resend (same RESEND_API_KEY secret notify-overtime uses).
// From address: REPORT_FROM secret, else OT_NOTIFY_FROM, else the Resend
// onboarding sender.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY     = Deno.env.get("SUPABASE_ANON_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}

const MAX_ATTACHMENT_B64 = 7_000_000;  // ~5 MB binary after base64 inflation

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST")    return json(405, { error: "method not allowed" });

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return json(401, { error: "missing bearer token" });

  // 1) Caller must be an active admin or lead.
  const callerClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: who, error: whoErr } = await callerClient.auth.getUser();
  if (whoErr || !who.user) return json(401, { error: "invalid token" });

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
  const { data: callerRow, error: callerErr } = await admin
    .from("users")
    .select("id, role, active, engineer_profiles(is_lead)")
    .eq("auth_user_id", who.user.id)
    .maybeSingle();
  if (callerErr) return json(500, { error: callerErr.message });
  const ep = Array.isArray(callerRow?.engineer_profiles)
    ? callerRow?.engineer_profiles[0]
    : callerRow?.engineer_profiles;
  const isLead = ep?.is_lead === true;
  if (!callerRow || !callerRow.active || (callerRow.role !== "admin" && !isLead)) {
    return json(403, { error: "admin or lead only" });
  }

  // 2) Parse + validate.
  let body: {
    to?: string; subject?: string; text?: string;
    filename?: string; attachment_base64?: string;
  };
  try { body = await req.json(); } catch { return json(400, { error: "invalid json" }); }

  const to = (body.to ?? "").trim();
  const subject = (body.subject ?? "").trim();
  const text = body.text ?? "";
  const filename = (body.filename ?? "report.xlsx").replace(/[^a-zA-Z0-9._\-]/g, "_");
  const attachment = body.attachment_base64 ?? "";

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return json(400, { error: "invalid recipient email" });
  if (!subject) return json(400, { error: "subject required" });
  if (!attachment) return json(400, { error: "attachment required" });
  if (attachment.length > MAX_ATTACHMENT_B64) return json(400, { error: "attachment too large (5 MB max)" });

  // 3) Send via Resend.
  const resendKey = Deno.env.get("RESEND_API_KEY");
  if (!resendKey) return json(500, { error: "RESEND_API_KEY not configured" });
  const fromAddr =
    Deno.env.get("REPORT_FROM") ??
    Deno.env.get("OT_NOTIFY_FROM") ??
    "COVE Ops <onboarding@resend.dev>";

  const sendR = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${resendKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: fromAddr,
      to: [to],
      subject,
      text,
      attachments: [{ filename, content: attachment }],
    }),
  });

  if (!sendR.ok) {
    const errText = await sendR.text();
    return json(502, { error: `resend: ${sendR.status} ${errText.slice(0, 400)}` });
  }

  return json(200, { ok: true });
});
