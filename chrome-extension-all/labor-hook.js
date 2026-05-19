// Labor — page-world hook installed at document_start.
//
// Hooks fetch + XHR before Apollo grabs its references, so we can capture the
// GraphQL response that drives the labor chart. Dispatches a CustomEvent that
// the ISOLATED-world bridge listens for.
//
// Also exposes a "cove-labor-set-date" event the bridge fires to set a
// React-controlled date input — that requires touching __reactProps, which is
// only reachable from MAIN world.

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
      try {
        window.dispatchEvent(
          new CustomEvent("cove-labor-gql-captured", {
            detail: { url, body: String(body), via, ts: Date.now() },
          })
        );
      } catch (_) {}
    }
  };

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
    } catch (e) {}
    return resp;
  };

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
        try {
          if (xhrRef.status < 200 || xhrRef.status >= 300) return;
          // NEVER read xhrRef.responseText — it throws when responseType is
          // "blob"/"json"/"arraybuffer". Always use xhrRef.response.
          const r = xhrRef.response;
          if (r == null) return;
          if (typeof r === "string") {
            recordResponse(xhrRef.__coveUrl, r, "xhr");
          } else if (typeof Blob !== "undefined" && r instanceof Blob) {
            r.text().then((t) => recordResponse(xhrRef.__coveUrl, t, "xhr")).catch(() => {});
          } else if (typeof r === "object") {
            try { recordResponse(xhrRef.__coveUrl, JSON.stringify(r), "xhr"); }
            catch (_) {}
          }
        } catch (e) {
          try { console.warn("[cove-exports/labor-hook] xhr swallow:", e); }
          catch (_) {}
        }
      });
    }
    return xhrSend.apply(this, arguments);
  };

  // Bridge dispatches { which: 0|1, value: "May 18, 2026" } to set the START
  // (0) or END (1) date input. We touch the React internal value setter so
  // React notices, then fire input+change+blur. Don't try to "verify" the
  // value afterwards — many React date components re-render the displayed
  // value from their own internal state, so the DOM .value can briefly differ
  // from what we wrote even when React saw the update correctly.
  window.addEventListener("cove-labor-set-date", (e) => {
    try {
      const { which, value } = e.detail || {};
      const inputs = document.querySelectorAll('input[placeholder="Date"]');
      const input = inputs[which];
      if (!input) return;
      const proto = Object.getPrototypeOf(input);
      const setter = Object.getOwnPropertyDescriptor(proto, "value") && Object.getOwnPropertyDescriptor(proto, "value").set;
      if (setter) setter.call(input, value);
      else input.value = value;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
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
      input.dispatchEvent(new Event("blur", { bubbles: true }));
    } catch (e) {
      console.warn("[cove-exports/labor-hook] set-date failed:", e);
    }
  });
})();
