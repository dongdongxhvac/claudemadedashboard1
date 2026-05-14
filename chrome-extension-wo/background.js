// COVE WO12 Daily Export — background service worker
//
// Mirrors the PM12 extension, but for the Work Orders page.
//
// Two responsibilities:
//   1. Open the bookmark URL (with sortBy=Due Date asc forced) in a new tab,
//      with #cove-wo-auto so content.js knows to auto-click Download.
//   2. Intercept downloads from Cove and rename them to
//      "<subdir>/COVE WO12 YYYY-MM-DD <hour>.csv".

const SORT_BY_DUE_DATE_ASC = '[{"id":"dueDate","desc":false}]';

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.action === "runDailyExport") {
    chrome.storage.sync.get({ bookmarkUrl: "" }, (cfg) => {
      if (!cfg.bookmarkUrl) {
        sendResponse({ ok: false, error: "No WO bookmark URL configured. Open Settings." });
        return;
      }
      let url;
      try {
        url = new URL(cfg.bookmarkUrl);
      } catch (e) {
        sendResponse({ ok: false, error: "WO bookmark URL is not a valid URL." });
        return;
      }
      url.searchParams.set("sortBy", SORT_BY_DUE_DATE_ASC);
      url.hash = "cove-wo-auto";

      // Mark this run as expected BEFORE the tab opens. Background sets the
      // flag itself rather than relying on MAIN-world content script
      // messaging, which is unreliable. The flag stays valid for 60s — long
      // enough to cover normal page-load + click-download latency.
      chrome.storage.session
        .set({ expectingWoDownload: Date.now() })
        .then(() => {
          chrome.tabs.create({ url: url.toString(), active: true }, (tab) => {
            sendResponse({ ok: true, tabId: tab.id });
          });
        });
    });
    return true; // async sendResponse
  }
});

// Rename Cove CSV downloads to "<subdir>/COVE WO12 YYYY-MM-DD <hour>.csv".
//
// IMPORTANT cohabitation note: if the PM12 extension is also enabled, both
// listeners will fire on Cove's blob CSV downloads and race. To make this
// listener selective, we only claim downloads triggered while a recent WO
// run is "expected" — set by content.js right before it clicks Download.
chrome.downloads.onDeterminingFilename.addListener((item, suggest) => {
  console.log(
    `[wo12-bg] listener fired. id=${item.id} byExt=${item.byExtensionId} url=${(
      item.url || ""
    ).slice(0, 60)} finalUrl=${(item.finalUrl || "").slice(0, 60)} filename="${
      item.filename
    }"`
  );

  if (item.byExtensionId && item.byExtensionId !== chrome.runtime.id) {
    console.log("[wo12-bg]   skipped: other extension owns this download");
    return false;
  }
  if (/^data:/i.test(item.url || "")) {
    console.log("[wo12-bg]   skipped: data: URL");
    return false;
  }
  const url = item.url || "";
  const finalUrl = item.finalUrl || "";
  const fromCove =
    /^(?:blob:)?https?:\/\/[^\/]*cove\.is/i.test(url) ||
    /^(?:blob:)?https?:\/\/[^\/]*cove\.is/i.test(finalUrl);
  if (!fromCove) {
    console.log("[wo12-bg]   skipped: not a cove.is URL");
    return false;
  }
  if (!/\.csv$/i.test(item.filename || "")) {
    console.log("[wo12-bg]   skipped: not a .csv filename");
    return false;
  }

  // Async session check + suggest. We claim only if our content script set
  // the "expectingWoDownload" flag within the last 60s.
  chrome.storage.session
    .get({ expectingWoDownload: 0 })
    .then(({ expectingWoDownload }) => {
      const fresh = expectingWoDownload && Date.now() - expectingWoDownload < 60_000;
      if (!fresh) {
        console.log("[wo12-bg]   skipped: no recent WO run (probably a PM12 download)");
        // We have to call suggest with the original filename to release.
        suggest();
        return;
      }
      chrome.storage.session.remove("expectingWoDownload");
      chrome.storage.sync.get({ subdir: "cove-PMs-Labor-csv" }, (cfg) => {
        const subdir = (cfg.subdir || "cove-PMs-Labor-csv").replace(
          /^[\\/]+|[\\/]+$/g,
          ""
        );
        const filename = `${subdir}/COVE WO12 ${isoToday()} ${hourLabel()}.csv`;
        console.log(`[wo12-bg]   claiming -> ${filename}`);
        suggest({ filename, conflictAction: "overwrite" });
      });
    });
  return true; // async suggest
});


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
