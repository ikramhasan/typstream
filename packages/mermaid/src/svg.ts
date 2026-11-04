// pele's SVG as Typst draws it: the shapes stay an SVG image, the text comes out as labels that
// Typst sets itself. A browser draws an SVG image's text in its own fonts (an image can't use the
// page's), and Typst's SVG reader would set it in another face than the one pele measured; as
// Typst text, labels are the same on pages, in the HTML target, the PDF and a DOCX export, and
// can be selected and searched.
//
// pele themes with CSS variables (`fill="var(--_s)"`, the root's `--_s:var(--pele-surface,#f3f3f3)`),
// which Typst's SVG reader doesn't know: they are resolved to their values here. The output is
// pele's own, a small regular subset of SVG (attributes in double quotes, text escaped as entities),
// so a tokenizer reads it; anything it doesn't recognise passes through untouched.

/** A label: one line of a `<text>`, positioned as Typst places it. */
export interface Label {
  /** Its anchor point, in the diagram's units (pele's pixels), after every transform. */
  x: number;
  y: number;
  /** Rotation about the anchor, in degrees. */
  rotate: number;
  /** Which part of the text sits at `x`. */
  anchor: "start" | "middle" | "end";
  /** Font size, in the diagram's units. */
  size: number;
  /** Font weight, 100 to 900. */
  weight: number;
  italic: boolean;
  /** Set in the monospace face. */
  mono: boolean;
  /** `#rgb`, `#rrggbb` or with alpha. */
  fill: string;
  text: string;
}

/** The colours pele's variables fall back to, overridden by name (`--pele-fg`, `--pele-series-1`, …). */
export type Theme = Readonly<Record<string, string>>;

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

const decode = (s: string): string =>
  s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) =>
    e[0] === "#"
      ? String.fromCodePoint(e[1] === "x" || e[1] === "X" ? Number.parseInt(e.slice(2), 16) : Number(e.slice(1)))
      : (ENTITIES[e] ?? m),
  );

const attributes = (s: string): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const m of s.matchAll(/([\w:-]+)="([^"]*)"/g)) out[m[1] as string] = m[2] as string;
  return out;
};

type Matrix = [number, number, number, number, number, number];
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

const multiply = (a: Matrix, b: Matrix): Matrix => [
  a[0] * b[0] + a[2] * b[1],
  a[1] * b[0] + a[3] * b[1],
  a[0] * b[2] + a[2] * b[3],
  a[1] * b[2] + a[3] * b[3],
  a[0] * b[4] + a[2] * b[5] + a[4],
  a[1] * b[4] + a[3] * b[5] + a[5],
];

/** An SVG `transform` attribute as a matrix: translate, scale, rotate (about a point) and matrix. */
const transform = (t: string): Matrix => {
  let m = IDENTITY;
  for (const [, op, args] of t.matchAll(/(\w+)\(([^)]*)\)/g)) {
    const n = (args as string)
      .split(/[\s,]+/)
      .filter(Boolean)
      .map(Number);
    const [a = 0, b, c] = n;
    if (op === "translate") m = multiply(m, [1, 0, 0, 1, a, b ?? 0]);
    else if (op === "scale") m = multiply(m, [a, 0, 0, b ?? a, 0, 0]);
    else if (op === "rotate") {
      const r = (a * Math.PI) / 180;
      const [cos, sin] = [Math.cos(r), Math.sin(r)];
      const [cx, cy] = [b ?? 0, c ?? 0];
      m = multiply(multiply(multiply(m, [1, 0, 0, 1, cx, cy]), [cos, sin, -sin, cos, 0, 0]), [1, 0, 0, 1, -cx, -cy]);
    } else if (op === "matrix" && n.length === 6) m = multiply(m, n as Matrix);
  }
  return m;
};

const COLOR = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

const weight = (w: string): number => {
  if (w === "bold" || w === "bolder") return 700;
  const n = Number(w);
  return Number.isFinite(n) && n >= 100 && n <= 900 ? n : 400;
};

/** What a `<text>` inherits from the elements around it. */
interface Inherited {
  m: Matrix;
  fill: string;
  size: number;
  weight: number;
  italic: boolean;
  anchor: Label["anchor"];
  mono: boolean;
}

const round = (n: number): number => Math.round(n * 100) / 100;

/**
 * Splits pele's SVG into the shapes, with its CSS variables resolved, and its text as labels.
 * `theme` overrides pele's variables by name.
 */
export const splitText = (svg: string, theme: Theme = {}): { svg: string; labels: Label[] } => {
  const head = /^<svg((?:\s+[\w:-]+="[^"]*")*)\s*>/.exec(svg);
  const root = attributes(head?.[1] ?? "");
  // The root's own variables: `--_fg:var(--pele-fg,#1f1f1f)` and so on.
  const locals: Record<string, string> = {};
  for (const [, name, value] of (root.style ?? "").matchAll(/(--[\w-]+):([^;]*)/g))
    locals[name as string] = value as string;
  const resolve = (value: string, depth = 0): string =>
    depth > 8
      ? value
      : value.replace(/var\((--[\w-]+)(?:,((?:[^()]|\([^()]*\))*))?\)/g, (_, name: string, fallback?: string) => {
          const v = theme[name] ?? locals[name] ?? fallback;
          return v === undefined ? "" : resolve(v.trim(), depth + 1);
        });
  const fg = resolve("var(--_fg)") || "#000";
  const color = (value: string): string => {
    const v = resolve(value).trim();
    return COLOR.test(v) ? v : fg;
  };

  const labels: Label[] = [];
  const stack: Inherited[] = [
    { m: IDENTITY, fill: fg, size: 16, weight: 400, italic: false, anchor: "start", mono: false },
  ];
  /** The `<text>` being read: its lines, the last one getting the characters. */
  let text: { lines: Label[]; at: { x: number; y: number } } | null = null;
  let out = "";
  const token = /<(\/?)([a-zA-Z][\w:-]*)((?:\s+[\w:-]+="[^"]*")*)\s*(\/?)>|<!--[\s\S]*?-->|([^<]+)/g;
  for (let m = token.exec(svg); m; m = token.exec(svg)) {
    const [all, close, tag, attrs, self, chars] = m;
    if (tag === undefined) {
      if (text && chars !== undefined) (text.lines.at(-1) as Label).text += decode(chars);
      else out += all;
      continue;
    }
    if (close) {
      stack.pop();
      if (tag === "text" && text) {
        for (const line of text.lines) {
          line.text = line.text.replace(/\s+/g, " ").trim();
          if (line.text) labels.push(line);
        }
        text = null;
      } else if (!text) out += all;
      continue;
    }
    const a = attributes(attrs ?? "");
    const parent = stack.at(-1) as Inherited;
    const own: Inherited = { ...parent };
    if (a.transform) own.m = multiply(parent.m, transform(a.transform));
    if (a.fill) own.fill = color(a.fill);
    if (a["font-size"]) own.size = Number(resolve(a["font-size"])) || parent.size;
    if (a["font-weight"]) own.weight = weight(resolve(a["font-weight"]).trim());
    if (a["font-style"]) own.italic = a["font-style"] === "italic" || a["font-style"] === "oblique";
    if (a["text-anchor"])
      own.anchor = a["text-anchor"] === "middle" || a["text-anchor"] === "end" ? a["text-anchor"] : "start";
    if (a["font-family"]) own.mono = /--_fm|mono/.test(a["font-family"]);
    if (tag === "text" || tag === "tspan") {
      // A tspan with a position starts a line; one without continues the line it is in.
      const x: number = Number(a.x ?? text?.at.x ?? 0);
      const y: number = Number(a.y ?? text?.at.y ?? 0);
      const [m0, m1, m2, m3, m4, m5] = own.m;
      const line: Label = {
        x: round(m0 * x + m2 * y + m4),
        y: round(m1 * x + m3 * y + m5),
        rotate: round((Math.atan2(m1, m0) * 180) / Math.PI),
        anchor: own.anchor,
        size: round(own.size * Math.hypot(m0, m1)),
        weight: own.weight,
        italic: own.italic,
        mono: own.mono,
        fill: own.fill,
        text: "",
      };
      if (tag === "text" || !text) text = { lines: [line], at: { x, y } };
      else if (a.x !== undefined || a.y !== undefined) {
        text.lines.push(line);
        text.at = { x, y };
      }
      if (!self) stack.push(own);
      continue;
    }
    if (text) {
      if (!self) stack.push(own);
      continue;
    }
    let element = all.replace(/="([^"]*var\([^"]*)"/g, (_, v: string) => `="${resolve(v)}"`);
    if (stack.length === 1 && tag === "svg") {
      // Its style held the variables and fonts; `color` is what `currentColor` (icons) draws in.
      element = element.replace(/\s+style="[^"]*"/, "").replace(/^<svg/, `<svg color="${fg}"`);
    } else {
      // A corner radius as CSS, which Typst's SVG reader doesn't read.
      element = element.replace(/\s+style="rx:\s*([\d.]+)(?:px)?;?"/, ' rx="$1"');
    }
    out += element;
    if (!self) stack.push(own);
  }
  return { svg: out, labels };
};
