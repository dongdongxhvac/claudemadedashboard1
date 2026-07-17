// admin-set-password — set or change another user's password.
//
// Why this exists: corporate email filters (e.g. Mimecast) sometimes block
// Supabase magic-link and reset-password URLs. Without an admin-driven path,
// affected users can never set an initial password. This function lets an
// authenticated admin set any user's password directly using the service role.
//
// Request:   POST { target_user_id: uuid, new_password: string }
// Auth:      caller's JWT (Authorization: Bearer ...) must map to a row in
//            public.users with active=true and role in (admin, manager,
//            director) OR is_manager=true. (Widened from admin-only when
//            managers gained credential powers alongside admin-invite-link.)
// Response:  200 { ok: true }  |  4xx { error: string }
// Side effect: logs a password_set event into user_account_events.

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
  if (!callerAllowed) {
    return json(403, { error: "admin or manager only" });
  }

  // 2) Parse + validate input.
  let body: { target_user_id?: string; new_password?: string };
  try { body = await req.json(); } catch { return json(400, { error: "invalid json" }); }

  const target_user_id = (body.target_user_id ?? "").trim();
  const new_password   = body.new_password ?? "";
  if (!target_user_id) return json(400, { error: "target_user_id required" });
  if (new_password.length < 8) return json(400, { error: "password must be at least 8 characters" });

  // 3) Look up the target user's auth_user_id from public.users.
  //    If they don't have one yet (never received a magic link), create an
  //    auth.users row for them now, link it, then set the password.
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

  // Activity-log helper (best-effort — never blocks the main operation).
  const logEvent = async (detail: string) => {
    await admin.from("user_account_events").insert({
      target_user_id,
      actor_user_id: callerRow.id,
      event: "password_set",
      detail,
    });
  };

  const { data: targetRow, error: targetErr } = await admin
    .from("users")
    .select("id, email, auth_user_id")
    .eq("id", target_user_id)
    .maybeSingle();
  if (targetErr) return json(500, { error: targetErr.message });
  if (!targetRow) return json(404, { error: "target user not found" });
  if (!targetRow.email) return json(400, { error: "target user has no email — set one in User Profiles first" });

  let auth_user_id = targetRow.auth_user_id;

  // 3a) If public.users has no auth_user_id link, check whether an
  //     auth.users row already exists for this email. This is the drift
  //     case: a user signed in via magic link earlier (creating an
  //     auth row), but the link to public.users was never persisted (or
  //     got cleared). Without this lookup, createUser below would 422
  //     with "A user with this email address has already been registered."
  if (!auth_user_id) {
    // Service-role can query auth schema directly via the admin REST API.
    // listUsers supports a per-page email filter via the JS client.
    type ExistingAuthRow = { id: string; email: string | null };
    let existing: ExistingAuthRow | null = null;
    try {
      // The JS client's admin.listUsers doesn't accept a simple
      // {email: ...} filter pre-v2 of GoTrue; do a small page scan and
      // match case-insensitively. We expect <500 auth users so 1 page
      // of 1000 is plenty.
      const { data: list, error: listErr } = await admin.auth.admin.listUsers({
        page: 1, perPage: 1000,
      });
      if (listErr) return json(500, { error: `auth lookup failed: ${listErr.message}` });
      const wanted = (targetRow.email ?? "").trim().toLowerCase();
      const found = (list?.users ?? []).find(
        (u) => (u.email ?? "").trim().toLowerCase() === wanted,
      );
      if (found) existing = { id: found.id, email: found.email ?? null };
    } catch (e) {
      return json(500, { error: `auth lookup threw: ${e instanceof Error ? e.message : String(e)}` });
    }

    if (existing) {
      // Drift case — auth row already exists. Link it + set the password.
      auth_user_id = existing.id;
      const { error: linkErr } = await admin
        .from("users")
        .update({ auth_user_id, updated_at: new Date().toISOString() })
        .eq("id", target_user_id);
      if (linkErr) return json(500, { error: `link drifted auth user failed: ${linkErr.message}` });
      const { error: updErr } = await admin.auth.admin.updateUserById(auth_user_id, {
        password: new_password,
      });
      if (updErr) return json(500, { error: `password update on relinked auth user failed: ${updErr.message}` });
      await logEvent("relinked existing auth account");
      return json(200, { ok: true, created_auth_user: false, relinked: true });
    }

    // No existing auth row — create one with this email + password.
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email: targetRow.email,
      password: new_password,
      email_confirm: true,
    });
    if (createErr || !created.user) {
      return json(500, { error: createErr?.message ?? "failed to create auth user" });
    }
    auth_user_id = created.user.id;
    const { error: linkErr } = await admin
      .from("users")
      .update({ auth_user_id, updated_at: new Date().toISOString() })
      .eq("id", target_user_id);
    if (linkErr) return json(500, { error: linkErr.message });
    await logEvent("created auth account");
    return json(200, { ok: true, created_auth_user: true });
  }

  // Existing linked auth user — just update the password.
  const { error: updErr } = await admin.auth.admin.updateUserById(auth_user_id, {
    password: new_password,
  });
  if (updErr) return json(500, { error: updErr.message });

  await logEvent("password changed");
  return json(200, { ok: true, created_auth_user: false });
});
