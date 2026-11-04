// The generator's parts without Typst: finding the blocks, pele's SVG split into shapes and labels,
// the measurer, and a document's session (what it writes, when it keeps the last drawing).
import { describe, expect, it } from "vitest";
import { type Drawing, draw, PAGE_WIDTH } from "../src/draw";
import generator from "../src/generator";
import { measureText } from "../src/measure";
import { INDEX_FILE, MERMAID_ROOT } from "../src/paths";
import { diagramKey, findFences } from "../src/scan";
import { splitText } from "../src/svg";

const FLOW = "flowchart TD\n  A[Start] --> B{Ready?}\n  B -->|Yes| C[Go]\n";

describe("findFences", () => {
  it("finds mermaid blocks, with keys whitespace can't change", () => {
    const text = `= Title\n\n\`\`\`mermaid\n${FLOW}\`\`\`\n\n\`\`\`python\nprint(1)\n\`\`\`\n\n  \`\`\`\`mermaid\n  pie\n    "A" : 1\n  \`\`\`\`\n`;
    const fences = findFences(text);
    expect(fences.map((f) => f.source)).toEqual([FLOW, '  pie\n    "A" : 1\n  ']);
    expect(fences[0]?.key).toBe("flowchart TD A[Start] --> B{Ready?} B -->|Yes| C[Go]");
    expect(fences[1]?.key).toBe(diagramKey('pie\n\t"A"  :  1'.replace("  :  ", " : ")));
  });

  it("closes a block at the first run of as many backticks, and leaves an unclosed one out", () => {
    expect(findFences("````mermaid\npie\n  ```x```\n````").map((f) => f.key)).toEqual(["pie ```x```"]);
    expect(findFences("```mermaid\nflowchart LR\n  A --> B")).toEqual([]);
    // A tag that only starts with "mermaid", and an inline-looking one, aren't diagrams.
    expect(findFences("```mermaidx\npie\n```")).toEqual([]);
    expect(findFences("`````mermaid pie`")).toEqual([]);
  });
});

describe("splitText", () => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" class="pele" viewBox="0 0 100 50" style="max-width:100%;--_fg:var(--pele-fg,#1f1f1f);--_s:var(--pele-surface,#f3f3f3);--_r:var(--pele-radius,4px);font:16px sans-serif" fill="var(--_fg)"><g transform="translate(10,20)" font-size="14"><rect width="20" height="10" fill="var(--_s)" style="rx:var(--_r)"/><text x="5" y="3" text-anchor="middle">A &amp; B</text></g><text class="pele-title" font-weight="bold" fill="var(--pele-series-2,#f58518)" transform="rotate(-90 0 0)" x="0" y="40"><tspan x="0" y="40">Line 1</tspan><tspan x="0" y="58">Line  2</tspan></text></svg>`;

  it("resolves pele's variables, takes the text out and keeps the shapes", () => {
    const out = splitText(svg);
    expect(out.svg).not.toMatch(/var\(|<text|<tspan|style=/);
    expect(out.svg).toContain('fill="#f3f3f3"');
    expect(out.svg).toContain('rx="4"');
    expect(out.svg).toMatch(/^<svg color="#1f1f1f"/);
  });

  it("places each line where the transforms put it, with the styles it inherits", () => {
    const [a, line1, line2] = splitText(svg).labels;
    expect(a).toEqual({
      x: 15,
      y: 23,
      rotate: 0,
      anchor: "middle",
      size: 14,
      weight: 400,
      italic: false,
      mono: false,
      fill: "#1f1f1f",
      text: "A & B",
    });
    expect(line1).toMatchObject({ x: 40, y: 0, rotate: -90, weight: 700, fill: "#f58518", text: "Line 1" });
    expect(line2).toMatchObject({ x: 58, y: 0, rotate: -90, text: "Line 2" });
  });

  it("takes a theme's colours over pele's", () => {
    expect(splitText(svg, { "--pele-fg": "#000000" }).labels[0]?.fill).toBe("#000000");
  });

  it("leaves no text or variable in any kind of diagram pele draws", () => {
    for (const source of [
      FLOW,
      "sequenceDiagram\n  A->>B: Hi\n  Note over A,B: note",
      'pie title Pets\n  "Dogs" : 3\n  "Cats" : 2',
      "classDiagram\n  Animal <|-- Duck\n  Duck : +swim()",
      "erDiagram\n  A ||--o{ B : has",
      "gantt\n  dateFormat YYYY-MM-DD\n  Task :2026-01-01, 3d",
      "xychart\n  x-axis [a, b]\n  bar [1, 2]",
      "mindmap\n  root((Root))\n    Child",
      "timeline\n  2020 : One\n  2021 : Two",
      "quadrantChart\n  x-axis Low --> High\n  y-axis Low --> High\n  A: [0.3, 0.6]",
    ]) {
      const d = draw(source, "t-") as Extract<Drawing, { svg: string }>;
      expect(d, source).toHaveProperty("svg");
      expect(d.svg, source).not.toMatch(/var\(|<text|<tspan/);
      expect(d.labels.length, source).toBeGreaterThan(0);
    }
  });
});

describe("draw", () => {
  it("lays a diagram too wide for the page out again, narrower", () => {
    const wide = draw(
      "flowchart LR\n  A[Ocean] --> B[Water vapour] --> C[Clouds] --> D[Rain and snow] --> E[Rivers]",
      "w-",
    );
    expect("w" in wide && wide.w <= PAGE_WIDTH).toBe(true);
  });

  it("reports pele's error with its line", () => {
    expect(draw("flowchart LR\n  A --> B\n  C -->", "e-")).toEqual({
      error: expect.stringContaining("line 3"),
      line: 3,
    });
    expect(draw("not a diagram", "e-")).toMatchObject({ error: expect.stringMatching(/./) });
  });
});

describe("measureText", () => {
  it("measures in Libertinus Serif's advances, bold and italic their own, monospace fixed", () => {
    // Libertinus Serif's "A" is 695 units of 1000; bold 740.
    expect(measureText("A", 10, 0)).toBeCloseTo(6.95);
    expect(measureText("A", 10, 1)).toBeCloseTo(7.4);
    expect(measureText("AAAA", 10, 4)).toBeCloseTo((4 * 10 * 1233) / 2048);
    // A character the face lacks: a full em for Chinese.
    expect(measureText("水", 10, 0)).toBe(10);
  });
});

describe("a document's generator session", () => {
  const doc = (body: string) => `= Notes\n\n\`\`\`mermaid\n${body}\n\`\`\`\n`;
  const index = (files: Record<string, unknown>) => JSON.parse(files[INDEX_FILE] as string) as Record<string, unknown>;

  it("writes the index and one SVG per drawing, and the same files again when nothing changed", () => {
    const session = generator.open();
    const files = session.files(doc(FLOW), { mode: "streaming" }) as Record<string, string>;
    const entry = index(files)[diagramKey(FLOW)] as { svg: string; w: number; labels: unknown[] };
    expect(entry.labels.length).toBe(4);
    expect(Object.keys(files)).toEqual([INDEX_FILE, `${MERMAID_ROOT}/${entry.svg}`]);
    expect(entry.svg).toMatch(/^diagrams\/[0-9a-f]{8}\.svg$/);
    expect(session.files(`${doc(FLOW)}More text.`, { mode: "streaming" })).toBe(files);
  });

  it("keeps a diagram's last drawing while its source is cut, and shows the error in final mode", () => {
    const session = generator.open();
    session.files(doc("flowchart LR\n  A --> B"), { mode: "streaming" });
    const cut = "flowchart LR\n  A --> B\n  B -->";
    const streaming = index(session.files(doc(cut), { mode: "streaming" }) as Record<string, string>);
    expect(streaming[diagramKey(cut)]).toMatchObject({ labels: [expect.anything(), expect.anything()] });
    const final = index(session.files(doc(cut), { mode: "final" }) as Record<string, string>);
    expect(final[diagramKey(cut)]).toEqual({ error: expect.any(String), line: 3 });
  });

  it("leaves out a block it never drew while streaming, so it shows as code", () => {
    const session = generator.open();
    expect(session.files(doc("flowchart LR\n  A -->"), { mode: "streaming" })).toEqual({ [INDEX_FILE]: "{}" });
  });

  it("drops a drawing's SVG once its block is gone", () => {
    const session = generator.open();
    const before = session.files(doc(FLOW), { mode: "streaming" }) as Record<string, string>;
    expect(Object.keys(before)).toHaveLength(2);
    expect(session.files("= Notes\n", { mode: "streaming" })).toEqual({ [INDEX_FILE]: "{}" });
  });
});
