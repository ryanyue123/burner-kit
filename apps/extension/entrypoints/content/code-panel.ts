import type { ApiResult } from "@/lib/api-client";
import type { CodeTarget } from "./code-target";

let panelHost: HTMLDivElement | null = null;

const NATIVE_VALUE_SETTER = Object.getOwnPropertyDescriptor(
  HTMLInputElement.prototype,
  "value",
)?.set;

function fillInput(input: HTMLInputElement, value: string) {
  input.focus();
  input.dispatchEvent(
    new KeyboardEvent("keydown", { key: value || "Unidentified", bubbles: true }),
  );
  if (NATIVE_VALUE_SETTER) {
    NATIVE_VALUE_SETTER.call(input, value);
  } else {
    input.value = value;
  }
  input.dispatchEvent(
    new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }),
  );
  input.dispatchEvent(new KeyboardEvent("keyup", { key: value || "Unidentified", bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

function fillTarget(target: CodeTarget, code: string) {
  if (target.inputs.length === 1) {
    const input = target.inputs[0]!;
    fillInput(input, code);
    input.blur();
    return;
  }
  for (let i = 0; i < target.inputs.length; i++) {
    fillInput(target.inputs[i]!, code[i] ?? "");
  }
  const lastIdx = Math.min(code.length, target.inputs.length) - 1;
  if (lastIdx >= 0) {
    const lastInput = target.inputs[lastIdx]!;
    lastInput.focus();
    lastInput.blur();
  }
}

type LatestCode = { code: string; fromAddress: string; receivedAt: number };

function renderPanel(shadow: ShadowRoot, target: CodeTarget, latest: LatestCode | null) {
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
    fillBtn.textContent = "Use code";
    fillBtn.addEventListener("click", () => {
      fillTarget(target, latest.code);
      hideCodePanel();
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

export async function showCodePanel(target: CodeTarget, iconHost: HTMLDivElement) {
  hideCodePanel();

  if (!document.contains(target.anchor)) return;

  panelHost = document.createElement("div");
  panelHost.style.position = "absolute";
  panelHost.style.zIndex = "2147483647";

  const firstRect = target.inputs[0]!.getBoundingClientRect();
  const lastRect = target.anchor.getBoundingClientRect();
  panelHost.style.top = `${window.scrollY + Math.max(firstRect.bottom, lastRect.bottom) + 4}px`;
  panelHost.style.left = `${window.scrollX + firstRect.left}px`;

  const shadow = panelHost.attachShadow({ mode: "closed" });

  const result: ApiResult<LatestCode> = await chrome.runtime.sendMessage({
    type: "GET_LATEST_CODE",
  });
  const latest = result.ok ? result.data : null;

  renderPanel(shadow, target, latest);

  document.body.appendChild(panelHost);

  function onClickOutside(e: MouseEvent) {
    if (panelHost && !panelHost.contains(e.target as Node) && e.target !== iconHost) {
      hideCodePanel();
      document.removeEventListener("click", onClickOutside);
      document.removeEventListener("keydown", onKeydown);
    }
  }
  setTimeout(() => document.addEventListener("click", onClickOutside), 0);

  function onKeydown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      hideCodePanel();
      document.removeEventListener("keydown", onKeydown);
      document.removeEventListener("click", onClickOutside);
    }
  }
  document.addEventListener("keydown", onKeydown);
}

export function hideCodePanel() {
  if (panelHost) {
    panelHost.remove();
    panelHost = null;
  }
}
