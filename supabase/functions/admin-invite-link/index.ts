// admin-invite-link — generate a one-time link the target user opens to set
// their own password.
//
// Why this exists: corporate email filters (e.g. Mimecast) block Supabase's
// own emails, so links are handed over out-of-band: an admin/manager clicks
// "Generate invite link" in User Profiles, copies the returned link and sends
// it by text/Teams. Opening it signs the user in and lands them on
// /set-password (see web/src/routes/SetPassword.tsx). generateLink never
// sends email.
//
// Request:   POST { target_user_id: uuid, redirect_to?: string }
// Auth:      caller's JWT must map to public.users with active=true and
//            role in (admin, manager, director) OR is_manager=true.
// Response:  200 { ok: true, action_link: string, kind: 'invite'|'recovery', email }
//            'invite'   = target had no auth account (one is created at
//                         generate time — LINKED badge flips immediately)
//            'recovery' = target already has an account; link lets them set
//                         a new password (doubles as password reset).
// Side effects: links drifted/created auth users into public.users
// (auth_user_id), and logs an event row into user_account_events.

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
  let body: { target_user_id?: string; redirect_to?: string };
  try { body = await req.json(); } catch { return json(400, { error: "invalid json" }); }

  const target_user_id = (body.target_user_id ?? "").trim();
  const redirect_to    = (body.redirect_to ?? "").trim() || null;
  if (!target_user_id) return json(400, { error: "target_user_id required" });

  // 3) Look up the target. Decide invite (no auth account) vs recovery.
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

  const { data: targetRow, error: targetErr } = await admin
    .from("users")
    .select("id, email, auth_user_id")
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

  return json(200, {
    ok: true,
    link: app_link ?? linkRes.data.properties.action_link,
    action_link: linkRes.data.properties.action_link,
    kind,
    email,
  });
});
