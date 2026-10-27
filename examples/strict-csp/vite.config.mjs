import { defineConfig } from "vite";
import { CSP } from "./csp.mjs";

// The dev server and `vite preview` send the strict policy, so what works here
// works behind it. A production server sends the same header (apps/website/content/docs/guides/security.mdx).
const headers = { "Content-Security-Policy": CSP };

export default defineConfig({
  server: { headers },
  preview: { headers },
  // The engine worker is a module worker; its chunks must be ES modules too.
  worker: { format: "es" },
  // Vite inlines small assets as data: URLs; keep fonts and package tarballs as files.
  build: { assetsInlineLimit: 0 },
});
