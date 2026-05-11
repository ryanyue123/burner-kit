import { attachIcons, observeNewInputs } from "./content/icon";
import { attachOtpIcons, observeNewOtpInputs } from "./content/otp-icon";
import { logPageInputs, observePageInputChanges } from "./content/input-debug";

export default defineContentScript({
  matches: ["<all_urls>"],
  runAt: "document_idle",
  main() {
    attachIcons();
    observeNewInputs();
    attachOtpIcons();
    observeNewOtpInputs();
    logPageInputs();
    observePageInputChanges();
  },
});
