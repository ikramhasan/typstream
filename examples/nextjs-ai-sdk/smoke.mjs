// Smoke test (PLAN §10.4: example apps build and run): builds the app, starts it,
// asks for a worksheet in Chromium and checks that the answer streams into
// <Typstream>, finishes, never had an error frame, and that its telemetry
// reached the example's sink. Without ANTHROPIC_API_KEY
// the server replays a recorded worksheet, so this runs offline.

import { spawn } from "node:child_process";
import { chromium } from "playwright";

const PORT = 3417;
const run = (args) =>
  new Promise((resolve, reject) => {
    const child = spawn("pnpm", ["exec", "next", ...args], { stdio: "inherit" });
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`next ${args[0]} exited with ${code}`))));
  });

await run(["build"]);
const server = spawn("pnpm", ["exec", "next", "start", "-p", String(PORT)], { stdio: ["ignore", "pipe", "inherit"] });
let log = "";
await new Promise((resolve) =>
  server.stdout.on("data", (d) => {
    log += String(d);
    if (log.includes("Ready")) resolve();
  }),
);

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.goto(`http://localhost:${PORT}/`);
  await page.getByRole("button", { name: "Send" }).click();
  const answer = page.locator("article.answer").first();
  // Streaming shows a caret.
  await answer.locator(".typstream-caret").waitFor({ timeout: 60_000 });
  await page.waitForSelector('article.answer[data-status="done"]', { timeout: 120_000 });
  const stale = await answer.getAttribute("data-stale");
  const text = await answer.locator(".typstream").textContent();
  if (stale !== "0") throw new Error(`${stale} error frames while streaming`);
  if (!process.env.ANTHROPIC_API_KEY && !text.includes("Pythagorean triples"))
    throw new Error(`unexpected render: ${text}`);
  if (errors.length) throw new Error(`console errors:\n${errors.join("\n")}`);
  // The telemetry hooks (app/telemetry.tsx) reached the example's sink.
  const reached = () => /\[telemetry\] rendered \S+ rev \d+ \(final\)/.test(log);
  const deadline = Date.now() + 10_000;
  while (!reached() && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 200));
  if (!reached()) throw new Error(`no telemetry reached /api/telemetry:\n${log}`);
  if (process.argv.includes("--screenshot")) await page.screenshot({ path: "smoke.png", fullPage: true });
  console.log(`ok: streamed and finished with no error frames (${text.length} characters rendered)`);
} finally {
  await browser.close();
  server.kill();
}
