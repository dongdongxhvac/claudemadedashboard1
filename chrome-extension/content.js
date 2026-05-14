// COVE PM12 Daily Export — content script
//
// Runs on every manage.cove.is/networks/*/pm-tasks* page. Only does work when
// the URL hash is exactly #cove-pm-auto (set by background.js when the user
// clicks "Run Daily Export" in the popup).
//
// Two timing gotchas this script handles:
//
//   1. Cove's "Download as CSV" button uses a React onClick prop (not a native
//      DOM click handler). Plain Element.click() and dispatched MouseEvents are
//      both ignored. We invoke the React fiber's onClick directly, which also
//      dodges Chrome's isTrusted gate that would block a programmatic blob
//      download. This script must run in the page's MAIN world (configured in
//      manifest.json) so we can read React's internal __reactProps$ key.
//
//   2. The download button is in the DOM long before the row data is fetched.
//      Cove builds the CSV from in-memory rows, so clicking too early produces
//      an empty CSV (headers only). We poll until [role=row] count is >= 2 and
//      stable for 1.5s, then add a small settle buffer.

(async () => {
  if (location.hash !== "#cove-pm-auto") return;

  console.log("[cove-pm-export] Auto-run triggered. Waiting for page to be ready...");

  const btn = await waitFor('div[title="Download as CSV"] button', 30_000);
  if (!btn) {
    console.warn("[cove-pm-export] Download button never appeared within 30s.");
    return;
  }

  const rowCount = await waitForTableReady(45_000);
  if (rowCount == null) {
    console.warn("[cove-pm-export] Table never populated within 45s. Aborting.");
    return;
  }
  console.log(`[cove-pm-export] Table ready with ${rowCount} rows in DOM.`);

  // Extra settle so any in-flight state updates after the row render commit.
  await sleep(1500);

  // Session flag is set by background BEFORE this tab opened — no need to
  // do it from MAIN world here (where chrome.* messaging is flaky).
  const result = triggerReactClick(btn);
  console.log("[cove-pm-export] Triggered download via:", result.method, result.error || "");

  // Strip the hash so a refresh of this tab doesn't re-trigger.
  history.replaceState(null, "", location.pathname + location.search);
})();

// Wait until the table has rows AND the count has stayed stable for 1.5s.
// Cove streams data asynchronously after the page shell renders, so we need
// to see the rows actually appear before clicking Download.
async function waitForTableReady(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  const STABLE_MS = 1500;
  let lastCount = -1;
  let stableSince = 0;

  while (Date.now() < deadline) {
    const count = document.querySelectorAll('[role=row]').length;

    // Need at least 2 rows: header + at least one data row.
    if (count >= 2) {
      if (count === lastCount) {
        if (Date.now() - stableSince >= STABLE_MS) {
          return count;
        }
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

// Invoke the React onClick prop directly. This bypasses the React event
// delegation system and the isTrusted requirement that blocks blob downloads
// from synthetic events. Falls back through a few alternatives if the prop
// isn't where we expect.
function triggerReactClick(el) {
  // Strategy 1: React 17/18 — props live on a __reactProps$<random> key
  for (const k of Object.keys(el)) {
    if (k.startsWith("__reactProps") && el[k] && typeof el[k].onClick === "function") {
      try {
        el[k].onClick();
        return { method: "react-prop" };
      } catch (e) {
        return { method: "react-prop-error", error: String(e) };
      }
    }
  }

  // Strategy 2: walk up to a parent that has React props (in case the click
  // is delegated higher in the tree)
  let cur = el.parentElement;
  let depth = 0;
  while (cur && depth < 5) {
    for (const k of Object.keys(cur)) {
      if (k.startsWith("__reactProps") && cur[k] && typeof cur[k].onClick === "function") {
        try {
          cur[k].onClick();
          return { method: `react-prop-ancestor-${depth}` };
        } catch (e) {
          // keep walking
        }
      }
    }
    cur = cur.parentElement;
    depth += 1;
  }

  // Strategy 3: native .click() — works for actual buttons with native handlers
  try {
    el.click();
    return { method: "native-click" };
  } catch (e) {
    return { method: "native-click-error", error: String(e) };
  }
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

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
