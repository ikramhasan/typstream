// Smoke test (#29, apps/website/content/docs/guides/security.mdx): builds the page, serves it with the strict
// policy in csp.mjs, and opens it in Chromium, Firefox and WebKit (BROWSERS=…
// runs some). The worksheet must finish in both targets, with its layout, math,
// lazily loaded font and package diagram, and a mind map island must mount (React,
// React Flow), without a single CSP violation or console error. A last check proves the policy is enforced at all: an inline
// style the page adds itself is refused.

import { spawn } from "node:child_process";
import { chromium, firefox, webkit } from "playwright";
import { CSP } from "./csp.mjs";

const PORT = 4318;
const BROWSERS = { chromium, firefox, webkit };
const names = (process.env.BROWSERS ?? "chromium,firefox,webkit").split(",");

const run = (args) =>
  new Promise((resolve, reject) => {
    const child = spawn("pnpm", ["exec", "vite", ...args], { stdio: "inherit" });
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`vite ${args[0]} exited with ${code}`))));
  });

await run(["build", "--logLevel", "warn"]);
const server = spawn("pnpm", ["exec", "vite", "preview", "--port", String(PORT), "--strictPort"], {
  stdio: ["ignore", "pipe", "inherit"],
});
await new Promise((resolve) => server.stdout.on("data", (d) => String(d).includes(String(PORT)) && resolve()));

/** Records violations the page sees, before any of its scripts run. */
const recordViolations = () => {
  window.__violations = [];
  document.addEventListener("securitypolicyviolation", (e) =>
    window.__violations.push(
      `${e.effectiveDirective} blocked ${e.blockedURI || "inline"} (${e.sourceFile}:${e.lineNumber})`,
    ),
  );
};

const failures = [];
try {
  for (const name of names) {
    const browser = await BROWSERS[name].launch();
    try {
      const page = await browser.newPage();
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
      page.on("worker", (w) => w.on?.("console", (m) => m.type() === "error" && errors.push(`worker: ${m.text()}`)));
      await page.addInitScript(recordViolations);
      const response = await page.goto(`http://localhost:${PORT}/`);
      if (response?.headers()["content-security-policy"] !== CSP)
        throw new Error("the page wasn't served with the policy");

      try {
        for (const target of ["html", "paged"]) {
          await page.waitForSelector(`#${target}[data-status="done"]`, { timeout: 120_000 });
        }
      } catch (e) {
        // Say why it never finished: what the page reported is the cause.
        const violations = await page.evaluate(() => window.__violations);
        const why = [...violations.map((v) => `CSP: ${v}`), ...errors.map((e) => `console: ${e}`)];
        failures.push(`${name}:\n  ${[e.message.split("\n")[0], ...why].join("\n  ")}`);
        continue;
      }
      // Lazy fonts and packages arrive after the first compile, which then runs again: let it settle.
      await page.waitForTimeout(2000);
      const report = await page.evaluate(() => {
        const html = document.getElementById("html");
        const paged = document.getElementById("paged");
        const grid = html.querySelector("[style*=grid-template-columns]");
        // A page is painted on a canvas, or an SVG in a shadow root (what the engine can't draw).
        const drawn = [...paged.querySelectorAll(".typstream-page")].filter(
          (p) => p.querySelector(":scope > canvas")?.width > 0 || p.firstElementChild?.shadowRoot?.querySelector("svg"),
        );
        return {
          errors: [html.dataset.error, paged.dataset.error].filter(Boolean),
          htmlText: html.textContent,
          math: html.querySelectorAll("math").length,
          // html-compat's inline styles applied: the grid has two columns.
          gridColumns: grid ? getComputedStyle(grid).gridTemplateColumns.split(" ").length : 0,
          // The CeTZ canvas (a package from this origin) as a drawing.
          diagram: html.querySelectorAll(".ts-frame svg, svg").length,
          pages: drawn.length,
          pagedText: paged.querySelector(".typstream-text-layer")?.textContent ?? "",
          violations: window.__violations,
        };
      });
      const problems = [];
      if (report.errors.length) problems.push(`engine: ${report.errors.join(", ")}`);
      if (!report.htmlText.includes("Coordinates and angles")) problems.push("HTML: the worksheet isn't there");
      if (report.math < 2) problems.push(`HTML: ${report.math} equations`);
      if (report.gridColumns !== 2) problems.push(`HTML: the grid has ${report.gridColumns} columns`);
      if (report.diagram < 1) problems.push("HTML: no diagram");
      if (report.pages < 1 || !report.pagedText.includes("Coordinates")) problems.push("paged: no page with text");
      problems.push(...report.violations.map((v) => `CSP: ${v}`), ...errors.splice(0).map((e) => `console: ${e}`));

      // The island page (#28): React and React Flow under the same policy.
      await page.goto(`http://localhost:${PORT}/island.html`);
      try {
        await page.waitForSelector('#island[data-status="done"]', { timeout: 120_000 });
        // The centre, three branches, two leaves of the open ones; "Precipitation" closed.
        await page.waitForFunction(() => document.querySelectorAll("#island .react-flow__node").length === 7, null, {
          timeout: 60_000,
        });
        const island = await page.evaluate(() => ({
          edges: document.querySelectorAll("#island .react-flow__edge").length,
          fallbackHidden: document.querySelector("#island typstream-island > svg")?.getAttribute("aria-hidden"),
          violations: window.__violations,
        }));
        if (island.edges !== 6) problems.push(`island: ${island.edges} edges`);
        if (island.fallbackHidden !== "true") problems.push("island: the drawing under the map isn't hidden from AT");
        problems.push(...island.violations.map((v) => `island CSP: ${v}`));
      } catch (e) {
        problems.push(`island: ${e.message.split("\n")[0]}`);
      }
      problems.push(...errors.splice(0).map((e) => `console: ${e}`));

      // The policy holds: an inline style attribute is refused, and so is a
      // string assigned to innerHTML where the browser has Trusted Types.
      const probe = await page.evaluate(() => {
        const box = document.createElement("span");
        box.setAttribute("style", "color: rgb(255, 0, 0)");
        document.body.append(box);
        let markup = true;
        try {
          box.innerHTML = "probe";
        } catch {
          markup = false;
        }
        return {
          style: getComputedStyle(box).color === "rgb(255, 0, 0)",
          trustedTypes: "trustedTypes" in window,
          markup,
        };
      });
      if (probe.style) problems.push("the policy isn't enforced: an inline style applied");
      if (probe.trustedTypes && probe.markup) problems.push("Trusted Types aren't enforced: innerHTML took a string");
      else if (!probe.trustedTypes) console.log(`${name} has no Trusted Types: the directive is ignored there`);

      if (problems.length) failures.push(`${name}:\n  ${problems.join("\n  ")}`);
      else console.log(`ok: ${name}, both targets and the island finished under the policy with no violations`);
      if (process.argv.includes("--screenshot")) await page.screenshot({ path: `smoke-${name}.png`, fullPage: true });
    } finally {
      await browser.close();
    }
  }
} finally {
  server.kill();
}
if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}
