const $ = (id) => document.getElementById(id);

const DEFAULTS = { laborUrl: "", subdir: "cove-labor-csvs" };

chrome.storage.sync.get(DEFAULTS, (cfg) => {
  $("laborUrl").value = cfg.laborUrl;
  $("subdir").value = cfg.subdir;
});

$("save").addEventListener("click", async () => {
  const status = $("status");
  status.className = "";
  status.textContent = "";

  const laborUrl = $("laborUrl").value.trim();
  const subdirRaw = $("subdir").value.trim() || "cove-labor-csvs";

  if (!/^https:\/\/manage\.cove\.is\/networks\//.test(laborUrl)) {
    status.className = "error";
    status.textContent = "URL must start with https://manage.cove.is/networks/";
    return;
  }
  try {
    new URL(laborUrl);
  } catch (e) {
    status.className = "error";
    status.textContent = "Could not parse the URL.";
    return;
  }

  const subdir = subdirRaw.replace(/^[\\/]+|[\\/]+$/g, "");
  if (!subdir) {
    status.className = "error";
    status.textContent = "Subfolder cannot be empty.";
    return;
  }

  await chrome.storage.sync.set({ laborUrl, subdir });
  status.className = "success";
  status.textContent = "Saved.";
});
