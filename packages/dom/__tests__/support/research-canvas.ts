/// <reference lib="dom" />
// #14 canvas research: a page's drawing as a list of operations, parsed from
// typst-svg's output (what engine-wasm would send instead of SVG), and a
// painter for a 2D context. Shared by research.test.ts and its paint worker.

export type Op =
  | { t: "push"; m: [number, number, number, number, number, number] }
  | { t: "pop" }
  | { t: "glyph"; id: string; x: number; y: number; fill: string }
  | {
      t: "path";
      d: string;
      fill: string | null;
      stroke: string | null;
      width: number;
      cap: CanvasLineCap;
      join: CanvasLineJoin;
      miter: number;
    };

export interface PageOps {
  width: number;
  height: number;
  ops: Op[];
  /** Glyph outlines the page uses: id → path data. */
  glyphs: [string, string][];
  /** Elements the painter doesn't handle (images, gradients, clip paths, …). */
  unsupported: string[];
}

/** Parses one typst-svg page into operations (setup, not timed). */
export const opsOf = (svg: string): PageOps => {
  const root = new DOMParser().parseFromString(svg, "image/svg+xml").documentElement as unknown as SVGSVGElement;
  const box = root.viewBox.baseVal;
  const page: PageOps = { width: box.width, height: box.height, ops: [], glyphs: [], unsupported: [] };
  const walk = (el: Element) => {
    for (const child of el.children) {
      const name = child.localName;
      if (name === "defs") {
        for (const symbol of child.querySelectorAll("symbol")) {
          const path = symbol.querySelector("path");
          if (path && symbol.children.length === 1) page.glyphs.push([symbol.id, path.getAttribute("d") ?? ""]);
          else page.unsupported.push("symbol");
        }
      } else if (name === "g" || name === "a") {
        const list = (child as SVGGElement).transform?.baseVal;
        const m = list && list.numberOfItems > 0 ? list.consolidate()?.matrix : null;
        if (m) page.ops.push({ t: "push", m: [m.a, m.b, m.c, m.d, m.e, m.f] });
        walk(child);
        if (m) page.ops.push({ t: "pop" });
      } else if (name === "use") {
        const id = (child.getAttribute("xlink:href") ?? child.getAttribute("href") ?? "").slice(1);
        page.ops.push({
          t: "glyph",
          id,
          x: Number(child.getAttribute("x") ?? 0),
          y: Number(child.getAttribute("y") ?? 0),
          fill: child.getAttribute("fill") ?? "#000000",
        });
      } else if (name === "path") {
        const list = (child as SVGPathElement).transform.baseVal;
        const m = list.numberOfItems > 0 ? list.consolidate()?.matrix : null;
        if (m) page.ops.push({ t: "push", m: [m.a, m.b, m.c, m.d, m.e, m.f] });
        const fill = child.getAttribute("fill");
        page.ops.push({
          t: "path",
          d: child.getAttribute("d") ?? "",
          fill: fill === "none" ? null : (fill ?? "#000000"),
          stroke: child.getAttribute("stroke"),
          width: Number(child.getAttribute("stroke-width") ?? 1),
          cap: (child.getAttribute("stroke-linecap") ?? "butt") as CanvasLineCap,
          join: (child.getAttribute("stroke-linejoin") ?? "miter") as CanvasLineJoin,
          miter: Number(child.getAttribute("stroke-miterlimit") ?? 4),
        });
        if (m) page.ops.push({ t: "pop" });
      } else page.unsupported.push(name);
    }
  };
  walk(root);
  return page;
};

/** Glyph outlines, built once per id and shared by every page. */
export class GlyphCache {
  paths = new Map<string, Path2D>();
  add(glyphs: [string, string][]) {
    for (const [id, d] of glyphs) if (!this.paths.has(id)) this.paths.set(id, new Path2D(d));
  }
}

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/** Paints `page` at `scale` device pixels per point. */
export const paint = (ctx: Ctx, page: PageOps, glyphs: GlyphCache, scale: number) => {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  let fill = "";
  for (const op of page.ops) {
    switch (op.t) {
      case "push":
        ctx.save();
        ctx.transform(...op.m);
        break;
      case "pop":
        ctx.restore();
        fill = "";
        break;
      case "glyph": {
        const path = glyphs.paths.get(op.id);
        if (!path) break;
        if (op.fill !== fill) ctx.fillStyle = fill = op.fill;
        ctx.translate(op.x, op.y);
        ctx.fill(path);
        ctx.translate(-op.x, -op.y);
        break;
      }
      case "path": {
        const path = new Path2D(op.d);
        if (op.fill) {
          ctx.fillStyle = fill = op.fill;
          ctx.fill(path);
        }
        if (op.stroke) {
          ctx.strokeStyle = op.stroke;
          ctx.lineWidth = op.width;
          ctx.lineCap = op.cap;
          ctx.lineJoin = op.join;
          ctx.miterLimit = op.miter;
          ctx.stroke(path);
        }
        break;
      }
    }
  }
};

/** Like {@link paint}, but glyphs go into one Path2D per fill colour (addPath), filled once each. */
export const paintBatched = (ctx: Ctx, page: PageOps, glyphs: GlyphCache, scale: number) => {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  const stack: DOMMatrix[] = [new DOMMatrix()];
  const batches = new Map<string, Path2D>();
  for (const op of page.ops) {
    const top = stack[stack.length - 1] as DOMMatrix;
    if (op.t === "push") stack.push(top.multiply(new DOMMatrix(op.m)));
    else if (op.t === "pop") stack.pop();
    else if (op.t === "glyph") {
      const path = glyphs.paths.get(op.id);
      if (!path) continue;
      const batch = batches.get(op.fill) ?? new Path2D();
      batches.set(op.fill, batch);
      batch.addPath(path, top.translate(op.x, op.y));
    } else {
      ctx.save();
      ctx.transform(top.a, top.b, top.c, top.d, top.e, top.f);
      const path = new Path2D(op.d);
      if (op.fill) {
        ctx.fillStyle = op.fill;
        ctx.fill(path);
      }
      if (op.stroke) {
        ctx.strokeStyle = op.stroke;
        ctx.lineWidth = op.width;
        ctx.stroke(path);
      }
      ctx.restore();
    }
  }
  for (const [fill, path] of batches) {
    ctx.fillStyle = fill;
    ctx.fill(path);
  }
};
