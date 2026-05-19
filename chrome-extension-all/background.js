// COVE Daily Exports — combined background service worker (PM12 + WO12 only).
//
// Labor was moved to the Python API poller (watcher/labor_poller.py), so this
// extension no longer touches the labor page.
//
// Why one extension instead of two: a single chrome.downloads.onDeterminingFilename
// listener can route both PM12 and WO12 CSV downloads cleanly. With two
// separate extensions Chrome would call both listeners on every download and
// the one that "won" the rename was unpredictable.
//
// Routing rule: a session flag is stamped BEFORE each tab opens (one of two
// independent keys, expectingPm12Download / expectingWoDownload). The listener
// claims a download whose flag is fresh, then removes the flag so the next
// download falls through to the other kind. We tried routing by item.referrer
// in v0.3 but blob: URL downloads have an empty referrer in Chrome, so that
// fell through to no-rename.
//
// To keep concurrent runs from confusing the flag-based router, "Run both" in
// the popup sequences PM12 then WO12 about 8s apart via chrome.alarms (long
// enough for the first download to land + flag to clear before the second
// flag is set).
//
// Storage keys (chrome.storage.sync):
//   subdir          — single download subfolder shared by both exports
//   pmBookmarkUrl   — PM12 bookmark URL
//   woBookmarkUrl   — WO12 bookmark URL

const SORT_BY_DUE_DATE_ASC = '[{"id":"dueDate","desc":false}]';
const RUN_BOTH_GAP_MS = 8_000;

// ---------------- messages from popup ----------------

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || !msg.action) return false;

  if (msg.action === "runPmExport") {
    runHashedExport({
      urlKey: "pmBookmarkUrl",
      hash: "cove-pm-auto",
      flagKey: "expectingPm12Download",
      forceSort: true,
      missingUrlMsg: "No PM12 bookmark URL configured. Open Settings.",
    }, sendResponse);
    return true;
  }

  if (msg.action === "runWoExport") {
    runHashedExport({
      urlKey: "woBookmarkUrl",
      hash: "cove-wo-auto",
      flagKey: "expectingWoDownload",
      forceSort: true,
      missingUrlMsg: "No WO12 bookmark URL configured. Open Settings.",
    }, sendResponse);
    return true;
  }

  if (msg.action === "runAll") {
    // Fire PM12 immediately, then schedule WO12 via chrome.alarms for ~8s
    // later. Alarms (not setTimeout) because MV3 service workers can be
    // killed between the two steps.
    chrome.storage.session
      .set({ runAllPending: "wo" })
      .then(() => chrome.alarms.create("runAllStep", { when: Date.now() + RUN_BOTH_GAP_MS }))
      .then(() => {
        runHashedExport({
          urlKey: "pmBookmarkUrl",
          hash: "cove-pm-auto",
          flagKey: "expectingPm12Download",
          forceSort: true,
          missingUrlMsg: "No PM12 bookmark URL configured.",
        }, (resp) => sendResponse(resp));
      });
    return true;
  }

  return false;
});

// Alarm sequencer for "Run both": fires the queued WO12 step.
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== "runAllStep") return;
  chrome.storage.session.get({ runAllPending: null }).then(({ runAllPending }) => {
    if (runAllPending !== "wo") return;
    chrome.storage.session.remove("runAllPending");
    runHashedExport({
      urlKey: "woBookmarkUrl",
      hash: "cove-wo-auto",
      flagKey: "expectingWoDownload",
      forceSort: true,
      missingUrlMsg: "No WO12 bookmark URL configured.",
    }, () => {});
  });
});

// Shared launcher for PM12 + WO12. Stamps the session flag BEFORE opening
// the tab — the content script that actually clicks Download runs in the
// page's MAIN world where chrome.* messaging is unreliable, so the flag
// must be in place ahead of time. 60s freshness check in the download
// listener covers normal page-load + click latency.
function runHashedExport(opts, sendResponse) {
  chrome.storage.sync.get({ [opts.urlKey]: "" }, (cfg) => {
    const raw = cfg[opts.urlKey];
    if (!raw) {
      sendResponse({ ok: false, error: opts.missingUrlMsg });
      return;
    }
    let url;
    try { url = new URL(raw); }
    catch (e) {
      sendResponse({ ok: false, error: "Bookmark URL is not a valid URL." });
      return;
    }
    if (opts.forceSort) url.searchParams.set("sortBy", SORT_BY_DUE_DATE_ASC);
    url.hash = opts.hash;
    chrome.storage.session.set({ [opts.flagKey]: Date.now() }).then(() => {
      chrome.tabs.create({ url: url.toString(), active: true }, (tab) => {
        sendResponse({ ok: true, tabId: tab.id });
      });
    });
  });
}

// ---------------- single download-rename listener ----------------

chrome.downloads.onDeterminingFilename.addListener((item, suggest) => {
  console.log(
    `[cove-exports] dl id=${item.id} byExt=${item.byExtensionId} ` +
    `url=${(item.url || "").slice(0, 60)} filename="${item.filename}"`
  );

  // Another extension owns this download — back off.
  if (item.byExtensionId && item.byExtensionId !== chrome.runtime.id) {
    console.log("[cove-exports]   skipped: other extension owns this download");
    return false;
  }

  const url = item.url || "";
  const finalUrl = item.finalUrl || "";

  // Only claim Cove blob/https CSVs.
  const fromCove =
    /^(?:blob:)?https?:\/\/[^\/]*cove\.is/i.test(url) ||
    /^(?:blob:)?https?:\/\/[^\/]*cove\.is/i.test(finalUrl);
  if (!fromCove) return false;
  if (!/\.csv$/i.test(item.filename || "")) return false;

  // Distinguish PM vs WO by which session flag is fresh. If both are fresh
  // (shouldn't happen with the 8s sequencer in runAll, but possible if the
  // user clicks both individual buttons very quickly), prefer the newer one.
  chrome.storage.session
    .get({ expectingPm12Download: 0, expectingWoDownload: 0 })
    .then(({ expectingPm12Download, expectingWoDownload }) => {
      const now = Date.now();
      const pmFresh = expectingPm12Download && now - expectingPm12Download < 60_000;
      const woFresh = expectingWoDownload && now - expectingWoDownload < 60_000;

      let kind = null;
      if (pmFresh && woFresh) {
        kind = expectingPm12Download >= expectingWoDownload ? "pm" : "wo";
      } else if (pmFresh) {
        kind = "pm";
      } else if (woFresh) {
        kind = "wo";
      }

      if (!kind) {
        console.log("[cove-exports]   no fresh PM/WO run — passing through");
        suggest();
        return;
      }

      // Remove the matching flag so a follow-up download (e.g. the second
      // half of a "Run both" sequence) doesn't claim this kind too.
      const flagKey = kind === "pm" ? "expectingPm12Download" : "expectingWoDownload";
      chrome.storage.session.remove(flagKey);

      chrome.storage.sync.get({ subdir: "cove-csvs" }, (cfg) => {
        const subdir = (cfg.subdir || "cove-csvs").replace(/^[\\/]+|[\\/]+$/g, "");
        const label = kind === "pm" ? "PM12" : "WO12";
        const filename = `${subdir}/COVE ${label} ${isoToday()} ${hourLabel()} ${minSecLabel()}.csv`;
        console.log(`[cove-exports]   ${kind} -> ${filename}`);
        suggest({ filename, conflictAction: "overwrite" });
      });
    });
  return true;
});

// ---------------- shared helpers ----------------

function isoToday() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

function hourLabel() {
  const h = new Date().getHours();
  const period = h >= 12 ? "pm" : "am";
  let h12 = h % 12;
  if (h12 === 0) h12 = 12;
  return `${h12}${period}`;
}

// "MM-SS" with zero-padding. Dash (not colon) because Windows filenames
// reject `:`. Lets the user fire the same export several times within one
// hour without collisions on disk.
function minSecLabel() {
  const d = new Date();
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${mm}-${ss}`;
}
