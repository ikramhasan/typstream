// Replays a worksheet the way a model streams it: a fixed Typst document, a few characters every 30 ms,
// `isStreaming` until the last one. In an app, `source` is the text a model has written so far
// (apps/website/content/docs/getting-started/vanilla.mdx).

import { mountTypstream, registerMathFont, type TypstreamOptions } from "@typstream/dom";
import { createEngine, engineWorker } from "@typstream/engine";
import { baseFonts } from "@typstream/engine-wasm/fonts";
import { htmlCompat } from "@typstream/html-compat";
import { universe } from "@typstream/universe";
import WORKSHEET from "./worksheet.typ?raw";
import "./app.css";

/** Characters per tick and the tick, in ms: about two seconds for the worksheet. */
const CHUNK = 6;
const TICK = 30;

const $ = <T extends Element>(selector: string) => {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`no ${selector}`);
  return element;
};
const status = $<HTMLOutputElement>(".status");
const download = $<HTMLButtonElement>("#download");

// One engine per page: every document on it shares one worker.
const engine = createEngine({ spawn: engineWorker() });

// MathML needs a math font to stretch delimiters; html-compat's CSS asks for this one.
const mathFont = baseFonts.find((url) => url.pathname.includes("NewCMMath"));
if (mathFont) void registerMathFont(mathFont);

// update() replaces the options, so they're kept in one object and passed whole every time.
let options: TypstreamOptions = {
  engine,
  plugins: [htmlCompat, universe],
  source: "",
  isStreaming: true,
  target: "html",
  animated: true,
  caret: true,
};
const view = mountTypstream($<HTMLElement>("#preview"), options);
const update = (changes: Partial<TypstreamOptions>) => {
  options = { ...options, ...changes };
  view.update(options);
  showStatus();
};

// `data-*` for smoke.mjs: whether the replay finished, and the document's status.
function showStatus() {
  const state = view.getState()?.status ?? "idle";
  status.dataset.streaming = String(options.isStreaming);
  status.dataset.status = state;
  status.value = options.isStreaming ? "streaming" : state;
  download.disabled = Boolean(options.isStreaming);
}
view.subscribe(showStatus);

let timer: ReturnType<typeof setInterval> | undefined;
function replay() {
  clearInterval(timer);
  let length = 0;
  update({ source: "", isStreaming: true });
  timer = setInterval(() => {
    length = Math.min(length + CHUNK, WORKSHEET.length);
    const done = length === WORKSHEET.length;
    update({ source: WORKSHEET.slice(0, length), isStreaming: !done });
    if (done) clearInterval(timer);
  }, TICK);
}

for (const radio of document.querySelectorAll<HTMLInputElement>('input[name="target"]')) {
  radio.addEventListener("change", () => update({ target: radio.value as "html" | "paged" }));
}
$("#replay").addEventListener("click", replay);
download.addEventListener("click", async () => {
  const pdf = await view.exportPdf();
  const url = URL.createObjectURL(new Blob([pdf as Uint8Array<ArrayBuffer>], { type: "application/pdf" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = "worksheet.pdf";
  a.click();
  URL.revokeObjectURL(url);
});

replay();
