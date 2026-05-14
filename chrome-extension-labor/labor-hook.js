// COVE Labor — page-world hook installed at document_start
//
// Apollo / Cove fetches labor data from https://api.cove.is/gql via fetch (and
// possibly XHR). We need to capture that response so the bridge script can
// build the CSV. Hooking at document_start in the MAIN world means we install
// our wrapper BEFORE Apollo grabs its reference to window.fetch.
//
// We dispatch a CustomEvent on window so the ISOLATED-world bridge script can
// receive the payload. CustomEvent.detail crosses worlds via DOM, so the JSON
// string we send is consumable from the bridge.
//
// We also expose window.__coveLaborSetDate(input, value) so the bridge can ask
// us to set a React-controlled input — that requires touching __reactProps,
// which is only accessible from the MAIN world.

(() => {
  const captured = (window.__coveLaborCaptured = []);

  const recordResponse = (url, body, via) => {
    captured.push({ url, body, ts: Date.now(), via });
    if (captured.length > 30) captured.shift();
    try {
      window.dispatchEvent(
        new CustomEvent("cove-labor-gql-captured", {
          detail: { url, body, via, ts: Date.now() },
        })
      );
    } catch (e) {
      // Some payloads might not survive structured cloning — fall back to
      // a string detail so the event still reaches the bridge.
      try {
        window.dispatchEvent(
          new CustomEvent("cove-labor-gql-captured", {
            detail: { url, body: String(body), via, ts: Date.now() },
          })
        );
      } catch (_) {}
    }
  };

  // ---- fetch hook ----
  const origFetch = window.fetch;
  window.fetch = async function (input, init) {
    const url = typeof input === "string" ? input : input && input.url;
    const resp = await origFetch.apply(this, arguments);
    try {
      if (url && /api\.cove\.is\/gql/i.test(url) && resp && resp.ok) {
        const clone = resp.clone();
        const text = await clone.text();
        recordResponse(url, text, "fetch");
      }
    } catch (e) {
      // ignore
    }
    return resp;
  };

  // ---- XHR hook ----
  const xhrOpen = XMLHttpRequest.prototype.open;
  const xhrSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url) {
    this.__coveUrl = url;
    return xhrOpen.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function (body) {
    if (this.__coveUrl && /api\.cove\.is\/gql/i.test(this.__coveUrl)) {
      const xhrRef = this;
      xhrRef.addEventListener("load", function () {
        // Outer try/catch so anything throwing here is contained.
        try {
          if (xhrRef.status < 200 || xhrRef.status >= 300) return;
          // NEVER read xhrRef.responseText — it throws when responseType is
          // "blob"/"json"/"arraybuffer". Always use xhrRef.response.
          const r = xhrRef.response;
          if (r == null) return;
          if (typeof r === "string") {
            recordResponse(xhrRef.__coveUrl, r, "xhr");
          } else if (typeof Blob !== "undefined" && r instanceof Blob) {
            r.text()
              .then((t) => recordResponse(xhrRef.__coveUrl, t, "xhr"))
              .catch(() => {});
          } else if (typeof r === "object") {
            try {
              recordResponse(xhrRef.__coveUrl, JSON.stringify(r), "xhr");
            } catch (_) {}
          }
        } catch (e) {
          try {
            console.warn("[cove-labor-hook] xhr load handler swallowed:", e);
          } catch (_) {}
        }
      });
    }
    return xhrSend.apply(this, arguments);
  };

  // ---- React-input setter (called via window event from the bridge) ----
  // The bridge dispatches CustomEvent('cove-labor-set-date', { detail: {which: 0|1, value: 'May 4, 2026'} })
  // and we look up the date input and invoke its React onChange.
  window.addEventListener("cove-labor-set-date", (e) => {
    try {
      const { which, value } = e.detail || {};
      const inputs = document.querySelectorAll('input[placeholder="Date"]');
      const input = inputs[which];
      if (!input) return;
      // 1) Use the React-internal value setter so React notices the change.
      const proto = Object.getPrototypeOf(input);
      const setter = Object.getOwnPropertyDescriptor(proto, "value") && Object.getOwnPropertyDescriptor(proto, "value").set;
      if (setter) setter.call(input, value);
      else input.value = value;
      // 2) Dispatch input + change so most React form libs pick it up.
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
      // 3) Also call the onChange prop directly as a belt-and-suspenders.
      for (const k of Object.keys(input)) {
        if (k.startsWith("__reactProps") && input[k] && typeof input[k].onChange === "function") {
          try {
            input[k].onChange({
              target: { value },
              currentTarget: { value },
              persist: () => {},
            });
          } catch (_) {}
        }
      }
      // 4) Blur to commit the value in many date-picker components.
      input.dispatchEvent(new Event("blur", { bubbles: true }));
    } catch (e) {
      console.warn("[cove-labor-hook] set-date failed:", e);
    }
  });
})();
