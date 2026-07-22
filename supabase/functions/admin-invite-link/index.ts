// admin-invite-link — generate a one-time link the target user opens to set
// their own password, and OPTIONALLY email it to them.
//
// Why this exists: corporate email filters (e.g. Mimecast) block Supabase's
// own auth emails, so links are handed over out-of-band: an admin/manager
// clicks "Generate invite link" in User Profiles, copies the returned link
// and sends it by text/Teams. Opening it signs the user in and lands them on
// /set-password (see web/src/routes/SetPassword.tsx).
//
// deliver_email (2026-07-19): a second button asks us to email the link to
// the target ourselves, via the same Gmail SMTP + per-site sender + Mimecast-
// friendly plain-link format as notify-pto (anchor text == href, no styled
// buttons). This bypasses Supabase's blocked mailer. The link we email is the
// /set-password app link, which is spent only when the user clicks Continue —
// so email preloading can't burn it (unlike the raw GoTrue action_link).
// Email failure never fails the request: the link is already generated and
// returned, so the admin can still copy/paste as a fallback.
//
// Request:   POST { target_user_id: uuid, redirect_to?: string, deliver_email?: bool }
// Auth:      caller's JWT must map to public.users with active=true and
//            role in (admin, manager, director) OR is_manager=true.
// Response:  200 { ok, link, action_link, kind:'invite'|'recovery', email,
//                  emailed?: bool, emailed_to?, email_error? }
// Side effects: links drifted/created auth users into public.users
// (auth_user_id), logs an event row into user_account_events.

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

/** Non-ASCII in a denomailer 1.6 subject breaks header folding — keep subject
 *  + text part ASCII (same rule as notify-pto). */
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST")    return json(405, { error: "method not allowed" });

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return json(401, { error: "missing bearer token" });

  // 1) Verify caller is an authenticated admin or manager.
  const callerClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: who, error: whoErr } = await callerClient.auth.getUser();
  if (whoErr || !who.user) return json(401, { error: "invalid token" });

  const { data: callerRow, error: callerErr } = await callerClient
    .from("users")
    .select("id, role, active, is_manager")
    .eq("auth_user_id", who.user.id)
    .maybeSingle();
  if (callerErr) return json(500, { error: callerErr.message });
  const callerAllowed =
    callerRow && callerRow.active &&
    (["admin", "manager", "director"].includes(callerRow.role) || callerRow.is_manager === true);
  if (!callerAllowed) return json(403, { error: "admin or manager only" });

  // 2) Parse + validate input.
  let body: { target_user_id?: string; redirect_to?: string; deliver_email?: boolean };
  try { body = await req.json(); } catch { return json(400, { error: "invalid json" }); }

  const target_user_id = (body.target_user_id ?? "").trim();
  const redirect_to    = (body.redirect_to ?? "").trim() || null;
  const deliver_email  = body.deliver_email === true;
  if (!target_user_id) return json(400, { error: "target_user_id required" });

  // 3) Look up the target. Decide invite (no auth account) vs recovery.
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

  const { data: targetRow, error: targetErr } = await admin
    .from("users")
    .select("id, email, full_name, auth_user_id, engineer_profiles(home_site_id)")
    .eq("id", target_user_id)
    .maybeSingle();
  if (targetErr) return json(500, { error: targetErr.message });
  if (!targetRow) return json(404, { error: "target user not found" });
  if (!targetRow.email) return json(400, { error: "target user has no email — set one in User Profiles first" });

  const email = targetRow.email.trim();
  let auth_user_id: string | null = targetRow.auth_user_id;

  // 3a) Drift check (same as admin-set-password): no link recorded, but an
  //     auth.users row may already exist for this email. Re-link it so we
  //     issue a recovery link instead of a doomed invite.
  if (!auth_user_id) {
    try {
      const { data: list, error: listErr } = await admin.auth.admin.listUsers({
        page: 1, perPage: 1000,
      });
      if (listErr) return json(500, { error: `auth lookup failed: ${listErr.message}` });
      const wanted = email.toLowerCase();
      const found = (list?.users ?? []).find(
        (u) => (u.email ?? "").trim().toLowerCase() === wanted,
      );
      if (found) {
        auth_user_id = found.id;
        const { error: linkErr } = await admin
          .from("users")
          .update({ auth_user_id, updated_at: new Date().toISOString() })
          .eq("id", target_user_id);
        if (linkErr) return json(500, { error: `link drifted auth user failed: ${linkErr.message}` });
      }
    } catch (e) {
      return json(500, { error: `auth lookup threw: ${e instanceof Error ? e.message : String(e)}` });
    }
  }

  // 4) Generate the action link. Bidirectional fallback covers GoTrue
  //    quirks: an invite for an already-registered email retries as
  //    recovery; a recovery that GoTrue refuses (e.g. odd confirmation
  //    state) retries as invite.
  const options = redirect_to ? { redirectTo: redirect_to } : undefined;
  let kind: "invite" | "recovery" = auth_user_id ? "recovery" : "invite";

  let linkRes = await admin.auth.admin.generateLink({ type: kind, email, options });
  if (linkRes.error) {
    const flipped: "invite" | "recovery" = kind === "invite" ? "recovery" : "invite";
    const retry = await admin.auth.admin.generateLink({ type: flipped, email, options });
    if (!retry.error) { kind = flipped; linkRes = retry; }
  }
  if (linkRes.error || !linkRes.data?.properties?.action_link) {
    return json(500, { error: linkRes.error?.message ?? "failed to generate link" });
  }

  // 5) An invite creates the auth user at generate time — persist the link
  //    (belt-and-braces beside migration 0008's email-match trigger).
  const generatedUserId = linkRes.data.user?.id ?? null;
  if (kind === "invite" && generatedUserId && !auth_user_id) {
    const { error: linkErr } = await admin
      .from("users")
      .update({ auth_user_id: generatedUserId, updated_at: new Date().toISOString() })
      .eq("id", target_user_id);
    if (linkErr) return json(500, { error: linkErr.message });
  }

  // 6) Log the event (best-effort — the link is already generated).
  await admin.from("user_account_events").insert({
    target_user_id,
    actor_user_id: callerRow.id,
    event: kind === "invite" ? "invite_link_generated" : "reset_link_generated",
    detail: email,
  });

  // Prefer a link to OUR /set-password page carrying the hashed token —
  // consumed only when the user clicks Continue (supabase.auth.verifyOtp).
  // The raw action_link points at GoTrue's /verify endpoint, which spends
  // the one-time token on ANY load — browser preloading and chat link
  // previews were eating links before the user ever saw the page.
  const hashedToken = linkRes.data.properties.hashed_token ?? null;
  const app_link = hashedToken && redirect_to
    ? `${redirect_to}?token_hash=${encodeURIComponent(hashedToken)}&type=${kind}`
    : null;
  const bestLink = app_link ?? linkRes.data.properties.action_link;

  // 7) Optionally email the link to the target (Mimecast-friendly, per-site
  //    sender). Never fails the request — the link is already returned.
  let emailed = false;
  let emailed_to: string | null = null;
  let email_error: string | null = null;
  if (deliver_email) {
    try {
      // Per-site sender: target's home site (NULL = UPark, same rule as the
      // frontend). Picks GMAIL_USER_<SITE>, falls back to the default pair.
      type EpRow = { home_site_id: string | null };
      const ep = Array.isArray(targetRow.engineer_profiles)
        ? (targetRow.engineer_profiles as EpRow[])[0]
        : (targetRow.engineer_profiles as EpRow | null);
      const { data: sites } = await admin.from("sites").select("id, code, name");
      const upark = (sites ?? []).find((s) => s.code === "upark");
      const site = (sites ?? []).find((s) => s.id === ep?.home_site_id) ?? upark;
      const siteName = (site?.name as string) ?? "Operations";

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
      const siteSuffix = ((site?.code as string) ?? "").toUpperCase();
      let creds = siteSuffix
        ? await lookupCreds(`GMAIL_USER_${siteSuffix}`, `GMAIL_APP_PASSWORD_${siteSuffix}`)
        : { user: "", pass: "" };
      if (!creds.user || !creds.pass) {
        creds = await lookupCreds("GMAIL_USER", "GMAIL_APP_PASSWORD");
      }
      if (!creds.user || !creds.pass) throw new Error("gmail credentials not configured");

      const who = (targetRow.full_name as string)?.trim() || "there";
      const verb = kind === "recovery" ? "reset your password" : "set your password";
      const subject = asciiSafe(`Set your ${siteName} dashboard password`);
      const text = asciiSafe(
        `Hi ${who},\n\n` +
        `You have access to the ${siteName} operations dashboard. Open this link to ${verb}:\n\n` +
        `${bestLink}\n\n` +
        `The link is single-use and expires soon. If it does not work, ask your manager to send a new one.`,
      );
      const html =
        `<div style="font-family:-apple-system,BlinkMacSystemFont,sans-serif;max-width:560px;font-size:14px;">` +
        `<p>Hi ${escapeHtml(who)},</p>` +
        `<p>You have access to the ${escapeHtml(siteName)} operations dashboard. ` +
        `Open this link to ${verb}:</p>` +
        `<p><a href="${bestLink}">${escapeHtml(bestLink)}</a></p>` +
        `<p>The link is single-use and expires soon. If it does not work, ask your manager to send a new one.</p>` +
        `</div>`;

      const client = new SMTPClient({
        connection: {
          hostname: "smtp.gmail.com", port: 465, tls: true,
          auth: { username: creds.user, password: creds.pass },
        },
      });
      try {
        await client.send({
          from: `${siteName} Dashboard <${creds.user}>`,
          to: email,
          subject,
          content: text,
          html,
        });
      } finally {
        try { await client.close(); } catch { /* already closed */ }
      }
      emailed = true;
      emailed_to = email;
    } catch (e) {
      email_error = e instanceof Error ? e.message : String(e);
    }
  }

  return json(200, {
    ok: true,
    link: bestLink,
    action_link: linkRes.data.properties.action_link,
    kind,
    email,
    emailed,
    emailed_to,
    email_error,
  });
});
