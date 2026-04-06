import { defineConfig } from "wxt";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  vite: () => ({
    plugins: [tailwindcss()],
  }),
  runner: {
    binaries: {
      chrome: "/Applications/Helium.app/Contents/MacOS/Helium",
    },
  },
  manifest: {
    name: "burner-kit",
    description: "Disposable credential vault (scaffolding milestone)",
    permissions: ["storage"],
    host_permissions: ["http://localhost:8787/*"],
    // Stable dev extension ID so Better Auth trustedOrigins stays consistent
    // across dev-server restarts. Generate a fresh key with:
    //   ssh-keygen -t rsa -b 2048 -m PEM -f /tmp/wxt-key -N "" && \
    //     openssl rsa -in /tmp/wxt-key -pubout -outform DER | base64 | tr -d '\n'
    // The key is NOT a secret — it's the extension public key — and is safe to commit.
    key: "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAoN/yEYF51QgnbuoOn3D/69dIULcLdY9hgWKh4fH8qtKG8ehU+FhGugIfLi5th92PtCErGyMCRExSn2q8Pt6+pp+CMpbcZY2PtaRHjPWddutXc1gBiHmM28udtyZfWOojbwGKSYMyHBl4E84uZn/7ejYL2VUCIyl4i+jkIsl6L0bKmgUVA1glW71szJCf2/Rr0Jd2KoLUJfrSPWBBi3b10ublj6eZoOmtRZttm1lDV07I4Pgiev4e9DqGcLvMUy2OniFnbbvd71MalNyPfC1i68w8tKR+7vAaWDdusW4bnenb9dPzTenRQ/PnYW9QTO4nA0xjmfyDytgL/J3TJc4HeQIDAQAB",
  },
});
