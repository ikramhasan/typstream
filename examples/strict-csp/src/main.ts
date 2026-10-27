// Mounts one worksheet twice, as HTML and as pages, the way an app does with
// @typstream/dom (the `typstream` package's <Typstream> does the same in React).
// Each mount's status goes on its element as `data-status`, and engine trouble
// as `data-error`, for smoke.mjs.

import { mountTypstream, registerMathFont } from "@typstream/dom";
import { createEngine, engineWorker } from "@typstream/engine";
import { baseFonts } from "@typstream/engine-wasm/fonts";
import { htmlCompat, htmlCompatCss } from "@typstream/html-compat";
import { universe } from "@typstream/universe";
import "./page.css";
import source from "./worksheet.typ?raw";

const engine = createEngine({ spawn: engineWorker() });
const mathFont = baseFonts.find((url) => url.pathname.includes("NewCMMath"));
if (mathFont) void registerMathFont(mathFont);

for (const target of ["html", "paged"] as const) {
  const element = document.getElementById(target) as HTMLElement;
  engine.onEvent((event) => {
    if (event.type === "failed" || event.type === "crash") element.dataset.error = String(event.type);
  });
  mountTypstream(element, {
    engine,
    source,
    target,
    plugins: [htmlCompat, universe],
    stylesheets: [htmlCompatCss],
    onStatusChange: (status) => {
      element.dataset.status = status;
    },
  });
}
