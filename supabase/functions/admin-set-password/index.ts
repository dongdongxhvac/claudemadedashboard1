// admin-set-password — set or change another user's password.
//
// Why this exists: corporate email filters (e.g. Mimecast) sometimes block
// Supabase magic-link and reset-password URLs. Without an admin-driven path,
// affected users can never set an initial password. This function lets an
// authenticated admin set any user's password directly using the service role.
//
// Request:   POST { target_user_id: uuid, new_password: string }
// Auth:      caller's JWT (Authorization: Bearer ...) must map to a row in
//            public.users with role='admin' and active=true.
// Response:  200 { ok: true }  |  4xx { error: string }

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

  // 1) Verify caller is an authenticated admin.
  const callerClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: who, error: whoErr } = await callerClient.auth.getUser();
  if (whoErr || !who.user) return json(401, { error: "invalid token" });

  const { data: callerRow, error: callerErr } = await callerClient
    .from("users")
    .select("id, role, active")
    .eq("auth_user_id", who.user.id)
    .maybeSingle();
  if (callerErr) return json(500, { error: callerErr.message });
  if (!callerRow || !callerRow.active || callerRow.role !== "admin") {
    return json(403, { error: "admin only" });
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

  const { data: targetRow, error: targetErr } = await admin
    .from("users")
    .select("id, email, auth_user_id")
    .eq("id", target_user_id)
    .maybeSingle();
  if (targetErr) return json(500, { error: targetErr.message });
  if (!targetRow) return json(404, { error: "target user not found" });
  if (!targetRow.email) return json(400, { error: "target user has no email — set one in User Profiles first" });

  let auth_user_id = targetRow.auth_user_id;
  if (!auth_user_id) {
    // Create an auth user with this email + password in one shot.
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
    return json(200, { ok: true, created_auth_user: true });
  }

  // Existing auth user — just update the password.
  const { error: updErr } = await admin.auth.admin.updateUserById(auth_user_id, {
    password: new_password,
  });
  if (updErr) return json(500, { error: updErr.message });

  return json(200, { ok: true, created_auth_user: false });
});
