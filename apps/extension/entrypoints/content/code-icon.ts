import { showCodePanel, hideCodePanel } from "./code-panel";
import type { CodeTarget } from "./code-target";

const ICON_SIZE = 16;
const NAME_REGEX = /(otp|2fa|verification|confirmation|code|passcode|pin)/i;

const attached = new Map<HTMLInputElement, HTMLDivElement>();
let codeDetectedSent = false;

function getSignalsText(el: HTMLInputElement): string {
  return [el.name, el.id, el.placeholder, el.getAttribute("aria-label"), el.className]
    .filter(Boolean)
    .join(" ");
}

function looksNumeric(el: HTMLInputElement): boolean {
  return el.inputMode === "numeric" || el.type === "tel" || /\[?0-9/.test(el.pattern ?? "");
}

function isSingleCodeInput(el: HTMLInputElement): boolean {
  if (el.autocomplete === "one-time-code") return true;
  const text = getSignalsText(el);
  if (el.inputMode === "numeric" && NAME_REGEX.test(text)) return true;
  if (el.type === "text" && el.maxLength >= 4 && el.maxLength <= 8 && NAME_REGEX.test(text)) {
    return true;
  }
  return false;
}

function findGroupTargets(
  inputs: HTMLInputElement[],
  used: WeakSet<HTMLInputElement>,
): CodeTarget[] {
  const byParent = new Map<Element, HTMLInputElement[]>();
  for (const el of inputs) {
    if (el.maxLength !== 1) continue;
    if (!looksNumeric(el)) continue;
    const parent = el.parentElement;
    if (!parent) continue;
    const list = byParent.get(parent) ?? [];
    list.push(el);
    byParent.set(parent, list);
  }
  const targets: CodeTarget[] = [];
  for (const group of byParent.values()) {
    if (group.length >= 3) {
      for (const el of group) used.add(el);
      targets.push({ inputs: group, anchor: group[group.length - 1]! });
    }
  }
  return targets;
}

function findCodeTargets(): CodeTarget[] {
  const inputs = Array.from(document.querySelectorAll<HTMLInputElement>("input"));
  const used = new WeakSet<HTMLInputElement>();
  const targets = findGroupTargets(inputs, used);
  for (const el of inputs) {
    if (used.has(el)) continue;
    if (isSingleCodeInput(el)) {
      used.add(el);
      targets.push({ inputs: [el], anchor: el });
    }
  }
  return targets;
}

function createIcon(target: CodeTarget): HTMLDivElement {
  const anchor = target.anchor;
  const host = document.createElement("div");
  host.style.position = "absolute";
  host.style.zIndex = "2147483647";
  host.style.pointerEvents = "auto";

  const shadow = host.attachShadow({ mode: "closed" });

  const style = document.createElement("style");
  style.textContent = `
    .bk-icon {
      width: ${ICON_SIZE}px;
      height: ${ICON_SIZE}px;
      background: #3b82f6;
      border-radius: 3px;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      font-size: 10px;
      font-weight: 700;
      color: white;
      font-family: system-ui, sans-serif;
      opacity: 0;
      transition: opacity 150ms;
      user-select: none;
    }
    .bk-icon.visible { opacity: 1; }
    .bk-icon:hover { background: #2563eb; }
  `;

  const icon = document.createElement("div");
  icon.className = "bk-icon";
  icon.textContent = "B";
  let hideTimer: ReturnType<typeof setTimeout>;

  icon.addEventListener("click", (e) => {
    e.stopPropagation();
    e.preventDefault();
    clearTimeout(hideTimer);
    showCodePanel(target, host);
  });

  shadow.appendChild(style);
  shadow.appendChild(icon);

  function position() {
    const rect = anchor.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) {
      host.style.display = "none";
      return;
    }
    host.style.display = "";
    host.style.top = `${window.scrollY + rect.top + (rect.height - ICON_SIZE) / 2}px`;
    const isGroup = target.inputs.length > 1;
    const left = isGroup ? rect.right + 6 : rect.right - ICON_SIZE - 8;
    host.style.left = `${window.scrollX + left}px`;
  }

  function show() {
    position();
    icon.classList.add("visible");
  }

  function hide() {
    hideTimer = setTimeout(() => {
      const active = document.activeElement;
      if (!target.inputs.some((i) => i === active)) {
        icon.classList.remove("visible");
        hideCodePanel();
      }
    }, 200);
  }

  for (const input of target.inputs) {
    input.addEventListener("focus", show);
    input.addEventListener("mouseenter", show);
    input.addEventListener("blur", hide);
  }

  document.body.appendChild(host);
  return host;
}

export function attachCodeIcons() {
  for (const [anchor, host] of attached) {
    if (!document.contains(anchor)) {
      host.remove();
      attached.delete(anchor);
    }
  }
  const targets = findCodeTargets();
  if (!codeDetectedSent && targets.length > 0) {
    codeDetectedSent = true;
    try {
      void chrome.runtime.sendMessage({ type: "CODE_DETECTED" });
    } catch {
      // background not ready / extension reloading — best-effort
    }
  }
  for (const target of targets) {
    if (attached.has(target.anchor)) continue;
    attached.set(target.anchor, createIcon(target));
  }
}

let debounceTimer: ReturnType<typeof setTimeout>;

export function observeNewCodeInputs() {
  const observer = new MutationObserver(() => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(attachCodeIcons, 300);
  });
  observer.observe(document.body, { childList: true, subtree: true });
}
