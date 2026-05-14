// COVE PM12 Daily Export — background service worker
//
// Two responsibilities:
//   1. Open the bookmark URL (with sortBy=Due Date asc forced) in a new tab,
//      with #cove-pm-auto so content.js knows to auto-click Download.
//   2. Intercept downloads from Cove and rename them to
//      "<subdir>/COVE PM12 YYYY-MM-DD.csv".

const SORT_BY_DUE_DATE_ASC = '[{"id":"dueDate","desc":false}]';

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.action === "runDailyExport") {
    chrome.storage.sync.get({ bookmarkUrl: "" }, (cfg) => {
      if (!cfg.bookmarkUrl) {
        sendResponse({ ok: false, error: "No bookmark URL configured. Open Settings." });
        return;
      }
      let url;
      try {
        url = new URL(cfg.bookmarkUrl);
      } catch (e) {
        sendResponse({ ok: false, error: "Bookmark URL is not a valid URL." });
        return;
      }
      url.searchParams.set("sortBy", SORT_BY_DUE_DATE_ASC);
      url.hash = "cove-pm-auto";

      // Mark this run as expected BEFORE the tab opens. Background sets the
      // flag itself rather than relying on MAIN-world content-script messaging,
      // which is unreliable. The 60s freshness check in the listener covers
      // normal page-load + click-download latency.
      chrome.storage.session
        .set({ expectingPm12Download: Date.now() })
        .then(() => {
          chrome.tabs.create({ url: url.toString(), active: true }, (tab) => {
            sendResponse({ ok: true, tabId: tab.id });
          });
        });
    });
    return true; // async sendResponse
  }
});

// Rename Cove CSV downloads to "<subdir>/COVE PM12 YYYY-MM-DD.csv"
chrome.downloads.onDeterminingFilename.addListener((item, suggest) => {
  // DIAGNOSTIC: confirm what Chrome is passing us.
  console.log(
    `[pm12-bg] listener fired. id=${item.id} byExt=${item.byExtensionId} url=${(
      item.url || ""
    ).slice(0, 60)} finalUrl=${(item.finalUrl || "").slice(0, 60)} filename="${
      item.filename
    }"`
  );

  // Hands off if another extension triggered this download (e.g. the labor
  // or combined test extension). It already chose its own filename.
  if (item.byExtensionId && item.byExtensionId !== chrome.runtime.id) {
    console.log("[pm12-bg]   skipped: other extension owns this download");
    return false;
  }
  // data: URLs are how other extensions write in-memory CSVs. Cove's own
  // CSV downloads use blob:https://...cove.is/... URLs. Explicitly skip
  // data: so we never compete with another extension's write.
  if (/^data:/i.test(item.url || "")) return false;
  // Only claim if the download URL itself is a Cove blob/HTTPS URL — not
  // just any download whose referrer happens to mention cove.is.
  const url = item.url || "";
  const finalUrl = item.finalUrl || "";
  const fromCove =
    /^(?:blob:)?https?:\/\/[^\/]*cove\.is/i.test(url) ||
    /^(?:blob:)?https?:\/\/[^\/]*cove\.is/i.test(finalUrl);
  if (!fromCove) return false;
  if (!/\.csv$/i.test(item.filename || "")) return false;

  // Async session check + suggest. Only claim if our content.js set the
  // "expectingPm12Download" flag within the last 60s. This makes PM12 and
  // WO12 cohabit cleanly — each only claims downloads from its own run.
  chrome.storage.session
    .get({ expectingPm12Download: 0 })
    .then(({ expectingPm12Download }) => {
      const fresh =
        expectingPm12Download && Date.now() - expectingPm12Download < 60_000;
      if (!fresh) {
        console.log("[pm12-bg]   skipped: no recent PM12 run (probably another extension's download)");
        suggest();
        return;
      }
      chrome.storage.session.remove("expectingPm12Download");
      chrome.storage.sync.get({ subdir: "cove-pm-csvs" }, (cfg) => {
        const today = new Date();
        const yyyy = today.getFullYear();
        const mm = String(today.getMonth() + 1).padStart(2, "0");
        const dd = String(today.getDate()).padStart(2, "0");
        const subdir = (cfg.subdir || "cove-pm-csvs").replace(/^[\\/]+|[\\/]+$/g, "");
        const newName = `${subdir}/COVE PM12 ${yyyy}-${mm}-${dd} ${hourLabel()}.csv`;
        console.log(`[pm12-bg]   claiming -> ${newName}`);
        suggest({ filename: newName, conflictAction: "overwrite" });
      });
    });
  return true; // async suggest
});

// Format the current local hour as "9am" or "3pm". Appended to the filename
// so multiple snapshots in a day don't overwrite each other.
function hourLabel() {
  const h = new Date().getHours();
  const period = h >= 12 ? "pm" : "am";
  let h12 = h % 12;
  if (h12 === 0) h12 = 12;
  return `${h12}${period}`;
}

// Placeholder for future daily auto-run via chrome.alarms.
// (Not enabled in v0.1 — the user clicks the toolbar button each morning.)
