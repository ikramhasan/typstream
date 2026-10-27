// The mind map in both targets through engine-wasm: every catalogue and prompt example compiles
// without errors or warnings and writes one island marker per map, whose data the island's spec
// accepts; options cut by a stream fall back to their defaults; and every stream prefix of the
// examples, healed as the engine heals it, compiles (edu's rule: whatever a cut leaves draws).
import { heal } from "@typstream/heal";
import { describe, expect, it } from "vitest";
import { type MindMapData, mindmapCatalogue, mindmapExamples, parseMindMap } from "../src/index";
import { compileHtml, compilePaged, htmlIslands, newEngine, problems } from "./support/engine";

const engine = newEngine();
/** A 1×1 PNG. */
const PNG = Uint8Array.from(
  atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg=="),
  (c) => c.charCodeAt(0),
);
engine.set_file("/leaf.png", PNG);

const documents = [
  ...mindmapCatalogue.map((d) => ({ title: `${d.name} example`, source: d.example ?? "" })),
  ...mindmapExamples.map((e) => ({ title: `example ${e.title}`, source: e.output })),
];

/** The data of each map in the HTML export, checked by the spec. */
const maps = (source: string): MindMapData[] => {
  const out = compileHtml(engine, source);
  expect(problems(out.diagnostics)).toEqual([]);
  return htmlIslands(out.html).map((island) => {
    expect(island.name).toBe("mindmap");
    const data = parseMindMap(island.data);
    expect(data, JSON.stringify(island.data)).toBeDefined();
    return data as MindMapData;
  });
};

const labels = (n: MindMapData["root"]): string[] => [n.label, ...(n.children ?? []).flatMap(labels)];

describe.each(documents)("$title", ({ source }) => {
  it("compiles in both targets without errors or warnings", () => {
    expect(problems(compilePaged(engine, source).diagnostics)).toEqual([]);
    expect(maps(source).length).toBeGreaterThan(0);
  });
});

describe("the marker's data", () => {
  it("holds the tree with every value resolved", () => {
    const [map] = maps(`#mindmap[
  Photosynthesis
  - Inputs
    - Water ($H_2 O$)
    - *Sunlight*
  - #topic(color: "#dc2626", weight: "regular", size: 14pt)[Outputs]
    - Oxygen
  - Where
]`);
    expect(map).toMatchObject({ v: 1, style: "visual", layout: "both", dir: "ltr", size: 11 });
    const root = (map as MindMapData).root;
    expect(labels(root)).toEqual(["Photosynthesis", "Inputs", "Water (H₂O)", "Sunlight", "Outputs", "Oxygen", "Where"]);
    expect(root).toMatchObject({ color: "#1e293b", size: 13.75, weight: "bold" });
    const [inputs, outputs, where] = root.children ?? [];
    // Main branches take the palette in turn and are bold; the first half goes right.
    expect(inputs).toMatchObject({ color: "#2563eb", weight: "bold", size: 11, side: "right" });
    expect(inputs?.children?.[0]).toMatchObject({ color: "#2563eb", weight: "regular", size: 9.9 });
    expect(outputs).toMatchObject({ color: "#dc2626", weight: "regular", size: 14, side: "right" });
    expect(outputs?.children?.[0]).toMatchObject({ color: "#dc2626" });
    expect(where).toMatchObject({ side: "left" });
  });

  it("follows style, layout, text size and direction", () => {
    const [text] = maps(`#mindmap(style: "text-focused", layout: "right", text-size: 9pt)[A
  - B
  - C
]`);
    expect(text).toMatchObject({ style: "text-focused", layout: "right", size: 9 });
    expect(text?.root.children?.map((c) => [c.color, c.side])).toEqual([
      ["#475569", "right"],
      ["#475569", "right"],
    ]);
    const [rtl] = maps(`#set text(lang: "ar")
#mindmap(layout: "right")[الماء
  - ب
]`);
    expect(rtl).toMatchObject({ dir: "rtl" });
    expect(rtl?.root.children?.[0]?.side).toBe("left");
  });

  it("keeps a collapsed node's branches, and an image's path and caption", () => {
    const [map] = maps(`#mindmap[A
  - #topic(collapsed: true, image: image("leaf.png", alt: "A leaf"))[B]
    - C
    - D
]`);
    const b = map?.root.children?.[0];
    expect(b).toMatchObject({ collapsed: true, image: { src: "leaf.png", alt: "A leaf" } });
    expect(b?.children?.map((c) => c.label)).toEqual(["C", "D"]);
  });

  it("drops what a stream cut leaves of options, and empty items", () => {
    const [map] = maps(`#mindmap(style: "text-fo", layout: "ri", text-size: 1)[X
  - #topic(color: "#16", weight: "bo", size: 1)[a]
  - #topic()
  -
]`);
    expect(map).toMatchObject({ style: "visual", layout: "both", size: 4 });
    expect(map?.root.children).toEqual([{ label: "a", color: "#2563eb", size: 4, weight: "bold", side: "right" }]);
  });

  it("writes no marker for an empty map", () => {
    expect(maps("#mindmap[]\n#mindmap()\n#mindmap[ ]")).toEqual([]);
    expect(problems(compilePaged(engine, "#mindmap[]").diagnostics)).toEqual([]);
  });

  it("is rejected by the spec when it isn't the shape the Typst side writes", () => {
    const node = { label: "a", color: "#000000", size: 10, weight: "bold" };
    const ok = { v: 1, style: "visual", layout: "both", dir: "ltr", size: 11, root: node };
    expect(parseMindMap(ok)).toEqual(ok);
    for (const bad of [
      null,
      "x",
      { ...ok, v: 2 },
      { ...ok, size: Number.POSITIVE_INFINITY },
      { ...ok, root: { ...node, color: "red" } },
      { ...ok, root: { ...node, color: "#000000;background:url(x)" } },
      { ...ok, root: { ...node, weight: 1000 } },
      { ...ok, root: { ...node, label: 3 } },
      { ...ok, root: { ...node, children: {} } },
      { ...ok, root: { ...node, children: [{}] } },
    ])
      expect(parseMindMap(bad), JSON.stringify(bad)).toBeUndefined();
    // Too many nodes.
    const wide = { ...node, children: Array.from({ length: 2001 }, () => node) };
    expect(parseMindMap({ ...ok, root: wide })).toBeUndefined();
    // Unknown fields and values are dropped or set to their defaults.
    expect(parseMindMap({ ...ok, style: "?", extra: 1, root: { ...node, side: "up", collapsed: "yes" } })).toEqual(ok);
  });
});

describe("streaming", () => {
  it.each(documents)("compiles every healed prefix of the $title in both targets", ({ source }) => {
    const failures: string[] = [];
    for (let end = 1; end <= source.length; end++) {
      const healed = heal(source.slice(0, end)).source;
      for (const [target, diagnostics] of [
        ["html", compileHtml(engine, healed).diagnostics],
        ["paged", compilePaged(engine, healed).diagnostics],
      ] as const) {
        const errors = diagnostics.filter((d) => d.severity === "error");
        if (errors.length)
          failures.push(`${target} @${end} ${JSON.stringify(healed.slice(-40))}: ${errors[0]?.message}`);
      }
    }
    expect(failures.slice(0, 10)).toEqual([]);
  });
});
