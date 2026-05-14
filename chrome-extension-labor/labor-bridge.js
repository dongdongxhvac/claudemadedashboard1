// COVE Labor — ISOLATED-world bridge.
//
// Runs at document_idle. Listens for the MAIN-world hook's CustomEvents,
// orchestrates the date-range update, and sends the resulting CSV string to
// the background service worker for download.
//
// Activation gate: only runs the auto-flow when the URL hash is exactly
// #cove-pm-auto. Background sets that hash when the user clicks "Run Daily
// Export" so we don't accidentally fire when the user is just browsing.

(async () => {
  if (location.hash !== "#cove-pm-auto") return;
  console.log("[cove-labor-bridge] Auto-run triggered.");

  // Stash captured GQL responses so we can scan them for labor data later.
  const captured = [];
  window.addEventListener("cove-labor-gql-captured", (e) => {
    captured.push(e.detail);
  });

  // 1) Wait for the date input to mount, signalling page is ready.
  const startInput = await waitFor('input[placeholder="Date"]', 30_000);
  if (!startInput) {
    console.warn("[cove-labor-bridge] Date inputs never appeared.");
    return;
  }

  // 2) Compute Mon–Sun of the current week using LOCAL time (not UTC).
  const { mondayDate, sundayDate, mondayLabel, sundayLabel, mondayIso } =
    currentWeekMonSun();
  console.log(
    `[cove-labor-bridge] Setting date range: ${mondayLabel} -> ${sundayLabel}`
  );

  // 3) Let the initial chart render once before we change dates — this also
  //    gives us a baseline GQL response (the default 30-day window) which is
  //    useful for schema discovery.
  await sleep(2500);

  // 4) Set start, then end. Two ticks between calls so React re-renders.
  setDateInput(0, mondayLabel);
  await sleep(350);
  setDateInput(1, sundayLabel);

  // 5) Wait for the new GQL response. We poll captured[] for one whose body
  //    parses as JSON containing labor-shaped data, and is timestamped after
  //    we triggered the date change.
  const refetchTriggerTs = Date.now();
  let laborRows = null;
  const maxWaitMs = 20_000;
  const pollDeadline = Date.now() + maxWaitMs;
  while (Date.now() < pollDeadline) {
    for (let i = captured.length - 1; i >= 0; i--) {
      const c = captured[i];
      if (c.ts < refetchTriggerTs - 500) continue; // ignore old ones
      const rows = extractLaborRows(c.body);
      if (rows && rows.length > 0) {
        laborRows = rows;
        console.log(
          `[cove-labor-bridge] Extracted ${rows.length} rows from GQL.`
        );
        break;
      }
    }
    if (laborRows) break;
    await sleep(400);
  }

  console.log(
    `[cove-labor-bridge] Total GQL captures: ${captured.length}. Headers of latest 3:`
  );
  for (const c of captured.slice(-3)) {
    console.log(
      `   - via=${c.via} url=${(c.url || "").slice(-30)} ts=${c.ts} bodyHead=${(
        c.body || ""
      )
        .slice(0, 220)
        .replace(/\s+/g, " ")}`
    );
  }

  // 6) Fallback: if no GQL parse worked, scrape the SVG chart directly.
  if (!laborRows) {
    console.warn(
      "[cove-labor-bridge] GQL extraction failed, falling back to SVG scrape."
    );
    try {
      laborRows = scrapeChartSvg();
      console.log(
        `[cove-labor-bridge] SVG scrape produced ${
          laborRows ? laborRows.length : 0
        } rows.`
      );
    } catch (e) {
      console.error("[cove-labor-bridge] SVG scrape threw:", e);
    }
  }

  if (!laborRows || laborRows.length === 0) {
    console.error(
      "[cove-labor-bridge] Could not extract labor data by any method."
    );
    return;
  }

  // 7) Build CSV and send to background.
  const csv = buildCsv(laborRows, mondayIso);

  chrome.runtime.sendMessage(
    {
      action: "saveLaborCsv",
      csv,
      weekStartIso: mondayIso,
    },
    (resp) => {
      if (resp && resp.ok) {
        console.log("[cove-labor-bridge] Download requested:", resp.filename);
      } else {
        console.warn("[cove-labor-bridge] Background returned:", resp);
      }
    }
  );

  // Strip the hash so a refresh doesn't re-trigger.
  history.replaceState(null, "", location.pathname + location.search);
})();

// ---------- helpers ----------

function setDateInput(which, value) {
  window.dispatchEvent(
    new CustomEvent("cove-labor-set-date", { detail: { which, value } })
  );
}

function currentWeekMonSun() {
  const today = new Date();
  // JS: getDay() — Sunday = 0, Monday = 1, ... Saturday = 6
  const dow = today.getDay();
  const offsetToMonday = dow === 0 ? -6 : 1 - dow;
  const monday = new Date(today);
  monday.setDate(today.getDate() + offsetToMonday);
  monday.setHours(0, 0, 0, 0);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);

  const fmt = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  return {
    mondayDate: monday,
    sundayDate: sunday,
    mondayLabel: fmt.format(monday), // e.g. "May 4, 2026"
    sundayLabel: fmt.format(sunday), // e.g. "May 10, 2026"
    mondayIso: isoDate(monday),
    sundayIso: isoDate(sunday),
  };
}

function isoDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

// Pull "[{name, hours}, ...]" out of a GraphQL response body.
//
// Cove's confirmed schema (as of 2026-05):
//   { data: { siteNetwork: { workOrderAndPMTaskLaborReport: {
//       totalValue, page: {total},
//       items: [{ label: "Jorge Figueroa", value: 23.17 }, ...]
//   } } } }
//
// We try this exact path first, then fall back to a generic walker that finds
// any array of {label, value} or {name, hours}-shaped objects, in case Cove
// renames fields or moves the nesting in the future.
function extractLaborRows(body) {
  if (typeof body !== "string") return null;
  let json;
  try {
    json = JSON.parse(body);
  } catch (e) {
    return null;
  }

  // 1) Direct schema match for Cove's known response.
  const direct =
    json &&
    json.data &&
    json.data.siteNetwork &&
    json.data.siteNetwork.workOrderAndPMTaskLaborReport &&
    json.data.siteNetwork.workOrderAndPMTaskLaborReport.items;
  if (Array.isArray(direct) && direct.length > 0 && direct[0].label !== undefined) {
    return direct
      .map((e) => ({
        name: String(e.label || "").trim(),
        hours: Number(e.value),
      }))
      .filter((r) => r.name && Number.isFinite(r.hours));
  }

  // 2) Generic heuristic fallback — walk the tree, score arrays by how
  //    "labor-shaped" they look, return the best match.
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
        if (score > bestScore) {
          bestScore = score;
          bestArray = node;
        }
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
    if (name && Number.isFinite(hours)) {
      rows.push({ name, hours });
    }
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
  if (obj.firstName || obj.lastName) {
    return `${obj.firstName || ""} ${obj.lastName || ""}`.trim();
  }
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
  // Sometimes the API returns minutes — convert.
  if (typeof obj.minutes === "number") return obj.minutes / 60;
  if (typeof obj.totalMinutes === "number") return obj.totalMinutes / 60;
  return null;
}

// SVG-scrape fallback: read assignee labels and bar widths from the chart and
// compute hours via the X-axis tick scale.
function scrapeChartSvg() {
  const svg = [...document.querySelectorAll("svg")].find(
    (s) => s.getBoundingClientRect().width > 600
  );
  if (!svg) return null;
  const allText = [...svg.querySelectorAll("text")];

  // Y-axis (assignee names): non-numeric text on the left.
  const nameNodes = allText
    .filter((t) => !/^\d+(\.\d+)?$/.test(t.textContent.trim()))
    .filter((t) => t.textContent.trim().length > 1);

  // X-axis (numeric ticks): numeric text on the top/bottom.
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

  // Match each name to the closest bar (by Y center).
  const rows = [];
  for (const t of nameNodes) {
    const tr = t.getBoundingClientRect();
    const ty = tr.top + tr.height / 2;
    let best = null;
    let bestDelta = Infinity;
    for (const r of rects) {
      const br = r.getBoundingClientRect();
      const by = br.top + br.height / 2;
      const d = Math.abs(by - ty);
      if (d < bestDelta) {
        bestDelta = d;
        best = r;
      }
    }
    if (best && bestDelta < 25) {
      const br = best.getBoundingClientRect();
      const hours = +(br.width / pxPerUnit).toFixed(2);
      rows.push({ name: t.textContent.trim(), hours });
    }
  }
  // De-dup: an SVG can render labels twice (visible + hidden mirror)
  const seen = new Map();
  for (const r of rows) {
    if (!seen.has(r.name) || seen.get(r.name).hours < r.hours) {
      seen.set(r.name, r);
    }
  }
  return [...seen.values()];
}

function buildCsv(rows, mondayIso) {
  const sorted = [...rows].sort((a, b) => b.hours - a.hours);
  const header = "Assigned To,Labor Hours,Week Start";
  const body = sorted
    .map(
      (r) =>
        `${csvEscape(r.name)},${(+r.hours).toFixed(2)},${mondayIso}`
    )
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
      if (!resolved) {
        resolved = true;
        obs.disconnect();
        resolve(null);
      }
    }, timeoutMs);
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
