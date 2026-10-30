// Generated documents through Typst's parser: whatever the teacher writes (any marks on any text,
// text full of markup characters, lists, equations), the canonical Typst reads back as the same
// value, and writing it again changes nothing.
import fc from "fast-check";
import { beforeAll, describe, expect, it } from "vitest";
import {
  normalizeInlines,
  serializeValue,
  type TypstBlock,
  TypstDocument,
  type TypstInline,
  type TypstMarks,
  type TypstText,
  type TypstValue,
} from "../src/index";
import { loadParser } from "./support/syntax";
import { withoutIds } from "./support/values";

beforeAll(loadParser);

const RUNS = Number(process.env.EDITOR_PROPERTY_RUNS ?? 300);

// Characters and sequences Typst's markup lexer treats specially, and some that it doesn't.
const ATOMS = [
  ..."abcXYZ019éß中بअ😀",
  ..."*_`$#<>@[]\\~-./=+:'\"();,!?{}",
  "http://",
  "https://x.y",
  "...",
  "--",
  "---",
  "-?",
  "-1",
  "//",
  "/*",
  "*/",
  "1.",
  "u{41}",
  "h",
];

/** Text without spaces at its ends or two in a row, and no line break next to a space. */
const word = fc.array(fc.constantFrom(...ATOMS), { minLength: 1, maxLength: 4 }).map((parts) => parts.join(""));
const plain = fc
  .array(fc.tuple(word, fc.constantFrom(" ", " ", "", "\n")), { minLength: 1, maxLength: 4 })
  .map((parts) => parts.map(([w, sep], i) => (i < parts.length - 1 ? w + sep : w)).join(""));

const COLORS = ["#e11d48", "#2563eb"];
const marks: fc.Arbitrary<TypstMarks> = fc.record(
  {
    bold: fc.constant(true),
    italic: fc.constant(true),
    underline: fc.constant(true),
    strikethrough: fc.constant(true),
    subscript: fc.constant(true),
    superscript: fc.constant(true),
    highlight: fc.constant(true),
    color: fc.constantFrom(...COLORS),
    backgroundColor: fc.constantFrom(...COLORS),
    fontSize: fc.constantFrom("12pt", "14.5pt"),
  },
  { requiredKeys: [] },
);

const text: fc.Arbitrary<TypstText> = fc.oneof(
  { weight: 4, arbitrary: fc.tuple(plain, marks).map(([t, m]) => ({ text: t, ...m })) },
  // Raw text is literal: anything but a line break goes, spaces included.
  {
    weight: 1,
    arbitrary: fc
      .tuple(fc.string({ minLength: 1, maxLength: 6 }), marks)
      .map(([t, m]) => ({ text: t, ...m, code: true })),
  },
);

const voidText = marks.map((m) => [{ text: "", ...m }] as [TypstText]);
const inline: fc.Arbitrary<TypstInline> = fc.oneof(
  { weight: 6, arbitrary: text },
  {
    weight: 1,
    arbitrary: fc
      .tuple(fc.constantFrom("x^2", "a + b", "sqrt(2)"), voidText)
      .map(([math, children]) => ({ type: "typst_inline_equation" as const, math, children })),
  },
  {
    weight: 1,
    arbitrary: fc
      .tuple(fc.constantFrom("#blank()", "@fig", "#h(1em)", "#sym.arrow"), voidText)
      .map(([source, children]) => ({ type: "typst_inline_code" as const, source, children })),
  },
  {
    weight: 1,
    arbitrary: fc
      .tuple(
        fc.constantFrom("https://typst.app", "https://a.b/c?d=(e)"),
        fc.array(
          text.filter((t) => !t.code),
          { minLength: 1, maxLength: 2 },
        ),
      )
      .map(([url, children]) => ({ type: "a" as const, url, children })),
  },
);

/** Spaces between inlines as Typst keeps them: one, and none at the ends. */
const tidy = (children: TypstInline[]): TypstInline[] => {
  const out = normalizeInlines(children);
  return out.every((c) => !("type" in c) && c.text === "") ? [{ text: "x" }] : out;
};
const inlines = fc.array(inline, { minLength: 1, maxLength: 5 }).map(tidy);

const block: fc.Arbitrary<TypstBlock> = fc.oneof(
  { weight: 4, arbitrary: inlines.map((children) => ({ type: "p" as const, children })) },
  {
    weight: 1,
    arbitrary: fc
      .tuple(
        fc.constantFrom("h1", "h2", "h3"),
        inlines.filter((c) => !JSON.stringify(c).includes("\\n")),
      )
      .map(([type, children]) => ({ type, children })),
  },
  { weight: 1, arbitrary: inlines.map((children) => ({ type: "blockquote" as const, children })) },
  {
    weight: 1,
    arbitrary: fc
      .constantFrom<TypstBlock["type"]>("hr", "typst_pagebreak")
      .map((type) => ({ type, children: [{ text: "" }] }) as TypstBlock),
  },
  {
    weight: 1,
    arbitrary: fc
      .constantFrom("x^2", "sum_(i=1)^n i")
      .map((math) => ({ type: "typst_equation" as const, math, children: [{ text: "" }] as [TypstText] })),
  },
  {
    weight: 1,
    arbitrary: fc
      .tuple(
        fc.option(fc.constantFrom("py", "typ")),
        fc.array(
          fc.string({ maxLength: 8 }).filter((l) => !l.includes("\n") && l.trim() === l),
          { minLength: 1, maxLength: 3 },
        ),
      )
      .map(([lang, lines]) => ({
        type: "code_block" as const,
        ...(lang ? { lang } : {}),
        children: lines.map((line) => ({ type: "code_line" as const, children: [{ text: line }] as [TypstText] })),
      })),
  },
);

/** List items, each at most one level deeper than the one before. */
const list = fc
  .array(fc.tuple(fc.constantFrom<"disc" | "decimal">("disc", "decimal"), fc.integer({ min: 0, max: 1 }), inlines), {
    minLength: 1,
    maxLength: 4,
  })
  .map((items) => {
    let indent = 0;
    return items.map(([listStyleType, deeper, children]) => {
      indent = indent === 0 ? 1 : Math.max(1, indent + deeper - (deeper === 0 ? 1 : 0));
      return { type: "p" as const, listStyleType, indent, children } satisfies TypstBlock;
    });
  });

const document = fc
  .array(fc.oneof({ weight: 3, arbitrary: block.map((b) => [b]) }, { weight: 1, arbitrary: list }), {
    minLength: 1,
    maxLength: 5,
  })
  .map((parts) => parts.flat() as TypstValue);

/**
 * What Typst reads back: a paragraph that is only a call (`#blank()`) is that call on its own line,
 * which the editor reads as a code block. Typst lays out both alike.
 */
const expected = (value: TypstValue): TypstValue =>
  value.map((block) => {
    if (block.type !== "p" || block.listStyleType) return block;
    const content = block.children.filter((c) => "type" in c || c.text !== "");
    const only = content[0];
    if (content.length !== 1 || !only || !("type" in only) || only.type !== "typst_inline_code") return block;
    if (!only.source.startsWith("#")) return block;
    if (Object.keys(only.children[0]).length > 1) return block;
    const call = /^#([\w-]+)\(/.exec(only.source)?.[1];
    return {
      type: "typst_code",
      source: only.source,
      role: "content",
      ...(call ? { call } : {}),
      children: [{ text: "" }],
    };
  });

describe("properties", () => {
  it("canonical Typst reads back as the same value", () => {
    fc.assert(
      fc.property(document, (value) => {
        const source = serializeValue(value);
        const read = new TypstDocument(source).value;
        expect(withoutIds(read)).toEqual(withoutIds(expected(value)));
        expect(serializeValue(read)).toBe(source);
      }),
      { numRuns: RUNS },
    );
  });

  it("changing one block changes only its source", () => {
    fc.assert(
      fc.property(document, fc.nat(), inlines, (value, pick, children) => {
        const doc = new TypstDocument(serializeValue(value));
        const index = pick % doc.value.length;
        const target = doc.value[index] as TypstBlock;
        if (target.type !== "p" || target.listStyleType) return;
        const range = target.id ? doc.rangeOf(target.id) : undefined;
        const before = doc.source;
        const edited = doc.value.map((b, i) => (i === index ? { ...b, children } : b)) as TypstValue;
        const edit = doc.update(edited);
        if (!edit || !range) return;
        expect(edit.from).toBeGreaterThanOrEqual(range.from);
        expect(edit.to).toBeLessThanOrEqual(range.to);
        expect(before.slice(0, range.from)).toBe(doc.source.slice(0, range.from));
      }),
      { numRuns: RUNS },
    );
  });
});
