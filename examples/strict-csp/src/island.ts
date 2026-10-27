// A render island under the same policy (#28): @typstream/react's <Typstream> with
// @typstream/mindmap's interactive map, React Flow, over the map's Typst drawing. React sets
// styles through the CSSOM and the map adopts its CSS as constructable stylesheets, so
// `style-src 'self'` holds. Its status goes on the element as `data-status`, for smoke.mjs.

import { createEngine, engineWorker } from "@typstream/engine";
import { mindmap } from "@typstream/mindmap";
import { mindmapIslands } from "@typstream/mindmap/react";
import { Typstream } from "@typstream/react";
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import "./page.css";

const MAP = `= The water cycle

#mindmap[
  Water cycle
  - Evaporation
    - Heat from the sun
    - Oceans and lakes
  - Condensation
    - Clouds
  - #topic(collapsed: true)[Precipitation]
    - Rain
    - Snow
]
`;

const engine = createEngine({ spawn: engineWorker() });
const element = document.getElementById("island") as HTMLElement;
createRoot(element).render(
  createElement(Typstream, {
    engine,
    source: MAP,
    plugins: [mindmap],
    islands: mindmapIslands,
    onStatusChange: (status) => {
      element.dataset.status = status;
    },
  }),
);
