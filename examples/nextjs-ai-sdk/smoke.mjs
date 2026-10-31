// Smoke test (PLAN §10.4: example apps build and run): builds the app, starts it,
// asks for a worksheet in Chromium (a suggestion, rendered as pages) and exports
// it as a Word file, then asks for a change typed in the field, as HTML: a second
// answer, the worksheet again with the change. It checks that both answers stream
// into <Typstream> and finish, with no error frame, that the export downloads a
// .docx, that the replay's mind map is interactive in the HTML answer (a render
// island), and that telemetry reached the example's sink. Without
// ANTHROPIC_API_KEY the server replays a recorded worksheet and a revision of it,
// so this runs offline.

import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
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
  // With no key on the server, the page asks for the visitor's: decline, and the route replays its worksheet.
  if (!process.env.ANTHROPIC_API_KEY) {
    await page.getByRole("dialog").waitFor({ timeout: 30_000 });
    await page.getByRole("button", { name: "Replay a sample", exact: true }).click();
    await page.getByRole("dialog").waitFor({ state: "hidden" });
  }
  const answers = page.locator("article.answer");
  /** Waits for the nth answer to render (a page, or HTML's streaming caret) and finish, with no error frame; returns its text. */
  const answered = async (n, target) => {
    const answer = answers.nth(n);
    await answer
      .locator(target === "paged" ? ".typstream-page" : ".typstream-caret")
      .first()
      .waitFor({ timeout: 60_000 });
    await answer.and(page.locator('[data-status="done"]')).waitFor({ timeout: 120_000 });
    const stale = await answer.getAttribute("data-stale");
    if (stale !== "0") throw new Error(`answer ${n + 1}: ${stale} error frames while streaming`);
    return answer.locator(".typstream-host").textContent();
  };

  await page.getByRole("button", { name: "Handout", exact: true }).click();
  const text = await answered(0, "paged");
  if (!process.env.ANTHROPIC_API_KEY && !text.includes("Pythagorean triples"))
    throw new Error(`unexpected render: ${text}`);
  // The answer as a Word file: a .docx download, a zip.
  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 60_000 }),
    page.getByRole("button", { name: "Export Word (.docx)", exact: true }).click(),
  ]);
  const docx = await readFile(await download.path());
  if (!download.suggestedFilename().endsWith(".docx") || docx.length === 0 || docx.subarray(0, 2).toString() !== "PK")
    throw new Error(`not a DOCX: ${download.suggestedFilename()}, ${docx.length} bytes`);
  // A second turn as HTML, typed and sent with Enter: the worksheet again, with the change.
  await page.getByRole("combobox", { name: "Render as" }).click();
  await page.getByRole("option", { name: "HTML" }).click();
  await page.getByRole("textbox", { name: "Message" }).fill("Make the worked example use a longer ladder.");
  await page.getByRole("textbox", { name: "Message" }).press("Enter");
  const revised = await answered(1, "html");
  if (!process.env.ANTHROPIC_API_KEY) {
    if (!revised.includes("12 m up the wall") || !revised.includes("Pythagorean triples"))
      throw new Error(`unexpected revision: ${revised}`);
    // The first answer is as it was.
    const first = await answers.first().locator(".typstream-host").textContent();
    if (!first.includes("4 m up the wall")) throw new Error(`the first answer changed: ${first}`);
    // The replay's mind map, as an island: React Flow's nodes over the drawing.
    await answers.nth(1).locator("typstream-island .react-flow__node").first().waitFor({ timeout: 30_000 });
    const nodes = await answers.nth(1).locator("typstream-island .react-flow__node").count();
    if (nodes !== 9) throw new Error(`the mind map island has ${nodes} nodes, not 9`);
  }
  if (errors.length) throw new Error(`console errors:\n${errors.join("\n")}`);
  // The telemetry hooks (app/telemetry.tsx) reached the example's sink.
  const reached = () => /\[telemetry\] rendered \S+ rev \d+ \(final\)/.test(log);
  const deadline = Date.now() + 10_000;
  while (!reached() && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 200));
  if (!reached()) throw new Error(`no telemetry reached /api/telemetry:\n${log}`);
  if (process.argv.includes("--screenshot")) await page.screenshot({ path: "smoke.png", fullPage: true });
  console.log(
    `ok: streamed an answer and a revision of it with no error frames (${text.length} and ${revised.length} characters), and exported a ${docx.length}-byte DOCX`,
  );
} finally {
  await browser.close();
  server.kill();
}
