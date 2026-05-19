// WO12 content script — runs in MAIN world on every networks/* page (except
// pm-tasks and labor-reports, which have their own scripts). Only does work
// when the URL hash is exactly #cove-wo-auto.

(async () => {
  if (location.hash !== "#cove-wo-auto") return;
  console.log("[cove-exports/wo] Auto-run triggered.");

  const btn = await waitFor('div[title="Download as CSV"] button', 30_000);
  if (!btn) { console.warn("[cove-exports/wo] Download button never appeared."); return; }

  const rowCount = await waitForTableReady(45_000);
  if (rowCount == null) { console.warn("[cove-exports/wo] Table never populated."); return; }
  console.log(`[cove-exports/wo] Table ready with ${rowCount} rows.`);

  await sleep(1500);
  const result = triggerReactClick(btn);
  console.log("[cove-exports/wo] Triggered via:", result.method, result.error || "");

  history.replaceState(null, "", location.pathname + location.search);
})();

async function waitForTableReady(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  const STABLE_MS = 1500;
  let lastCount = -1;
  let stableSince = 0;
  while (Date.now() < deadline) {
    const count = document.querySelectorAll("[role=row]").length;
    if (count >= 2) {
      if (count === lastCount) {
        if (Date.now() - stableSince >= STABLE_MS) return count;
      } else {
        lastCount = count;
        stableSince = Date.now();
      }
    } else {
      lastCount = -1;
      stableSince = 0;
    }
    await sleep(250);
  }
  return null;
}

function triggerReactClick(el) {
  for (const k of Object.keys(el)) {
    if (k.startsWith("__reactProps") && el[k] && typeof el[k].onClick === "function") {
      try { el[k].onClick(); return { method: "react-prop" }; }
      catch (e) { return { method: "react-prop-error", error: String(e) }; }
    }
  }
  let cur = el.parentElement, depth = 0;
  while (cur && depth < 5) {
    for (const k of Object.keys(cur)) {
      if (k.startsWith("__reactProps") && cur[k] && typeof cur[k].onClick === "function") {
        try { cur[k].onClick(); return { method: `react-prop-ancestor-${depth}` }; }
        catch (e) {}
      }
    }
    cur = cur.parentElement; depth += 1;
  }
  try { el.click(); return { method: "native-click" }; }
  catch (e) { return { method: "native-click-error", error: String(e) }; }
}

function waitFor(selector, timeoutMs) {
  return new Promise((resolve) => {
    const existing = document.querySelector(selector);
    if (existing) return resolve(existing);
    let resolved = false;
    const finish = (val) => {
      if (resolved) return;
      resolved = true;
      obs.disconnect();
      clearTimeout(timer);
      resolve(val);
    };
    const obs = new MutationObserver(() => {
      const el = document.querySelector(selector);
      if (el) finish(el);
    });
    obs.observe(document.body, { childList: true, subtree: true });
    const timer = setTimeout(() => finish(null), timeoutMs);
  });
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
