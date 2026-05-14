// COVE Labor Weekly Export (TEST) — background service worker
//
// Two responsibilities:
//   1. On "runLaborExport" message from the popup: open the labor analytics
//      page in a new tab, with #cove-pm-auto so labor-bridge.js auto-runs.
//   2. On "saveLaborCsv" message from the bridge: write the CSV string to
//      disk via a data: URL and the chrome.downloads API.

const LABOR_PATH = "/work-order-labor-reports";

// chrome.downloads.download often ignores the filename param for data: URLs
// in MV3 service workers, so we enforce the rename via onDeterminingFilename.
//
// The listener is self-contained — it reads the subdir from storage and
// computes the week-start + hour from the current local time. No queue, no
// shared module state, so a previous failed run can't poison the next one.
chrome.downloads.onDeterminingFilename.addListener((item, suggest) => {
  // DIAGNOSTIC: log what Chrome is passing us, so we can confirm the URL
  // filter is doing its job. Remove once the cohabitation issue is resolved.
  console.log(
    `[labor-bg] listener fired. id=${item.id} byExt=${item.byExtensionId} url=${(
      item.url || ""
    ).slice(0, 60)} finalUrl=${(item.finalUrl || "").slice(0, 60)} filename="${
      item.filename
    }"`
  );

  // Only override downloads we triggered ourselves.
  if (item.byExtensionId && item.byExtensionId !== chrome.runtime.id) {
    console.log("[labor-bg]   skipped: other extension owns this download");
    return false;
  }
  // Only override our labor CSV downloads (data:text/csv from this extension).
  if (!/^data:text\/csv/i.test(item.url || "")) {
    console.log("[labor-bg]   skipped: not a data:text/csv URL");
    return false;
  }

  chrome.storage.sync.get({ subdir: "cove-labor-csvs" }, (cfg) => {
    const subdir = (cfg.subdir || "cove-labor-csvs").replace(
      /^[\\/]+|[\\/]+$/g,
      ""
    );
    const filename = `${subdir}/COVE Labor ${isoToday()} ${hourLabel()}.csv`;
    console.log(
      `[labor-bg] onDeterminingFilename forcing rename: ${item.filename} -> ${filename}`
    );
    suggest({ filename, conflictAction: "overwrite" });
  });
  return true; // we will call suggest asynchronously
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || !msg.action) return false;

  if (msg.action === "runLaborExport") {
    chrome.storage.sync.get({ laborUrl: "" }, (cfg) => {
      if (!cfg.laborUrl) {
        sendResponse({ ok: false, error: "Set the Labor URL in Settings first." });
        return;
      }
      let url;
      try {
        url = new URL(cfg.laborUrl);
      } catch (e) {
        sendResponse({ ok: false, error: "Labor URL is not a valid URL." });
        return;
      }
      // Force the path so a misconfigured URL still lands on the right page.
      // We keep the host + the /networks/<id> segment from the user's URL.
      const networkMatch = url.pathname.match(/^\/networks\/([^\/]+)/);
      if (!networkMatch) {
        sendResponse({ ok: false, error: "Couldn't parse network ID from Labor URL." });
        return;
      }
      url.pathname = `/networks/${networkMatch[1]}${LABOR_PATH}`;
      url.hash = "cove-pm-auto";
      // Foreground so layout/visibility are computed reliably (some chart
      // libs throttle hidden tabs).
      chrome.tabs.create({ url: url.toString(), active: true }, (tab) => {
        sendResponse({ ok: true, tabId: tab && tab.id });
      });
    });
    return true; // async sendResponse
  }

  if (msg.action === "saveLaborCsv") {
    handleSaveLaborCsv(msg, sender)
      .then((res) => sendResponse(res))
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true;
  }

  return false;
});

async function handleSaveLaborCsv(msg, sender) {
  const csv = String(msg.csv || "");
  if (!csv) return { ok: false, error: "Empty CSV" };

  const cfg = await chrome.storage.sync.get({ subdir: "cove-labor-csvs" });
  const subdir = (cfg.subdir || "cove-labor-csvs").replace(/^[\\/]+|[\\/]+$/g, "");
  const filename = `${subdir}/COVE Labor ${isoToday()} ${hourLabel()}.csv`;

  // Encode CSV → UTF-8 bytes → base64 → data URL.
  const dataUrl = "data:text/csv;charset=utf-8;base64," + utf8ToBase64(csv);

  console.log(
    `[labor-bg] Requesting download. subdir="${subdir}" filename="${filename}" csvLen=${csv.length}`
  );

  return new Promise((resolve) => {
    chrome.downloads.download(
      {
        url: dataUrl,
        filename,
        conflictAction: "overwrite",
        saveAs: false,
      },
      (downloadId) => {
        if (chrome.runtime.lastError) {
          console.warn(
            "[labor-bg] downloads.download failed:",
            chrome.runtime.lastError.message
          );
          resolve({ ok: false, error: chrome.runtime.lastError.message });
          return;
        }
        console.log(
          `[labor-bg] downloads.download accepted. downloadId=${downloadId}`
        );
        // Look up the actual landing filename Chrome chose, so we can report
        // it back to the popup and detect filename mangling.
        chrome.downloads.search({ id: downloadId }, (results) => {
          const item = results && results[0];
          if (item) {
            console.log(
              `[labor-bg] Final landing path: ${item.filename} (byExtensionId=${item.byExtensionId})`
            );
          }
          // Try to close the labor tab now that we have the data.
          if (sender && sender.tab && sender.tab.id) {
            chrome.tabs.remove(sender.tab.id).catch(() => {});
          }
          resolve({
            ok: true,
            downloadId,
            requestedFilename: filename,
            actualFilename: item && item.filename,
          });
        });
      }
    );
  });
}

function isoToday() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

// Format the current local hour as "9am" or "3pm". Appended to the filename
// so multiple snapshots in a day don't overwrite each other.
function hourLabel() {
  const h = new Date().getHours();
  const period = h >= 12 ? "pm" : "am";
  let h12 = h % 12;
  if (h12 === 0) h12 = 12;
  return `${h12}${period}`;
}

function utf8ToBase64(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}
