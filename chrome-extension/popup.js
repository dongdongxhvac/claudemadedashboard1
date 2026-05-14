const $ = (id) => document.getElementById(id);

const runBtn = $("run");
const status = $("status");

runBtn.addEventListener("click", async () => {
  status.className = "";
  status.textContent = "Opening Cove…";
  runBtn.disabled = true;

  const cfg = await chrome.storage.sync.get({ bookmarkUrl: "" });
  if (!cfg.bookmarkUrl) {
    status.className = "error";
    status.textContent = "Set the bookmark URL in Settings first.";
    runBtn.disabled = false;
    return;
  }

  chrome.runtime.sendMessage({ action: "runDailyExport" }, (resp) => {
    if (!resp || !resp.ok) {
      status.className = "error";
      status.textContent = (resp && resp.error) || "Failed to start export.";
      runBtn.disabled = false;
      return;
    }
    status.className = "success";
    status.textContent = "Triggered. The CSV will land in your configured folder shortly.";
    setTimeout(() => window.close(), 1200);
  });
});

$("opts").addEventListener("click", (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});
