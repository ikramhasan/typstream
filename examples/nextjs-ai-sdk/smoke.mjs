// Smoke test (PLAN §10.4: example apps build and run): builds the app, starts it,
// asks for a worksheet in Chromium (a suggestion, rendered as pages), then for a
// change typed in the field, as HTML: an edit of that worksheet (#34). It checks
// that the answer streams into <Typstream> and finishes, that the edit streams
// into the finished document, highlighted, and can be undone, that the first
// answer's Edit button changes that document in place, that none ever had an
// error frame, that the replay's mind map is interactive in the HTML answer
// (a render island), and that telemetry reached the example's sink. Without
// ANTHROPIC_API_KEY the server replays a recorded worksheet and an edit of it, so
// this runs offline.

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
  // A second turn as HTML, typed and sent with Enter: an edit of the worksheet. The edit's answer shows
  // the worksheet at once, then the blocks it rewrites stream in, highlighted, and Keep and Undo follow.
  await page.getByRole("combobox", { name: "Render as" }).click();
  await page.getByRole("option", { name: "HTML" }).click();
  await page.getByRole("textbox", { name: "Message" }).fill("Make the worked example use a longer ladder.");
  await page.getByRole("textbox", { name: "Message" }).press("Enter");
  const edit = answers.nth(1);
  await edit.locator("[data-edit]").first().waitFor({ timeout: 60_000 });
  const undo = page.getByRole("button", { name: "Undo", exact: true });
  await undo.waitFor({ timeout: 120_000 });
  await edit.and(page.locator('[data-status="done"]')).waitFor({ timeout: 120_000 });
  const stale = await edit.getAttribute("data-stale");
  if (stale !== "0") throw new Error(`the edit: ${stale} error frames while streaming`);
  if (!process.env.ANTHROPIC_API_KEY) {
    const edited = await edit.locator(".typstream-host").textContent();
    if (!edited.includes("12 m up the wall") || !edited.includes("Pythagorean triples"))
      throw new Error(`unexpected edit: ${edited}`);
    await undo.click();
    await page.waitForFunction(
      (el) => el?.textContent.includes("4 m up the wall") && !el.textContent.includes("12 m up the wall"),
      await edit.locator(".typstream-host").elementHandle(),
      { timeout: 30_000 },
    );
  }
  // Edit the first answer in place: its Edit button asks what to change, and that document changes,
  // with no new answer below it. Then Keep.
  await page.getByRole("button", { name: "Edit", exact: true }).first().click();
  await page.getByRole("textbox", { name: "Edit instruction" }).fill("Use a longer ladder in the worked example.");
  await page.getByRole("textbox", { name: "Edit instruction" }).press("Enter");
  const keep = page.getByRole("button", { name: "Keep", exact: true });
  await keep.waitFor({ timeout: 120_000 });
  await answers.first().and(page.locator('[data-status="done"]')).waitFor({ timeout: 120_000 });
  if ((await answers.count()) !== 2) throw new Error(`an edit in place added an answer: ${await answers.count()}`);
  const inPlace = await answers.first().getAttribute("data-stale");
  if (inPlace !== "0") throw new Error(`the edit in place: ${inPlace} error frames while streaming`);
  if (!process.env.ANTHROPIC_API_KEY) {
    await page.waitForFunction(
      (el) => el?.textContent.includes("12 m up the wall"),
      await answers.first().locator(".typstream-host").elementHandle(),
      { timeout: 30_000 },
    );
  }
  await keep.click();
  if (!process.env.ANTHROPIC_API_KEY) {
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
    `ok: streamed an answer, an edit of it and an edit in place with no error frames (${text.length} characters in the first)`,
  );
} finally {
  await browser.close();
  server.kill();
}
