// Drives the bench page in real browsers with Playwright.
//   node run.mjs [filter...]     e.g. node run.mjs chromium typstts
// Each run gets a fresh browser context (cold HTTP cache). Results go to
// results/<name>.json and a summary table is printed at the end.
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium, firefox, webkit } from "playwright";

const PORT = 5174;
const BASE = `http://localhost:${PORT}`;
const filters = process.argv.slice(2);

const RUNS = [
  { engine: "typstts", format: "paged" },
  { engine: "typstwasm", format: "html" },
  { engine: "typstwasm", format: "svg" },
  { engine: "typstwasm", format: "html", coi: 0 },
  { engine: "typstwasmw", format: "html", coi: 0 },
  { engine: "typstwasmw", format: "svg", coi: 0 },
  { engine: "custom", format: "html", variant: "html-svg" },
  { engine: "custom", format: "svg", variant: "html-svg" },
  { engine: "custom", format: "svgdiff", variant: "html-svg" },
  { engine: "custom", format: "svgdiff", variant: "html-svg", evict: 1, evictAge: 2 },
  { engine: "custom", format: "html", variant: "slim-html-svg" },
  { engine: "typstts", format: "paged", mode: "memory" },
  { engine: "custom", format: "html", variant: "html-svg", mode: "memory", evict: 0 },
  { engine: "custom", format: "html", variant: "html-svg", mode: "memory", evict: 10 },
  { engine: "custom", format: "html", variant: "html-svg", mode: "memory", evict: 1, evictAge: 2 },
  { engine: "custom", format: "html", variant: "html-svg", mode: "memory", evict: 5, evictAge: 0 },
];
const BROWSERS = { chromium, firefox, webkit };
// "throttled" approximates a school Chromebook on a mediocre connection
// (Chromium only: CPU and network throttling need CDP).
const PROFILES = [
  { name: "local" },
  { name: "throttled", only: "chromium", cpu: 4, net: { downloadThroughput: (20 * 1e6) / 8, uploadThroughput: (5 * 1e6) / 8, latency: 40 } },
];

const server = spawn("node", ["server.mjs"], { env: { ...process.env, PORT: String(PORT) }, stdio: ["ignore", "inherit", "inherit"] });
await new Promise((r) => setTimeout(r, 500));
mkdirSync("results", { recursive: true });

const summary = [];
try {
  for (const [bname, btype] of Object.entries(BROWSERS)) {
    const browser = await btype.launch();
    for (const profile of PROFILES) {
      if (profile.only && profile.only !== bname) continue;
      for (const run of RUNS) {
        const name = [bname, profile.name, run.engine, run.format, run.variant, run.mode ?? "stream", run.evict !== undefined ? `evict${run.evict}${run.evictAge !== undefined ? `age${run.evictAge}` : ""}` : "", run.coi === 0 ? "nocoi" : ""].filter(Boolean).join("-");
        if (filters.length && !filters.every((f) => name.includes(f))) continue;
        if (profile.name === "throttled" && run.mode === "memory") continue;
        // evict variants in stream mode are only meaningful for svgdiff here
        if (run.evict !== undefined && run.mode !== "memory" && run.format !== "svgdiff") continue;
        const params = new URLSearchParams({ engine: run.engine, format: run.format, mode: run.mode ?? "stream" });
        if (run.variant) params.set("variant", run.variant);
        if (run.evict !== undefined) params.set("evict", String(run.evict));
        if (run.coi === 0) params.set("coi", "0");
        if (run.evictAge !== undefined) params.set("evictAge", String(run.evictAge));
        if (profile.name === "throttled") params.set("docs", "1,5");
        const context = await browser.newContext({ viewport: { width: 1000, height: 900 } });
        const page = await context.newPage();
        const consoleErrors = [];
        page.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text()));
        page.on("pageerror", (e) => consoleErrors.push(String(e)));
        if (profile.cpu) {
          const cdp = await context.newCDPSession(page);
          await cdp.send("Emulation.setCPUThrottlingRate", { rate: profile.cpu });
          await cdp.send("Network.enable");
          await cdp.send("Network.emulateNetworkConditions", { offline: false, ...profile.net });
        }
        const t = Date.now();
        process.stdout.write(`${name} ... `);
        let result;
        try {
          await page.goto(`${BASE}/?${params}`);
          await page.waitForFunction(() => window.__result || window.__error, null, { timeout: 10 * 60_000, polling: 500 });
          const { r, e } = await page.evaluate(() => ({ r: window.__result, e: window.__error }));
          result = r ?? { error: e };
        } catch (e) {
          result = { error: String(e) };
        }
        result.consoleErrors = consoleErrors.slice(0, 5);
        result.wallSeconds = (Date.now() - t) / 1000;
        writeFileSync(`results/${name}.json`, JSON.stringify(result, null, 2));
        console.log(result.error ? `ERROR ${result.error.split("\n")[0]}` : `ok (${result.wallSeconds}s)`);
        summary.push({ name, result });
        await context.close();
      }
    }
    await browser.close();
  }
} finally {
  server.kill();
}

const f = (x) => (x === undefined || x === null ? "-" : typeof x === "number" ? x.toFixed(0) : x);
console.log("\nrun | dl+compile | inst | fonts | 5p stream p50/p90 | 5p render p50 | 20p full | 20p render | fails | longtasks>50");
for (const { name, result: r } of summary) {
  if (r.error || !r.docs) continue;
  const d5 = r.docs[5];
  const d20 = r.docs[20];
  console.log([name, f(r.init?.downloadCompile), f(r.init?.instantiate), f(r.init?.fonts), d5 ? `${f(d5.stream.compile?.p50)}/${f(d5.stream.compile?.p90)}` : "-", f(d5?.stream.render?.p50), f(d20?.fullDoc.compileMs), f(d20?.fullDoc.renderMs), Object.values(r.docs).reduce((n, d) => n + d.stream.failures, 0), f(r.longTasks?.over50)].join(" | "));
}
