// ot-api-sync — Supabase Edge Function.
//
// Mirrors the University Park Overtime API (Steve's / "Jie's CW OT Viewer")
// into ot_api_jobs + ot_api_syncs (migration 0136). Hosted twin of
// watcher/ot_api_poller.py for when the API is reachable from the public
// internet (https://uparkot.rai-zenith.com) — then nothing has to run on a
// VM or workstation: pg_cron POSTs here every minute (migration 0137).
// Same write semantics as the poller: upsert this run's jobs on the API's
// id, delete the rest (an id changes when the Outlook event moves), log one
// syncs row per run (ok or error, with the raw payload).
//
// Request:  POST {}            (body ignored)
// Auth:     verify_jwt — the cron job sends the anon key, like
//           flush-pto-notify-queue (0109). The key may read the board once
//           per 300 s (the API's own 429 message; stricter than the
//           handoff's 60/min). The cron POSTs every minute and this function
//           reads upstream only when the last OK sync is older than
//           UPARK_OT_API_MIN_GAP_S (default 310 s), so the mirror refreshes
//           as soon as the key allows — about every 5-6 minutes — and an
//           upstream 429 is a skip, not a logged failure. If Steve relaxes
//           the key's limit, lower the gap with one set_app_secret call.
// Response: 200 { ok, jobs, open_spaces, skipped?, warnings }
//           | 502 { error }  (upstream failure — also logged to ot_api_syncs)
//
// Config (edge-function secrets first, then the get_app_secret Vault
// accessor from 0078/0103):
//   UPARK_OT_API_KEY   — bearer key from the OT viewer (required)
//   UPARK_OT_API_BASE  — default https://uparkot.rai-zenith.com
//   UPARK_OT_API_DAYS  — 1-90, default 14
//   UPARK_OT_API_MIN_GAP_S — seconds between upstream reads, default 310
//     select set_app_secret('UPARK_OT_API_KEY', 'upot_...');
//     select set_app_secret('UPARK_OT_API_BASE', 'https://...');

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const DEFAULT_BASE = "https://uparkot.rai-zenith.com";
const DEFAULT_MIN_GAP_S = 310;

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

type Volunteer = { name?: unknown; email?: unknown; signed_up?: unknown };
type ApiJob = {
  id?: unknown; title?: unknown; location?: unknown; source?: unknown; notes?: unknown;
  start?: unknown; end?: unknown; all_day?: unknown; when?: unknown;
  spaces?: unknown; filled?: unknown; open?: unknown; status?: unknown; volunteers?: unknown;
};
type ApiPayload = {
  generated?: unknown; window_days?: unknown; jobs?: unknown; warnings?: unknown; team?: unknown;
};

const str = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s || null;
};
const int = (v: unknown, dflt = 0): number => {
  const n = typeof v === "number" ? v : parseInt(String(v ?? ""), 10);
  return Number.isFinite(n) ? n : dflt;
};
/** ISO-8601 with offset passes straight through to timestamptz; junk → null. */
const ts = (v: unknown): string | null => {
  const s = str(v);
  if (!s) return null;
  return Number.isNaN(new Date(s).getTime()) ? null : s;
};

function mapJob(j: ApiJob, fetchedAt: string) {
  const id = str(j.id);
  const start = ts(j.start);
  if (!id || !start) return null;
  const spaces = int(j.spaces);
  const vols = Array.isArray(j.volunteers) ? (j.volunteers as Volunteer[]) : [];
  const filled = int(j.filled, vols.length);
  const open = int(j.open, Math.max(0, spaces - filled));
  const status = str(j.status) ?? (open === 0 ? "full" : filled ? "partial" : "unfilled");
  return {
    id,
    title:       str(j.title) ?? "",
    location:    str(j.location),
    source:      str(j.source),
    notes:       str(j.notes),
    start_at:    start,
    end_at:      ts(j.end),
    all_day:     j.all_day === true,
    when_text:   str(j.when),
    spaces,
    filled,
    open_spaces: open,
    status,
    volunteers:  vols.map((v) => ({ name: str(v.name), email: str(v.email), signed_up: ts(v.signed_up) })),
    raw:         j,
    fetched_at:  fetchedAt,
  };
}

async function config(admin: ReturnType<typeof createClient>) {
  const fromVault = async (k: string): Promise<string> => {
    const { data } = await admin.rpc("get_app_secret", { k });
    return typeof data === "string" ? data.trim() : "";
  };
  const key  = Deno.env.get("UPARK_OT_API_KEY")?.trim()  || await fromVault("UPARK_OT_API_KEY");
  const base = (Deno.env.get("UPARK_OT_API_BASE")?.trim() || await fromVault("UPARK_OT_API_BASE") || DEFAULT_BASE).replace(/\/+$/, "");
  const daysRaw = Deno.env.get("UPARK_OT_API_DAYS")?.trim() || await fromVault("UPARK_OT_API_DAYS");
  const days = Math.max(1, Math.min(90, int(daysRaw, 14) || 14));
  const gapRaw = Deno.env.get("UPARK_OT_API_MIN_GAP_S")?.trim() || await fromVault("UPARK_OT_API_MIN_GAP_S");
  const minGapMs = Math.max(30, int(gapRaw, DEFAULT_MIN_GAP_S) || DEFAULT_MIN_GAP_S) * 1000;
  return { key, base, days, minGapMs };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST")    return json(405, { error: "method not allowed" });

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
  const fetchedAt = new Date().toISOString();
  const { key, base, days, minGapMs } = await config(admin);

  // Debounce: one upstream read per minGapMs, whoever calls and however often.
  const { data: last } = await admin
    .from("ot_api_syncs")
    .select("fetched_at")
    .eq("status", "ok")
    .order("fetched_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (last && Date.now() - new Date(last.fetched_at as string).getTime() < minGapMs) {
    return json(200, { ok: true, skipped: `synced less than ${Math.round(minGapMs / 1000)} s ago` });
  }

  const url = `${base}/api/v1/ot?days=${days}`;

  const fail = async (msg: string) => {
    await admin.from("ot_api_syncs").insert({
      fetched_at: fetchedAt, status: "error", error_msg: msg.slice(0, 4000), source_url: url,
    });
    return json(502, { error: msg });
  };

  if (!key) return fail("UPARK_OT_API_KEY is not set (edge secret or set_app_secret)");

  let payload: ApiPayload;
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 25_000);
    const r = await fetch(url, {
      headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
      signal: ctl.signal,
    });
    clearTimeout(t);
    if (r.status !== 200) {
      let detail = "";
      try { detail = ((await r.json()) as { error?: string }).error ?? ""; } catch { /* non-JSON body */ }
      // Rate-limited is not a broken mirror: the last OK sync still stands.
      if (r.status === 429) return json(200, { ok: true, skipped: `rate limited upstream: ${detail}`.trim() });
      const hint = { 401: "missing/invalid key", 403: "key not allowed" }[r.status] ?? "";
      return fail(`GET ${url} -> ${r.status} ${hint} ${detail}`.trim());
    }
    payload = (await r.json()) as ApiPayload;
  } catch (e) {
    return fail(`GET ${url} failed: ${(e as Error).message}`);
  }
  if (!payload || !Array.isArray(payload.jobs)) {
    return fail(`GET ${url}: unexpected payload shape (no jobs list)`);
  }

  const jobs = (payload.jobs as ApiJob[]).map((j) => mapJob(j, fetchedAt)).filter((j) => j !== null);
  const skipped = payload.jobs.length - jobs.length;
  const ids = jobs.map((j) => j!.id);

  for (let i = 0; i < jobs.length; i += 200) {
    const { error } = await admin.from("ot_api_jobs").upsert(jobs.slice(i, i + 200), { onConflict: "id" });
    if (error) return fail(`upsert ot_api_jobs: ${error.message}`);
  }
  const del = ids.length
    ? await admin.from("ot_api_jobs").delete().not("id", "in", `(${ids.map((id) => `"${id.replace(/"/g, '""')}"`).join(",")})`)
    : await admin.from("ot_api_jobs").delete().neq("id", "");
  if (del.error) return fail(`prune ot_api_jobs: ${del.error.message}`);

  const warnings = Array.isArray(payload.warnings) ? payload.warnings : [];
  const team     = Array.isArray(payload.team) ? payload.team : [];
  const { error: logErr } = await admin.from("ot_api_syncs").insert({
    fetched_at:   fetchedAt,
    status:       "ok",
    source_url:   url,
    generated_at: ts(payload.generated),
    window_days:  int(payload.window_days, days),
    job_count:    jobs.length,
    warnings,
    team,
    payload,
  });
  if (logErr) return json(500, { error: `log ot_api_syncs: ${logErr.message}` });

  // Trim old sync rows (each carries the full payload) — keep 7 days.
  await admin.from("ot_api_syncs").delete().lt("fetched_at", new Date(Date.now() - 7 * 86_400_000).toISOString());

  const openSpaces = jobs.reduce((s, j) => s + j!.open_spaces, 0);
  return json(200, { ok: true, jobs: jobs.length, open_spaces: openSpaces, skipped_rows: skipped, warnings });
});
