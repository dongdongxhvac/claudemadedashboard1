// mro-ocr-receipt — extract receipt fields with Claude vision.
//
// MRO Billing Phase 3. Invoked with { receipt_id } (from the upload
// handler, Phase 6). Pulls the receipt image from the private mro-receipts
// bucket, calls the Anthropic Messages API (claude-sonnet-4-6) with the
// verbatim extraction prompt, parses the JSON defensively, and writes the
// extracted_* / ocr_* fields on the mro_receipts row.
//
// Auth: admin/manager only (verify_jwt=true + role check). The Anthropic
// key lives ONLY here as a Supabase secret (ANTHROPIC_API_KEY) — never in
// the client bundle.
//
// Spec rule 5 — never auto-trust OCR: this function only RECORDS what the
// model read (incl. legibility + per-field confidence). Whether a charge
// can auto-verify is decided downstream by the matching engine; a 'poor'
// legibility or null total routes to manual review there.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY     = Deno.env.get("SUPABASE_ANON_KEY")!;
const RECEIPTS_BUCKET = "mro-receipts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}

// Anthropic vision accepts these media types only (HEIC/HEIF do NOT work).
const SUPPORTED_IMAGE_TYPES = new Set([
  "image/jpeg", "image/png", "image/webp", "image/gif",
]);

const EXTRACTION_PROMPT = `You are a receipt data extractor for a facilities billing system. Read the receipt in the
image and return ONLY a JSON object — no markdown, no code fences, no commentary — with
exactly these keys:
- merchant: the store/vendor name as printed, or null
- purchase_date: the purchase date in YYYY-MM-DD format, or null
- grand_total: the FINAL total amount actually charged including tax, as a number (NOT the
  subtotal), or null
- card_last4: the last 4 digits of the card if printed, as a 4-character string, or null
- auth_code: the approval/authorization code if printed, or null
- legibility: one of "clear", "partial", "poor"
- field_confidence: an object with keys merchant, purchase_date, grand_total, card_last4,
  each set to "high", "medium", or "low"
- notes: a short string noting anything ambiguous or unreadable, or "" if none
Rules: grand_total is the largest FINAL total charged, never the subtotal. If a value is
not clearly legible, use null and mark its confidence "low". Do not guess.`;

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/** Strip code fences and parse the model's JSON. Returns null on any
 *  failure — the caller marks ocr_status='failed', never crashes. */
function parseModelJson(text: string): Record<string, unknown> | null {
  let t = (text ?? "").trim();
  // Remove ```json ... ``` or ``` ... ``` fences if the model added them.
  const fence = t.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  if (fence) t = fence[1].trim();
  try {
    const obj = JSON.parse(t);
    return obj && typeof obj === "object" ? obj as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function coerceTotal(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function validDate(v: unknown): string | null {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
}

function validLegibility(v: unknown): string | null {
  return v === "clear" || v === "partial" || v === "poor" ? v : null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST")    return json(405, { error: "method not allowed" });

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return json(401, { error: "missing bearer token" });

  // 1) Caller must be an active admin or manager (mirrors mro_can_bill()).
  const caller = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: who, error: whoErr } = await caller.auth.getUser();
  if (whoErr || !who.user) return json(401, { error: "invalid token" });

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
  const { data: callerRow } = await admin
    .from("users")
    .select("role, is_manager, active")
    .eq("auth_user_id", who.user.id)
    .maybeSingle();
  const canBill = !!callerRow?.active &&
    (callerRow.role === "admin" || callerRow.role === "manager" || callerRow.is_manager === true);
  if (!canBill) return json(403, { error: "admin or manager only" });

  // 2) Input + receipt lookup.
  let body: { receipt_id?: string };
  try { body = await req.json(); } catch { return json(400, { error: "invalid json" }); }
  const receiptId = (body.receipt_id ?? "").trim();
  if (!receiptId) return json(400, { error: "receipt_id required" });

  const { data: receipt, error: rErr } = await admin
    .from("mro_receipts")
    .select("id, storage_path, image_mime")
    .eq("id", receiptId)
    .maybeSingle();
  if (rErr) return json(500, { error: rErr.message });
  if (!receipt) return json(404, { error: "receipt not found" });

  const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
  if (!ANTHROPIC_API_KEY) {
    return json(500, {
      error: "ANTHROPIC_API_KEY not configured — add it as a Supabase Edge Function secret.",
    });
  }

  // 3) Download the image from the private bucket.
  const { data: blob, error: dlErr } = await admin.storage
    .from(RECEIPTS_BUCKET)
    .download(receipt.storage_path);
  if (dlErr || !blob) {
    await admin.from("mro_receipts").update({ ocr_status: "failed" }).eq("id", receiptId);
    return json(502, { error: `download failed: ${dlErr?.message ?? "no blob"}` });
  }

  const mediaType = (receipt.image_mime || blob.type || "").toLowerCase();
  if (!SUPPORTED_IMAGE_TYPES.has(mediaType)) {
    // HEIC/HEIF and anything else the vision API can't read — fail clean.
    await admin.from("mro_receipts").update({
      ocr_status: "failed",
      ocr_raw: { error: "unsupported_media_type", media_type: mediaType,
                 hint: "Anthropic vision accepts jpeg/png/webp/gif; convert HEIC to JPEG." },
    }).eq("id", receiptId);
    return json(415, { error: `unsupported media type: ${mediaType || "unknown"}` });
  }

  const base64 = toBase64(new Uint8Array(await blob.arrayBuffer()));

  // 4) Call the Anthropic Messages API.
  let apiResp: Response;
  try {
    apiResp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 1000,
        messages: [{
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } },
            { type: "text", text: EXTRACTION_PROMPT },
          ],
        }],
      }),
    });
  } catch (e) {
    await admin.from("mro_receipts").update({ ocr_status: "failed" }).eq("id", receiptId);
    return json(502, { error: `anthropic request failed: ${(e as Error).message}` });
  }

  if (!apiResp.ok) {
    const errText = await apiResp.text();
    await admin.from("mro_receipts").update({
      ocr_status: "failed",
      ocr_raw: { error: "anthropic_error", status: apiResp.status, body: errText.slice(0, 600) },
    }).eq("id", receiptId);
    return json(502, { error: `anthropic ${apiResp.status}: ${errText.slice(0, 300)}` });
  }

  const apiJson = await apiResp.json();
  const text: string = apiJson?.content?.[0]?.text ?? "";
  const parsed = parseModelJson(text);

  if (!parsed) {
    // 5) Defensive parse failure — record, don't crash.
    await admin.from("mro_receipts").update({
      ocr_status: "failed",
      ocr_raw: { error: "json_parse_failed", model_text: text.slice(0, 1000), api: apiJson },
    }).eq("id", receiptId);
    return json(200, { ok: false, ocr_status: "failed", reason: "json_parse_failed" });
  }

  // 6) Map → columns. Validate/coerce; never trust raw types.
  const fc = (parsed.field_confidence && typeof parsed.field_confidence === "object")
    ? parsed.field_confidence : null;
  const update = {
    extracted_merchant: typeof parsed.merchant === "string" ? parsed.merchant : null,
    extracted_total:    coerceTotal(parsed.grand_total),
    extracted_date:     validDate(parsed.purchase_date),
    extracted_last4:    typeof parsed.card_last4 === "string" ? parsed.card_last4.slice(0, 4) : null,
    extracted_auth:     typeof parsed.auth_code === "string" ? parsed.auth_code : null,
    ocr_legibility:     validLegibility(parsed.legibility),
    ocr_confidence:     fc,
    ocr_raw:            { parsed, model: "claude-sonnet-4-6", usage: apiJson?.usage ?? null },
    ocr_status:         "done",
  };
  const { error: upErr } = await admin.from("mro_receipts").update(update).eq("id", receiptId);
  if (upErr) return json(500, { error: upErr.message });

  return json(200, {
    ok: true,
    ocr_status: "done",
    extracted_total: update.extracted_total,
    legibility: update.ocr_legibility,
  });
});
