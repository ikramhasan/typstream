// Smoke test: builds the app, serves dist/ with `vite preview`, and opens it in Chromium, Firefox and WebKit
// (BROWSERS=… runs some). The replayed worksheet must finish as HTML, then as pages after the target switch, and the
// PDF download must be a PDF, with no console error or uncaught exception on the way.

import { spawn } from "node:child_process";
import { chromium, firefox, webkit } from "playwright";

const PORT = 4320;
const BROWSERS = { chromium, firefox, webkit };
const names = (process.env.BROWSERS ?? "chromium,firefox,webkit").split(",");
const TEXT = "That is the end of the worksheet";

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

/** Waits until the replay is over and the document's final compile is done. */
const finished = (page) =>
  page.waitForSelector('.status[data-streaming="false"][data-status="done"]', { timeout: 120_000 });

const failures = [];
try {
  for (const name of names) {
    const browser = await BROWSERS[name].launch();
    const problems = [];
    try {
      const page = await browser.newPage({ acceptDownloads: true });
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
      page.on("worker", (w) => w.on?.("console", (m) => m.type() === "error" && errors.push(`worker: ${m.text()}`)));
      await page.goto(`http://localhost:${PORT}/`);

      try {
        await finished(page);
        const html = await page.evaluate(() => {
          const root = document.querySelector(".typstream");
          return {
            text: root?.textContent ?? "",
            heading: root?.querySelector("h2, h1")?.textContent ?? "",
            math: root?.querySelectorAll("math").length ?? 0,
            // html-compat lays the table out as a grid with ARIA roles; every equation keeps its MathML.
            cells: root?.querySelectorAll('td, [role="cell"]').length ?? 0,
          };
        });
        if (!html.text.includes(TEXT)) problems.push("HTML: the worksheet's last sentence isn't there");
        if (!html.heading.includes("Fractions")) problems.push(`HTML: heading "${html.heading}"`);
        if (html.math < 7) problems.push(`HTML: ${html.math} equations`);
        if (html.cells < 6) problems.push(`HTML: ${html.cells} table cells`);

        await page.getByLabel("Pages").check();
        // A page is painted on a canvas, or an SVG in a shadow root (what the engine can't draw), with a text layer.
        await page.waitForFunction(
          (text) =>
            [...document.querySelectorAll(".typstream-page")].some(
              (p) =>
                (p.querySelector(":scope > canvas")?.width > 0 ||
                  p.firstElementChild?.shadowRoot?.querySelector("svg")) &&
                p.querySelector(".typstream-text-layer")?.textContent.includes(text),
            ),
          TEXT,
          { timeout: 60_000 },
        );
        await finished(page);

        const [download] = await Promise.all([
          page.waitForEvent("download", { timeout: 60_000 }),
          page.getByRole("button", { name: "Download PDF" }).click(),
        ]);
        const stream = await download.createReadStream();
        const chunks = [];
        for await (const chunk of stream) chunks.push(chunk);
        const pdf = Buffer.concat(chunks);
        if (pdf.subarray(0, 5).toString() !== "%PDF-") problems.push(`PDF: starts with ${pdf.subarray(0, 8)}`);
        if (download.suggestedFilename() !== "worksheet.pdf") problems.push(`PDF: ${download.suggestedFilename()}`);
      } catch (e) {
        problems.push(e.message.split("\n")[0]);
      }
      problems.push(...errors.map((e) => `console: ${e}`));
      if (process.argv.includes("--screenshot")) await page.screenshot({ path: `smoke-${name}.png`, fullPage: true });
    } finally {
      await browser.close();
    }
    if (problems.length) failures.push(`${name}:\n  ${problems.join("\n  ")}`);
    else console.log(`ok: ${name}, the worksheet streamed in both targets and downloaded as a PDF`);
  }
} finally {
  server.kill();
}
if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}
