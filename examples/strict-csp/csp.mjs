// The policy this example is served with, and apps/website/content/docs/guides/security.mdx recommends:
// everything from the page's own origin, no inline script or style, no eval.
// WebAssembly needs 'wasm-unsafe-eval' (it compiles code, but can't run script).
export const CSP = [
  "default-src 'none'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "worker-src 'self'",
  "connect-src 'self'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "style-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join("; ");
