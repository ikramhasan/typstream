// @typstream/mindmap/react: the interactive mind map, for `<Typstream islands>` (@typstream/react).
// This entry is small: React Flow, most of the weight, loads with the map's code the first time
// a document shows a map, and the drawing stays visible under the island until then.

import type { IslandProps } from "@typstream/core";
import { lazy, Suspense } from "react";
import type { MindMapData } from "./index";

export type { MindMapData, MindMapNode } from "./index";

const Flow = lazy(() => import("./react/flow"));

/**
 * The `mindmap` island as a React component: pan, zoom, and open and close branches, laid out
 * like the drawing it covers. Read-only: nothing flows back to the document.
 *
 * @example
 * ```tsx
 * import { mindmap } from "@typstream/mindmap";
 * import { MindMapIsland } from "@typstream/mindmap/react";
 *
 * <Typstream plugins={[mindmap]} islands={{ mindmap: MindMapIsland }} source={text} />
 * ```
 * @beta
 */
export const MindMapIsland = (props: IslandProps<MindMapData>) => (
  <Suspense fallback={null}>
    <Flow {...props} />
  </Suspense>
);

/** `{ mindmap: MindMapIsland }`, for `<Typstream islands>` and `<TypstreamProvider islands>`. @beta */
export const mindmapIslands = { mindmap: MindMapIsland } as const;
