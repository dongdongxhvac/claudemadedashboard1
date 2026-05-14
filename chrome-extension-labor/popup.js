const $ = (id) => document.getElementById(id);

const runBtn = $("run");
const status = $("status");

runBtn.addEventListener("click", async () => {
  status.className = "";
  status.textContent = "Opening Cove…";
  runBtn.disabled = true;

  const cfg = await chrome.storage.sync.get({ laborUrl: "" });
  if (!cfg.laborUrl) {
    status.className = "error";
    status.textContent = "Set the Labor URL in Settings first.";
    runBtn.disabled = false;
    return;
  }

  chrome.runtime.sendMessage({ action: "runLaborExport" }, (resp) => {
    if (!resp || !resp.ok) {
      status.className = "error";
      status.textContent = (resp && resp.error) || "Failed to start.";
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
