// mindmap's conformance suite (#135): its catalogue's and prompt kit's examples must look the same in the paged view,
// Typst's PDF and the DOCX export, where a map is a picture (#133).
import type { ConformanceSuite } from "@typstream/conformance";
import { MINDMAP_VERSION, mindmap, mindmapCatalogue, mindmapExamples } from "../../src/index";

export const suite: ConformanceSuite = {
  name: `mindmap-${MINDMAP_VERSION}`,
  plugins: [mindmap],
  examples: [
    ...mindmapCatalogue.map((d) => ({ name: `catalogue: ${d.name}`, source: d.example ?? "" })),
    ...mindmapExamples.map((e) => ({ name: `example: ${e.title}`, source: e.output })),
  ],
};
