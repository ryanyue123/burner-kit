import { showOtpPanel, hidePanel } from "./otp-panel";

const ICON_SIZE = 16;
const NAME_REGEX = /(otp|2fa|verification|confirmation|code)/i;

const processed = new WeakSet<HTMLInputElement>();

function isCodeInput(el: HTMLInputElement): boolean {
  if (el.autocomplete === "one-time-code") return true;

  const labelText =
    (el.name ?? "") + " " + (el.placeholder ?? "") + " " + (el.getAttribute("aria-label") ?? "");

  if (el.inputMode === "numeric" && NAME_REGEX.test(labelText)) return true;

  if (el.type === "text" && el.maxLength >= 4 && el.maxLength <= 8 && NAME_REGEX.test(labelText)) {
    return true;
  }

  return false;
}

function findCodeInputs(): HTMLInputElement[] {
  return Array.from(document.querySelectorAll<HTMLInputElement>("input")).filter(isCodeInput);
}

function createIcon(input: HTMLInputElement): HTMLDivElement {
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
    showOtpPanel(input, host);
  });

  shadow.appendChild(style);
  shadow.appendChild(icon);

  function position() {
    const rect = input.getBoundingClientRect();
    host.style.top = `${window.scrollY + rect.top + (rect.height - ICON_SIZE) / 2}px`;
    host.style.left = `${window.scrollX + rect.right - ICON_SIZE - 8}px`;
  }

  function show() {
    position();
    icon.classList.add("visible");
  }

  function hide() {
    hideTimer = setTimeout(() => {
      if (document.activeElement !== input) {
        icon.classList.remove("visible");
        hidePanel();
      }
    }, 200);
  }

  input.addEventListener("focus", show);
  input.addEventListener("mouseenter", show);
  input.addEventListener("blur", hide);

  document.body.appendChild(host);
  return host;
}

export function attachOtpIcons() {
  for (const input of findCodeInputs()) {
    if (processed.has(input)) continue;
    processed.add(input);
    createIcon(input);
  }
}

let debounceTimer: ReturnType<typeof setTimeout>;

export function observeNewOtpInputs() {
  const observer = new MutationObserver(() => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(attachOtpIcons, 300);
  });
  observer.observe(document.body, { childList: true, subtree: true });
}
