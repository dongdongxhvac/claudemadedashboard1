const $ = (id) => document.getElementById(id);
const status = $("status");

function setButtonsDisabled(disabled) {
  $("runAll").disabled = disabled;
  $("runPm").disabled = disabled;
  $("runWo").disabled = disabled;
}

function wire(buttonId, action, missingMsg) {
  const btn = $(buttonId);
  btn.addEventListener("click", () => {
    status.className = "";
    status.textContent = "Opening Cove…";
    setButtonsDisabled(true);

    chrome.runtime.sendMessage({ action }, (resp) => {
      if (!resp || !resp.ok) {
        status.className = "error";
        status.textContent = (resp && resp.error) || missingMsg;
        setButtonsDisabled(false);
        return;
      }
      status.className = "success";
      status.textContent = "Triggered. The CSV will land in your configured folder shortly.";
      setTimeout(() => window.close(), 1200);
    });
  });
}

$("runAll").addEventListener("click", () => {
  status.className = "";
  status.textContent = "Opening PM12 now, WO12 in ~8s…";
  setButtonsDisabled(true);
  chrome.runtime.sendMessage({ action: "runAll" }, (resp) => {
    if (!resp || !resp.ok) {
      status.className = "error";
      status.textContent = (resp && resp.error) || "Failed to start.";
      setButtonsDisabled(false);
      return;
    }
    status.className = "success";
    status.textContent = "Triggered. PM12 + WO12 CSVs will land in your folder.";
    setTimeout(() => window.close(), 1500);
  });
});

wire("runPm", "runPmExport", "Failed to start PM12 export.");
wire("runWo", "runWoExport", "Failed to start WO12 export.");

$("opts").addEventListener("click", (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});
