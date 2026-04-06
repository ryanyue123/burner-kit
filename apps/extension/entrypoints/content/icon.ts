import { showPanel, hidePanel } from "./panel";

const ICON_SIZE = 16;
const SELECTORS = [
  'input[type="email"]',
  'input[autocomplete="email"]',
];
const NAME_REGEX = /email/i;

const processed = new WeakSet<HTMLInputElement>();

function isEmailInput(el: HTMLInputElement): boolean {
  if (el.type === "email") return true;
  if (el.autocomplete === "email") return true;
  if (NAME_REGEX.test(el.name)) return true;
  if (NAME_REGEX.test(el.placeholder)) return true;
  return false;
}

function findEmailInputs(): HTMLInputElement[] {
  const bySelector = Array.from(
    document.querySelectorAll<HTMLInputElement>(SELECTORS.join(",")),
  );
  const byName = Array.from(
    document.querySelectorAll<HTMLInputElement>("input"),
  ).filter((el) => !bySelector.includes(el) && isEmailInput(el));
  return [...bySelector, ...byName];
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
    .bk-icon.visible {
      opacity: 1;
    }
    .bk-icon:hover {
      background: #2563eb;
    }
  `;

  const icon = document.createElement("div");
  icon.className = "bk-icon";
  icon.textContent = "B";
  icon.addEventListener("click", (e) => {
    e.stopPropagation();
    e.preventDefault();
    showPanel(input, host);
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
    setTimeout(() => {
      if (document.activeElement !== input) {
        icon.classList.remove("visible");
        hidePanel();
      }
    }, 200);
  }

  input.addEventListener("focus", show);
  input.addEventListener("mouseenter", show);
  input.addEventListener("blur", hide);
  input.addEventListener("mouseleave", hide);

  document.body.appendChild(host);
  return host;
}

export function attachIcons() {
  for (const input of findEmailInputs()) {
    if (processed.has(input)) continue;
    processed.add(input);
    createIcon(input);
  }
}

let debounceTimer: ReturnType<typeof setTimeout>;

export function observeNewInputs() {
  const observer = new MutationObserver(() => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(attachIcons, 300);
  });
  observer.observe(document.body, { childList: true, subtree: true });
}
