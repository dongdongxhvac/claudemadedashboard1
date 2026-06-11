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
// Transport: Gmail SMTP (bmrupark55) — Resend was tried first but its
// unverified-domain testing mode only delivers to the account owner's
// address, which defeats a recipient field. Gmail app-password SMTP has
// no such restriction and is the same path the watcher's compliance
// alerts already use.
//
// Credentials: GMAIL_USER + GMAIL_APP_PASSWORD, read from edge-function
// secrets (Dashboard → Project Settings → Edge Functions → Secrets);
// falls back to the get_app_secret() Vault accessor (migration 0078) if
// the env secrets aren't set.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";

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

function contentTypeFor(filename: string): string {
  if (filename.endsWith(".xlsx")) {
    return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  }
  if (filename.endsWith(".csv")) return "text/csv";
  if (filename.endsWith(".pdf")) return "application/pdf";
  return "application/octet-stream";
}

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

  // 3) Gmail credentials: env secrets first, Vault fallback.
  let gmailUser = Deno.env.get("GMAIL_USER") ?? "";
  let gmailPass = Deno.env.get("GMAIL_APP_PASSWORD") ?? "";
  if (!gmailUser || !gmailPass) {
    const [u, p] = await Promise.all([
      admin.rpc("get_app_secret", { k: "GMAIL_USER" }),
      admin.rpc("get_app_secret", { k: "GMAIL_APP_PASSWORD" }),
    ]);
    gmailUser = gmailUser || (u.data as string ?? "");
    gmailPass = gmailPass || (p.data as string ?? "");
  }
  if (!gmailUser || !gmailPass) {
    return json(500, {
      error: "Gmail credentials not configured — add GMAIL_USER and GMAIL_APP_PASSWORD " +
             "as edge function secrets (Dashboard → Project Settings → Edge Functions).",
    });
  }

  // 4) Send via Gmail SMTP (implicit TLS on 465).
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
      from: `UPark Dashboard <${gmailUser}>`,
      to,
      subject,
      content: text,
      attachments: [{
        filename,
        content: attachment,
        encoding: "base64",
        contentType: contentTypeFor(filename),
      }],
    });
  } catch (e) {
    try { await client.close(); } catch { /* already closed */ }
    return json(502, { error: `gmail smtp: ${(e as Error).message?.slice(0, 400)}` });
  }
  try { await client.close(); } catch { /* already closed */ }

  return json(200, { ok: true });
});
