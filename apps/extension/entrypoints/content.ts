import { attachIcons, observeNewInputs } from "./content/icon";

export default defineContentScript({
  matches: ["<all_urls>"],
  runAt: "document_idle",
  main() {
    attachIcons();
    observeNewInputs();
  },
});
