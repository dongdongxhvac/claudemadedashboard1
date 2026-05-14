const $ = (id) => document.getElementById(id);

const DEFAULTS = { bookmarkUrl: "", subdir: "cove-PMs-Labor-csv" };

chrome.storage.sync.get(DEFAULTS, (cfg) => {
  $("bookmarkUrl").value = cfg.bookmarkUrl;
  $("subdir").value = cfg.subdir;
});

$("save").addEventListener("click", async () => {
  const status = $("status");
  status.className = "";
  status.textContent = "";

  const bookmarkUrl = $("bookmarkUrl").value.trim();
  const subdirRaw = $("subdir").value.trim() || "cove-PMs-Labor-csv";

  if (!/^https:\/\/manage\.cove\.is\/networks\//.test(bookmarkUrl)) {
    status.className = "error";
    status.textContent = "URL must start with https://manage.cove.is/networks/";
    return;
  }
  try {
    new URL(bookmarkUrl);
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

  await chrome.storage.sync.set({ bookmarkUrl, subdir });
  status.className = "success";
  status.textContent = "Saved.";
});
