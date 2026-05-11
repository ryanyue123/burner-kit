type InputSignals = {
  index: number;
  autocomplete: string;
  type: string;
  name: string;
  id: string;
  inputmode: string;
  maxlength: number;
  placeholder: string;
  label: string | null;
  aria: string | null;
  outerHTML: string;
};

function captureInput(el: HTMLInputElement, index: number): InputSignals {
  return {
    index,
    autocomplete: el.autocomplete,
    type: el.type,
    name: el.name,
    id: el.id,
    inputmode: el.inputMode,
    maxlength: el.maxLength,
    placeholder: el.placeholder,
    label: el.labels?.[0]?.textContent?.trim() ?? null,
    aria: el.getAttribute("aria-label"),
    outerHTML: el.outerHTML.slice(0, 240),
  };
}

let lastSignature = "";

export function logPageInputs() {
  const inputs = Array.from(document.querySelectorAll<HTMLInputElement>("input"));
  const captured = inputs.map((el, i) => captureInput(el, i));
  const signature = location.href + "|" + JSON.stringify(captured);
  if (signature === lastSignature) return;
  lastSignature = signature;
  const report = {
    url: location.href,
    title: document.title,
    inputCount: inputs.length,
    inputs: captured,
  };
  console.log(`[burner-kit] input scan\n${JSON.stringify(report, null, 2)}`);
}

export function observePageInputChanges() {
  let mutationTimer: ReturnType<typeof setTimeout>;
  const observer = new MutationObserver(() => {
    clearTimeout(mutationTimer);
    mutationTimer = setTimeout(logPageInputs, 300);
  });
  observer.observe(document.body, { childList: true, subtree: true });

  // SPA navigations (pushState/replaceState don't fire popstate)
  const fireUrlChange = () => setTimeout(logPageInputs, 300);
  for (const method of ["pushState", "replaceState"] as const) {
    const original = history[method];
    history[method] = function (...args: Parameters<typeof original>) {
      const result = original.apply(this, args);
      fireUrlChange();
      return result;
    };
  }
  window.addEventListener("popstate", fireUrlChange);
  window.addEventListener("hashchange", fireUrlChange);
}
