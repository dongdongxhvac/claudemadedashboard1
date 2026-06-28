// mro-field-upload — login-free field receipt capture (shared-secret link).
//
// A tech at the supply house opens /field/receipt?k=<token>, snaps a
// receipt, tags it, and submits. This function is the ONLY anonymous entry
// point: it validates the shared token, uploads the image + inserts the
// receipt via the service role (tables/bucket stay authenticated-only),
// and kicks off OCR. Receipts land in the same pool for a manager to
// match → verify → bill.
//
// OPT-IN: inert until MRO_FIELD_TOKEN is set as a Supabase secret. Rotate
// the secret to kill all outstanding links. Deployed with verify_jwt=false.
//
// Body: { token, image_base64, image_mime, tech_name?, building_code?,
//         site_wide?, category?, is_stock?, item? }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BUCKET = "mro-receipts";
const MAX_B64 = 9_000_000;   // ~6.5 MB binary
const OK_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);
const OK_CATEGORY = new Set(["HVAC", "Plumbing", "Electrical", "Control", "Other"]);

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...cors } });
}

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json(405, { error: "method not allowed" });

  const FIELD_TOKEN = Deno.env.get("MRO_FIELD_TOKEN");
  if (!FIELD_TOKEN) return json(503, { error: "Field capture is not enabled." });

  let body: {
    token?: string; image_base64?: string; image_mime?: string;
    tech_name?: string; building_code?: string; site_wide?: boolean;
    category?: string; is_stock?: boolean; item?: string;
  };
  try { body = await req.json(); } catch { return json(400, { error: "invalid json" }); }

  // Constant-time-ish token check.
  if (!body.token || body.token !== FIELD_TOKEN) return json(401, { error: "invalid or missing link token" });

  const mime = (body.image_mime ?? "").toLowerCase();
  if (!OK_MIME.has(mime)) return json(415, { error: "image must be jpeg / png / webp" });
  const b64 = body.image_base64 ?? "";
  if (!b64) return json(400, { error: "image required" });
  if (b64.length > MAX_B64) return json(413, { error: "image too large (max ~6 MB)" });

  const category = body.category && OK_CATEGORY.has(body.category) ? body.category : null;

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

  // Resolve a typed building number/code → building_id (best-effort).
  let building_id: string | null = null;
  const code = (body.building_code ?? "").trim();
  if (code && !body.site_wide) {
    const { data: b } = await admin.from("buildings")
      .select("id").eq("active", true).eq("short_code", code).maybeSingle();
    building_id = b?.id ?? null;
  }

  // Upload image.
  const ext = mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : "jpg";
  const path = `field/${crypto.randomUUID()}.${ext}`;
  const up = await admin.storage.from(BUCKET).upload(path, b64ToBytes(b64), { contentType: mime, upsert: false });
  if (up.error) return json(502, { error: `upload failed: ${up.error.message}` });

  // Insert receipt (anonymous owner; tech name kept for reference).
  const { data: rec, error: rErr } = await admin.from("mro_receipts").insert({
    storage_path: path,
    image_mime: mime,
    uploaded_by: (body.tech_name ?? "").trim() ? `field: ${body.tech_name!.trim()}` : "field (anonymous)",
    uploaded_by_user_id: null,
    building_id,
    site_wide: !!body.site_wide,
    category,
    is_stock: typeof body.is_stock === "boolean" ? body.is_stock : null,
    item_label: (body.item ?? "").trim() || null,
  }).select("id").single();
  if (rErr) {
    await admin.storage.from(BUCKET).remove([path]);
    return json(500, { error: rErr.message });
  }

  // OCR (internal call — service-role bearer, best-effort).
  try {
    await fetch(`${SUPABASE_URL}/functions/v1/mro-ocr-receipt`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${SERVICE_ROLE}`, "Content-Type": "application/json", "apikey": SERVICE_ROLE },
      body: JSON.stringify({ receipt_id: rec.id }),
    });
  } catch { /* OCR best-effort; status surfaced in the pool */ }

  return json(200, { ok: true });
});
