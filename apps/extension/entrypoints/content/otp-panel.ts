import type { ApiResult } from "@/lib/api-client";

let panelHost: HTMLDivElement | null = null;

function fillInput(input: HTMLInputElement, value: string) {
  const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  if (nativeSetter) {
    nativeSetter.call(input, value);
  } else {
    input.value = value;
  }
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

type LatestCode = { code: string; fromAddress: string; receivedAt: number };

function renderPanel(shadow: ShadowRoot, input: HTMLInputElement, latest: LatestCode | null) {
  shadow.innerHTML = "";

  const style = document.createElement("style");
  style.textContent = `
    .bk-panel {
      width: 280px;
      background: #111113;
      border: 1px solid #232329;
      border-radius: 8px;
      padding: 12px;
      font-family: system-ui, sans-serif;
      color: #ededef;
      box-shadow: 0 8px 24px rgba(0,0,0,0.4);
    }
    .bk-panel * { box-sizing: border-box; }
    .bk-header {
      display: flex;
      align-items: center;
      gap: 6px;
      margin-bottom: 10px;
    }
    .bk-logo {
      width: 18px; height: 18px;
      background: #3b82f6;
      border-radius: 4px;
      display: flex; align-items: center; justify-content: center;
      font-size: 10px; font-weight: 700; color: white;
    }
    .bk-title { font-size: 12px; font-weight: 600; }
    .bk-code-row {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px;
      background: #18181b;
      border: 1px solid #232329;
      border-radius: 6px;
    }
    .bk-code {
      font-family: monospace;
      font-size: 16px;
      font-weight: 600;
      letter-spacing: 1px;
      flex: 1;
      color: #ededef;
    }
    .bk-fill {
      padding: 6px 10px;
      background: #3b82f6;
      color: white;
      border: none;
      border-radius: 4px;
      font-size: 11px;
      font-weight: 500;
      cursor: pointer;
    }
    .bk-fill:hover { background: #2563eb; }
    .bk-source { font-size: 10px; color: #6b6b76; margin-top: 6px; }
    .bk-empty { font-size: 11px; color: #6b6b76; padding: 4px 0; }
  `;
  shadow.appendChild(style);

  const panel = document.createElement("div");
  panel.className = "bk-panel";

  const header = document.createElement("div");
  header.className = "bk-header";
  header.innerHTML = `<div class="bk-logo">B</div><span class="bk-title">Burner Kit</span>`;
  panel.appendChild(header);

  if (latest) {
    const row = document.createElement("div");
    row.className = "bk-code-row";

    const codeSpan = document.createElement("span");
    codeSpan.className = "bk-code";
    codeSpan.textContent = latest.code;
    row.appendChild(codeSpan);

    const fillBtn = document.createElement("button");
    fillBtn.className = "bk-fill";
    fillBtn.textContent = "Fill";
    fillBtn.addEventListener("click", () => {
      fillInput(input, latest.code);
      hidePanel();
    });
    row.appendChild(fillBtn);

    panel.appendChild(row);

    const source = document.createElement("div");
    source.className = "bk-source";
    source.textContent = `from ${latest.fromAddress}`;
    panel.appendChild(source);
  } else {
    const empty = document.createElement("div");
    empty.className = "bk-empty";
    empty.textContent = "No recent code found.";
    panel.appendChild(empty);
  }

  shadow.appendChild(panel);
}

export async function showOtpPanel(input: HTMLInputElement, iconHost: HTMLDivElement) {
  hidePanel();

  panelHost = document.createElement("div");
  panelHost.style.position = "absolute";
  panelHost.style.zIndex = "2147483647";

  const rect = input.getBoundingClientRect();
  panelHost.style.top = `${window.scrollY + rect.bottom + 4}px`;
  panelHost.style.left = `${window.scrollX + rect.left}px`;

  const shadow = panelHost.attachShadow({ mode: "closed" });

  const result: ApiResult<LatestCode> = await chrome.runtime.sendMessage({
    type: "GET_LATEST_CODE",
  });
  const latest = result.ok ? result.data : null;

  renderPanel(shadow, input, latest);

  document.body.appendChild(panelHost);

  function onClickOutside(e: MouseEvent) {
    if (panelHost && !panelHost.contains(e.target as Node) && e.target !== iconHost) {
      hidePanel();
      document.removeEventListener("click", onClickOutside);
      document.removeEventListener("keydown", onKeydown);
    }
  }
  setTimeout(() => document.addEventListener("click", onClickOutside), 0);

  function onKeydown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      hidePanel();
      document.removeEventListener("keydown", onKeydown);
      document.removeEventListener("click", onClickOutside);
    }
  }
  document.addEventListener("keydown", onKeydown);
}

export function hidePanel() {
  if (panelHost) {
    panelHost.remove();
    panelHost = null;
  }
}
