// Writes the generated part of the adversarial set (documents too big or too
// regular to write by hand). Deterministic: re-running it reproduces the
// committed files byte for byte. `pnpm --filter @typstream/corpus generate`.
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const dir = fileURLToPath(new URL("../adversarial/", import.meta.url));
const write = (name, text) => {
  writeFileSync(`${dir}${name}.typ`, text);
  console.log(`${name}.typ: ${text.length} UTF-16 units`);
};

/** mulberry32, the same PRNG the stream synthesizer uses. */
const prng = (seed) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};
const random = prng(12);
const pick = (xs) => xs[Math.floor(random() * xs.length)];
const int = (lo, hi) => lo + Math.floor(random() * (hi - lo + 1));

// 1. Nesting far past Typst's parser depth limit (256) in markup, code and math.
write(
  "deep-nesting-10k",
  `// 10,000 levels in each mode. Typst rejects these with "maximum parsing depth exceeded".\n\n` +
    `${"#[".repeat(10_000)}deep markup${"]".repeat(10_000)}\n\n` +
    `#${"(".repeat(10_000)}1${")".repeat(10_000)}\n\n` +
    `$${"(".repeat(10_000)}x${")".repeat(10_000)}$\n`,
);

// 2. Deep but legal: 64 levels alternating markup and code, plus 60 math groups.
// Typst counts every node on the way down, so ~70 such levels hit the limit.
{
  let open = "";
  let close = "";
  for (let i = 0; i < 64; i++) {
    const kind = i % 4;
    if (kind === 0) {
      open += "#box[";
      close = `]${close}`;
    } else if (kind === 1) {
      open += "#text(fill: blue)[*";
      close = `*]${close}`;
    } else if (kind === 2) {
      open += "#{ [";
      close = `] }${close}`;
    } else {
      open += "#emph[";
      close = `]${close}`;
    }
  }
  write(
    "deep-nesting-64",
    `// 64 nested content blocks mixing markup and code, below Typst's depth limit.\n\n${open}centre $${"(".repeat(60)}x${")".repeat(60)}$${close}\n`,
  );
}

// 3. A ~1 MB document assembled from education-shaped blocks.
{
  const topics = [
    "fractions",
    "photosynthesis",
    "the water cycle",
    "World War I",
    "plate tectonics",
    "algebra",
    "poetry",
    "electricity",
    "ecosystems",
    "probability",
  ];
  const words =
    "the a of to and in that is for on with as was by at from this be are or it an which have not their more one these also can between other been has after into".split(
      " ",
    );
  const nouns =
    "student teacher equation table figure experiment result method sample reaction graph source essay paragraph question answer theory model value".split(
      " ",
    );
  const sentence = () => {
    const n = int(8, 22);
    const out = [];
    for (let i = 0; i < n; i++) out.push(random() < 0.35 ? pick(nouns) : pick(words));
    const s = out.join(" ");
    return `${s[0].toUpperCase()}${s.slice(1)}${pick([".", ".", ".", "?", "!"])}`;
  };
  const inline = () =>
    pick([
      () => ` $x_${int(1, 9)}^${int(2, 4)} + ${int(1, 99)}$`,
      () => ` *${pick(nouns)}*`,
      () => ` _${pick(nouns)}s_`,
      () => ` \`${pick(nouns)}()\``,
      () => ` @sec-${int(1, 40)}`,
      () => `#footnote[${sentence()}]`,
      () => ` (${int(1, 100)}% — “${pick(nouns)}”)`,
      () => "",
    ])();
  const paragraph = () => {
    const n = int(3, 7);
    let p = "";
    for (let i = 0; i < n; i++) p += `${i ? " " : ""}${sentence()}${random() < 0.4 ? inline() : ""}`;
    return p;
  };
  const blocks = [
    () => paragraph(),
    () => paragraph(),
    () => paragraph(),
    () => Array.from({ length: int(2, 5) }, () => `- ${sentence()}`).join("\n"),
    () => Array.from({ length: int(2, 5) }, () => `+ ${sentence()}`).join("\n"),
    () => `$ sum_(k=1)^${int(5, 50)} k^${int(1, 3)} = ${int(10, 9999)} $`,
    () => `$ integral_0^${int(1, 9)} (${int(1, 9)}x^2 + ${int(1, 9)}) dif x = ${int(10, 999)}/${int(2, 9)} $`,
    () => {
      const cols = int(2, 5);
      const rows = int(2, 6);
      const cells = [];
      for (let r = 0; r < rows * cols; r++) cells.push(`[${r < cols ? `*${pick(nouns)}*` : int(0, 999)}]`);
      return `#table(\n  columns: ${cols},\n  ${cells.join(", ")},\n)`;
    },
    () => `\`\`\`python\nfor i in range(${int(2, 20)}):\n    print(i * ${int(2, 9)})\n\`\`\``,
    () => `#figure(rect(width: ${int(20, 90)}%, height: ${int(1, 4)}cm), caption: [${sentence()}])`,
    () => `/ ${pick(nouns)}: ${sentence()}`,
  ];
  let doc = `#set page(numbering: "1")\n#set heading(numbering: "1.1")\n\n#outline()\n\n`;
  for (let section = 1; doc.length < 1_000_000; section++) {
    doc += `= ${topics[section % topics.length]} (part ${section}) <sec-${section}>\n\n`;
    const subs = int(2, 4);
    for (let s = 1; s <= subs; s++) {
      doc += `== ${pick(nouns)} ${section}.${s}\n\n`;
      const n = int(3, 8);
      for (let b = 0; b < n; b++) doc += `${pick(blocks)()}\n\n`;
    }
  }
  write("large-1mb", doc);
}

// 4. A 2,000-row table written out cell by cell, as a model would.
{
  const subjects = ["Maths", "English", "Science", "History", "Art", "Music", "PE", "French"];
  let rows = "";
  for (let i = 1; i <= 2000; i++) {
    rows += `  [${i}], [Student ${String(i).padStart(4, "0")}], [${pick(subjects)}], [${int(0, 100)}], [${pick(["A", "B", "C", "D", "E", "U"])}],\n`;
  }
  write(
    "table-2000-rows",
    `#set page(margin: 1.5cm)\n#set text(size: 8pt)\n\n= Results register\n\n#table(\n  columns: (auto, 1fr, auto, auto, auto),\n  table.header([*\\#*], [*Name*], [*Subject*], [*Score*], [*Grade*]),\n${rows})\n`,
  );
}

// 5. One 200,000-character paragraph on a single line: no block boundaries to resync on.
{
  let line = "";
  const bits = [
    "The quick brown fox jumps over the lazy dog.",
    "*Strong* and _emphasis_ inline.",
    "Math $a^2 + b^2 = c^2$ inline.",
    "A #box[boxed] word.",
    "Unicode: café, naïve, 数学, 😀.",
  ];
  for (let i = 0; line.length < 200_000; i++) line += `${bits[i % bits.length]} `;
  write("single-line-200k", `${line.trimEnd()}\n`);
}

// 6. Zalgo text: base letters loaded with combining marks (U+0300–U+036F).
{
  const zalgo = (text, marks) =>
    [...text]
      .map((ch) =>
        ch === " " ? ch : ch + Array.from({ length: marks }, () => String.fromCodePoint(0x300 + int(0, 0x6f))).join(""),
      )
      .join("");
  write(
    "zalgo-text",
    `= ${zalgo("Zalgo heading", 4)}\n\n${zalgo("This paragraph has a few marks on every letter.", 3)}\n\n${zalgo("And this one has many.", 30)}\n\n*${zalgo("strong", 12)}* _${zalgo("emph", 12)}_ $${zalgo("x", 8)} + 1$\n\n#table(columns: 2, [${zalgo("cell", 20)}], [${zalgo("cell", 50)}])\n`,
  );
}

// 7. Backtick runs of every length 1–40, balanced, plus runs that look unbalanced.
{
  let doc = "// Raw delimiters of every length. Each line is balanced.\n\n";
  for (let n = 1; n <= 40; n++) {
    const fence = "`".repeat(n);
    doc +=
      n === 2
        ? "Empty raw: ``\n\n"
        : n >= 3
          ? `${fence}lang\ncode with ${"`".repeat(n - 1)} inside\n${fence}\n\n`
          : `${fence}code${fence}\n\n`;
  }
  doc += "Inline with inner ticks: ``` a ` b `` c ```\n\nEscaped: \\` not raw \\`\n";
  write("backtick-runs", doc);
}
