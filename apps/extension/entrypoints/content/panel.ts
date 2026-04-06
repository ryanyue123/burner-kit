import type { EmailAccount, ApiResult } from "@/lib/api-client";

let panelHost: HTMLDivElement | null = null;
let __currentInput: HTMLInputElement | null = null;

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

function renderPanel(shadow: ShadowRoot, input: HTMLInputElement, accounts: EmailAccount[]) {
  shadow.innerHTML = "";

  const style = document.createElement("style");
  style.textContent = `
    .bk-panel {
      width: 320px;
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
    .bk-generate {
      width: 100%;
      padding: 8px;
      background: #3b82f6;
      color: white;
      border: none;
      border-radius: 6px;
      font-size: 12px;
      font-weight: 500;
      cursor: pointer;
      margin-bottom: 8px;
    }
    .bk-generate:hover { background: #2563eb; }
    .bk-generate:disabled { opacity: 0.6; cursor: wait; }
    .bk-label { font-size: 9px; text-transform: uppercase; letter-spacing: 0.5px; color: #6b6b76; margin-bottom: 4px; }
    .bk-item {
      padding: 6px 8px;
      background: #18181b;
      border: 1px solid #232329;
      border-radius: 6px;
      margin-bottom: 4px;
      cursor: pointer;
      font-size: 11px;
      font-family: monospace;
      color: #ededef;
    }
    .bk-item:hover { border-color: #3b82f6; }
  `;
  shadow.appendChild(style);

  const panel = document.createElement("div");
  panel.className = "bk-panel";

  // Header
  const header = document.createElement("div");
  header.className = "bk-header";
  header.innerHTML = `<div class="bk-logo">B</div><span class="bk-title">Burner Kit</span>`;
  panel.appendChild(header);

  // Generate button
  const btn = document.createElement("button");
  btn.className = "bk-generate";
  btn.textContent = "Generate new burner email";
  btn.addEventListener("click", async () => {
    btn.disabled = true;
    btn.textContent = "Generating...";
    const result: ApiResult<EmailAccount> = await chrome.runtime.sendMessage({
      type: "GENERATE_EMAIL",
    });
    if (result.ok) {
      fillInput(input, result.data.email);
      hidePanel();
    } else {
      btn.textContent = "Failed — try again";
      btn.disabled = false;
    }
  });
  panel.appendChild(btn);

  // Recent accounts
  if (accounts.length > 0) {
    const label = document.createElement("div");
    label.className = "bk-label";
    label.textContent = "Recent";
    panel.appendChild(label);

    for (const account of accounts.slice(0, 5)) {
      const item = document.createElement("div");
      item.className = "bk-item";
      item.textContent = account.email;
      item.addEventListener("click", () => {
        fillInput(input, account.email);
        hidePanel();
      });
      panel.appendChild(item);
    }
  }

  shadow.appendChild(panel);
}

export async function showPanel(input: HTMLInputElement, iconHost: HTMLDivElement) {
  hidePanel();
  _currentInput = input;

  panelHost = document.createElement("div");
  panelHost.style.position = "absolute";
  panelHost.style.zIndex = "2147483647";

  const rect = input.getBoundingClientRect();
  panelHost.style.top = `${window.scrollY + rect.bottom + 4}px`;
  panelHost.style.left = `${window.scrollX + rect.left}px`;

  const shadow = panelHost.attachShadow({ mode: "closed" });

  // Fetch accounts
  const result: ApiResult<EmailAccount[]> = await chrome.runtime.sendMessage({
    type: "GET_EMAIL_ACCOUNTS",
  });
  const accounts = result.ok ? result.data : [];

  renderPanel(shadow, input, accounts);

  document.body.appendChild(panelHost);

  // Close on outside click
  function onClickOutside(e: MouseEvent) {
    if (panelHost && !panelHost.contains(e.target as Node) && e.target !== iconHost) {
      hidePanel();
      document.removeEventListener("click", onClickOutside);
    }
  }
  setTimeout(() => document.addEventListener("click", onClickOutside), 0);

  // Close on Escape
  function onKeydown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      hidePanel();
      document.removeEventListener("keydown", onKeydown);
    }
  }
  document.addEventListener("keydown", onKeydown);
}

export function hidePanel() {
  if (panelHost) {
    panelHost.remove();
    panelHost = null;
  }
  _currentInput = null;
}
