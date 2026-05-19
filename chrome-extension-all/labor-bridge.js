// Labor — ISOLATED-world bridge. Listens for the MAIN-world hook's GraphQL
// captures, orchestrates the Mon-Sun date range change, and sends the CSV
// payload to the background service worker for download.
//
// Activation gate: only auto-runs when the URL hash is exactly
// #cove-labor-auto (set by background before opening the tab).

(async () => {
  if (location.hash !== "#cove-labor-auto") return;
  console.log("[cove-exports/labor] Auto-run triggered.");

  const captured = [];
  window.addEventListener("cove-labor-gql-captured", (e) => {
    captured.push(e.detail);
  });

  const startInput = await waitFor('input[placeholder="Date"]', 30_000);
  if (!startInput) { console.warn("[cove-exports/labor] Date inputs never appeared."); return; }

  const { mondayLabel, sundayLabel, mondayIso } = currentWeekMonSun();
  console.log(`[cove-exports/labor] Setting range: ${mondayLabel} -> ${sundayLabel}`);

  // Let the initial chart render once so we get a baseline GQL response.
  await sleep(2500);

  setDateInput(0, mondayLabel);
  await sleep(350);
  setDateInput(1, sundayLabel);

  const refetchTriggerTs = Date.now();
  let laborRows = null;
  const pollDeadline = Date.now() + 20_000;
  while (Date.now() < pollDeadline) {
    for (let i = captured.length - 1; i >= 0; i--) {
      const c = captured[i];
      if (c.ts < refetchTriggerTs - 500) continue;
      const rows = extractLaborRows(c.body);
      if (rows && rows.length > 0) {
        laborRows = rows;
        console.log(`[cove-exports/labor] Extracted ${rows.length} rows from GQL.`);
        break;
      }
    }
    if (laborRows) break;
    await sleep(400);
  }

  if (!laborRows) {
    console.warn("[cove-exports/labor] GQL extraction failed, falling back to SVG scrape.");
    try {
      laborRows = scrapeChartSvg();
      console.log(`[cove-exports/labor] SVG scrape produced ${laborRows ? laborRows.length : 0} rows.`);
    } catch (e) {
      console.error("[cove-exports/labor] SVG scrape threw:", e);
    }
  }

  if (!laborRows || laborRows.length === 0) {
    console.error("[cove-exports/labor] Could not extract labor data by any method.");
    return;
  }

  const csv = buildCsv(laborRows, mondayIso);
  chrome.runtime.sendMessage(
    { action: "saveLaborCsv", csv, weekStartIso: mondayIso },
    (resp) => {
      if (resp && resp.ok) console.log("[cove-exports/labor] Download requested.");
      else console.warn("[cove-exports/labor] Background returned:", resp);
    }
  );

  history.replaceState(null, "", location.pathname + location.search);
})();

function setDateInput(which, value) {
  window.dispatchEvent(
    new CustomEvent("cove-labor-set-date", { detail: { which, value } })
  );
}

// Pick the date range we'll ask Cove to chart. Cove's picker rejects today
// and future dates — earliest END date Cove allows is yesterday — so:
//
//   Tue–Sun: start = this week's Monday, end = yesterday (running total).
//   Mon:     this week's Monday is today, which is unselectable. Fall back to
//            last week's full Mon–Sun so the export still produces useful data.
//
// Returns the same shape the original currentWeekMonSun did (mondayLabel /
// sundayLabel / mondayIso) so the call site doesn't have to change. The names
// are kept "monday/sunday" for continuity even when the range is Mon–Sat etc.
function currentWeekMonSun() {
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  yesterday.setHours(0, 0, 0, 0);

  const dow = today.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
  const offsetToMonday = dow === 0 ? -6 : 1 - dow;
  const thisMonday = new Date(today);
  thisMonday.setDate(today.getDate() + offsetToMonday);
  thisMonday.setHours(0, 0, 0, 0);

  let rangeStart, rangeEnd;
  if (thisMonday > yesterday) {
    // Today is Monday — start would be today, which Cove rejects. Use last
    // week's complete Mon–Sun.
    rangeEnd = yesterday; // yesterday = last Sunday
    rangeStart = new Date(rangeEnd);
    rangeStart.setDate(rangeEnd.getDate() - 6);
  } else {
    // Tue–Sun: running window from this week's Monday through yesterday.
    rangeStart = thisMonday;
    rangeEnd = yesterday;
  }

  const fmt = new Intl.DateTimeFormat("en-US", {
    month: "short", day: "numeric", year: "numeric",
  });
  return {
    mondayDate: rangeStart,
    sundayDate: rangeEnd,
    mondayLabel: fmt.format(rangeStart),
    sundayLabel: fmt.format(rangeEnd),
    mondayIso: isoDate(rangeStart),
    sundayIso: isoDate(rangeEnd),
  };
}

function isoDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

function extractLaborRows(body) {
  if (typeof body !== "string") return null;
  let json;
  try { json = JSON.parse(body); } catch (e) { return null; }

  // Cove's confirmed schema (as of 2026-05):
  //   data.siteNetwork.workOrderAndPMTaskLaborReport.items[*] = {label, value}
  const direct =
    json && json.data && json.data.siteNetwork &&
    json.data.siteNetwork.workOrderAndPMTaskLaborReport &&
    json.data.siteNetwork.workOrderAndPMTaskLaborReport.items;
  if (Array.isArray(direct) && direct.length > 0 && direct[0].label !== undefined) {
    return direct
      .map((e) => ({ name: String(e.label || "").trim(), hours: Number(e.value) }))
      .filter((r) => r.name && Number.isFinite(r.hours));
  }

  // Generic heuristic fallback in case Cove renames fields or moves the nesting.
  let bestArray = null;
  let bestScore = 0;
  const NAME_KEYS = ["label", "firstName", "name", "displayName", "fullName", "userName", "assignee"];
  const HOURS_KEYS = ["value", "totalHours", "hours", "laborHours", "totalLaborHours", "minutes"];
  function visit(node) {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      if (node.length > 0 && typeof node[0] === "object" && node[0] !== null) {
        const sample = node[0];
        let score = 0;
        for (const k of NAME_KEYS) if (k in sample) score += 2;
        for (const k of HOURS_KEYS) if (k in sample) score += 3;
        if (sample.user && typeof sample.user === "object") score += 2;
        if (sample.assignee && typeof sample.assignee === "object") score += 2;
        const hasStr = Object.values(sample).some((v) => typeof v === "string" && v.length > 1);
        const hasNum = Object.values(sample).some((v) => typeof v === "number" && v > 0);
        if (hasStr && hasNum) score += 1;
        if (score > bestScore) { bestScore = score; bestArray = node; }
      }
      for (const v of node) visit(v);
    } else {
      for (const k of Object.keys(node)) visit(node[k]);
    }
  }
  visit(json);
  if (!bestArray || bestScore < 4) return null;

  const rows = [];
  for (const e of bestArray) {
    const name = pickName(e);
    const hours = pickHours(e);
    if (name && Number.isFinite(hours)) rows.push({ name, hours });
  }
  return rows;
}

function pickName(obj) {
  if (!obj || typeof obj !== "object") return null;
  if (typeof obj.label === "string") return obj.label;
  if (obj.user && typeof obj.user === "object") {
    const u = obj.user;
    const fn = u.firstName || u.first_name || "";
    const ln = u.lastName || u.last_name || "";
    if (fn || ln) return `${fn} ${ln}`.trim();
    if (u.name) return String(u.name);
    if (u.displayName) return String(u.displayName);
  }
  if (obj.assignee && typeof obj.assignee === "object") {
    const a = obj.assignee;
    const fn = a.firstName || "";
    const ln = a.lastName || "";
    if (fn || ln) return `${fn} ${ln}`.trim();
    if (a.name) return String(a.name);
  }
  if (obj.firstName || obj.lastName) return `${obj.firstName || ""} ${obj.lastName || ""}`.trim();
  if (typeof obj.name === "string") return obj.name;
  if (typeof obj.displayName === "string") return obj.displayName;
  if (typeof obj.fullName === "string") return obj.fullName;
  return null;
}

function pickHours(obj) {
  if (!obj || typeof obj !== "object") return null;
  for (const k of ["value", "totalHours", "hours", "laborHours", "totalLaborHours"]) {
    const v = obj[k];
    if (typeof v === "number") return v;
    if (typeof v === "string" && !isNaN(parseFloat(v))) return parseFloat(v);
  }
  if (typeof obj.minutes === "number") return obj.minutes / 60;
  if (typeof obj.totalMinutes === "number") return obj.totalMinutes / 60;
  return null;
}

function scrapeChartSvg() {
  const svg = [...document.querySelectorAll("svg")].find(
    (s) => s.getBoundingClientRect().width > 600
  );
  if (!svg) return null;
  const allText = [...svg.querySelectorAll("text")];
  const nameNodes = allText
    .filter((t) => !/^\d+(\.\d+)?$/.test(t.textContent.trim()))
    .filter((t) => t.textContent.trim().length > 1);
  const tickNodes = allText
    .filter((t) => /^\d+(\.\d+)?$/.test(t.textContent.trim()))
    .map((t) => {
      const r = t.getBoundingClientRect();
      return { val: parseFloat(t.textContent.trim()), x: r.left + r.width / 2 };
    })
    .sort((a, b) => a.x - b.x);
  if (tickNodes.length < 2) return null;
  const minTick = tickNodes[0];
  const maxTick = tickNodes[tickNodes.length - 1];
  const pxPerUnit = (maxTick.x - minTick.x) / (maxTick.val - minTick.val || 1);
  if (!Number.isFinite(pxPerUnit) || pxPerUnit <= 0) return null;

  const rects = [...svg.querySelectorAll("rect")].filter((r) => {
    const b = r.getBoundingClientRect();
    return b.width > 5 && b.height > 5 && b.height < 80;
  });

  const rows = [];
  for (const t of nameNodes) {
    const tr = t.getBoundingClientRect();
    const ty = tr.top + tr.height / 2;
    let best = null, bestDelta = Infinity;
    for (const r of rects) {
      const br = r.getBoundingClientRect();
      const by = br.top + br.height / 2;
      const d = Math.abs(by - ty);
      if (d < bestDelta) { bestDelta = d; best = r; }
    }
    if (best && bestDelta < 25) {
      const br = best.getBoundingClientRect();
      const hours = +(br.width / pxPerUnit).toFixed(2);
      rows.push({ name: t.textContent.trim(), hours });
    }
  }
  const seen = new Map();
  for (const r of rows) {
    if (!seen.has(r.name) || seen.get(r.name).hours < r.hours) seen.set(r.name, r);
  }
  return [...seen.values()];
}

function buildCsv(rows, mondayIso) {
  const sorted = [...rows].sort((a, b) => b.hours - a.hours);
  const header = "Assigned To,Labor Hours,Week Start";
  const body = sorted
    .map((r) => `${csvEscape(r.name)},${(+r.hours).toFixed(2)},${mondayIso}`)
    .join("\n");
  return header + "\n" + body + "\n";
}

function csvEscape(s) {
  s = String(s == null ? "" : s);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function waitFor(selector, timeoutMs) {
  return new Promise((resolve) => {
    const existing = document.querySelector(selector);
    if (existing) return resolve(existing);
    let resolved = false;
    const obs = new MutationObserver(() => {
      const el = document.querySelector(selector);
      if (el && !resolved) {
        resolved = true;
        obs.disconnect();
        clearTimeout(timer);
        resolve(el);
      }
    });
    obs.observe(document.body, { childList: true, subtree: true });
    const timer = setTimeout(() => {
      if (!resolved) { resolved = true; obs.disconnect(); resolve(null); }
    }, timeoutMs);
  });
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
