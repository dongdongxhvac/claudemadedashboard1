const $ = (id) => document.getElementById(id);

const DEFAULTS = {
  subdir: "cove-csvs",
  pmBookmarkUrl: "",
  woBookmarkUrl: "",
};

chrome.storage.sync.get(DEFAULTS, (cfg) => {
  for (const k of Object.keys(DEFAULTS)) {
    const el = $(k);
    if (el) el.value = cfg[k];
  }
});

$("save").addEventListener("click", async () => {
  const status = $("status");
  status.className = "";
  status.textContent = "";

  const out = {};
  for (const k of Object.keys(DEFAULTS)) {
    out[k] = ($(k).value || "").trim();
  }

  // URL fields: validate only if filled. Blanks are allowed so the user can
  // configure just the exports they actually use.
  const urlFields = [
    ["pmBookmarkUrl", "PM12 bookmark URL"],
    ["woBookmarkUrl", "WO12 bookmark URL"],
  ];
  for (const [key, label] of urlFields) {
    const v = out[key];
    if (!v) continue;
    if (!/^https:\/\/manage\.cove\.is\/networks\//.test(v)) {
      status.className = "error";
      status.textContent = `${label} must start with https://manage.cove.is/networks/`;
      return;
    }
    try { new URL(v); }
    catch (e) {
      status.className = "error";
      status.textContent = `${label}: could not parse the URL.`;
      return;
    }
  }

  out.subdir = (out.subdir || DEFAULTS.subdir).replace(/^[\\/]+|[\\/]+$/g, "");
  if (!out.subdir) {
    status.className = "error";
    status.textContent = "Subfolder cannot be empty.";
    return;
  }

  await chrome.storage.sync.set(out);
  status.className = "success";
  status.textContent = "Saved.";
});
