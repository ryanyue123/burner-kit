import { attachIcons, observeNewInputs } from "./content/icon";
import { attachCodeIcons, observeNewCodeInputs } from "./content/code-icon";
import { logPageInputs, observePageInputChanges } from "./content/input-debug";

export default defineContentScript({
  matches: ["<all_urls>"],
  runAt: "document_idle",
  main() {
    attachIcons();
    observeNewInputs();
    attachCodeIcons();
    observeNewCodeInputs();
    logPageInputs();
    observePageInputChanges();
  },
});
