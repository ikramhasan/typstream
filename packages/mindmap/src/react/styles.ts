// The interactive map's own styles, next to React Flow's (xyflow-css.generated.ts). Node colours
// and sizes are set per node through the CSSOM (React's `style`); this is what they share. The
// map paints its own background over the fallback drawing: `--typstream-island-background`, or
// the page's canvas colour (the paged view sets white, the paper). The document's element rules
// reach into islands with zero specificity (`:where(.typstream) svg { max-width: 100% }`, which
// gives React Flow's edge layer, a zero-width box, no width at all), so class rules reset them.
export const MINDMAP_CSS = `.ts-mindmap {
  margin: 0;
  width: 100%;
  height: 100%;
  background: var(--typstream-island-background, Canvas);
}
.ts-mindmap .react-flow {
  --xy-background-color: transparent;
  font: inherit;
}
.ts-mindmap :is(svg, img) {
  max-width: none;
}
.ts-mindmap-node {
  box-sizing: border-box;
  border: 0 solid;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  line-height: 1.25;
  text-align: center;
  white-space: nowrap;
}
.ts-mindmap-node[data-depth="1"] {
  border-width: 1.6px;
}
.ts-mindmap-node[data-depth="2"] {
  border-width: 1.0667px;
}
.ts-mindmap-label {
  display: flex;
  align-items: center;
  gap: 5.333px;
}
.ts-mindmap-label > span[dir] {
  display: flex;
  flex-direction: column;
}
.ts-mindmap-badge {
  border-radius: 1em;
  padding: 2px 4px;
  font-weight: 700;
  line-height: 1.2;
  background: var(--ts-mindmap-color);
  color: #fff;
}
.ts-mindmap-node[data-depth="0"] .ts-mindmap-badge {
  background: #fff;
  color: var(--ts-mindmap-color);
}
.ts-mindmap-image {
  align-self: stretch;
  margin-bottom: 4px;
  overflow: hidden;
  border-radius: 2.667px;
  background: #e5e7eb;
  color: #4b5563;
  font-size: 0.7em;
  display: flex;
  align-items: center;
  justify-content: center;
}
.ts-mindmap-image img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.ts-mindmap .react-flow__handle {
  opacity: 0;
  pointer-events: none;
  width: 1px;
  height: 1px;
  min-width: 0;
  min-height: 0;
  border: 0;
}
.ts-mindmap .react-flow__node[aria-label*="("] {
  cursor: pointer;
}
.ts-mindmap .react-flow__node:focus-visible {
  outline: 2px solid #2563eb;
  outline-offset: 2px;
  border-radius: 4px;
}`;
