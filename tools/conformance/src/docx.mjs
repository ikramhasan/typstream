// The DOCX half of the conformance suite (#135): a plugin's examples exported as an app exports them (healed in final
// mode, the plugins' preambles, files and packages, @typstream/node's engine with the layout profile), to Typst's PDF
// and to DOCX, the DOCX laid out by LibreOffice (or ONLYOFFICE) and compared with the PDF (compare.mjs), and checked
// by Microsoft's validator.
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolvePlugins } from "@typstream/core";
import { writeDocx } from "@typstream/docx";
import { heal } from "@typstream/heal";
import { render, renderDocxModel } from "@typstream/node";
import { beforeAll, describe, expect, it } from "vitest";
import { COLOUR_TOLERANCE } from "./colour.mjs";
import { compareExport, OTHER_SCRIPT } from "./compare.mjs";
import { INK_TOLERANCE } from "./ink.mjs";
import { DRIFT_TOLERANCE } from "./lines.mjs";
import { layOut, packageFiles, VALIDATOR, validate } from "./office.mjs";
import { TOLERANCE } from "./pixels.mjs";

/** @typedef {import("./docx.d.mts").ConformanceSuite} ConformanceSuite */
/** @typedef {import("./docx.d.mts").DocxResult} DocxResult */

/** A file name for an example: its name's letters and digits. */
const slug = (name, taken) => {
  const base = name.replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "") || "example";
  let s = base;
  for (let i = 2; taken.has(s); i++) s = `${base}-${i}`;
  taken.add(s);
  return s;
};

/**
 * Exports every example of `suite` and compares it with Typst's PDF: a result per example, by name.
 * @param {ConformanceSuite} suite
 * @param {{ engine?: "libreoffice" | "onlyoffice", validator?: string | false, out?: string }} [options]
 * @returns {Promise<Map<string, DocxResult>>}
 */
export const checkDocx = async (suite, options = {}) => {
  const out = options.out ?? join(tmpdir(), "typstream-conformance", suite.name);
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  const plugins = resolvePlugins(suite.plugins);
  const preamble = plugins.map((p) => p.engine?.preamble ?? "").join("") || undefined;
  const files = Object.assign(
    packageFiles(plugins.flatMap((p) => p.engine?.packages ?? [])),
    ...plugins.map((p) => p.engine?.files ?? {}),
  );
  const handlers = plugins.flatMap((p) => p.heal?.handlers ?? []);
  const lint = Object.assign({}, ...plugins.map((p) => p.heal?.lint ?? {}));
  const results = new Map();
  const exported = [];
  const taken = new Set();
  for (const example of suite.examples) {
    // What an engine exports: the document healed in final mode, lint fixes included (the layout profile's among them).
    const text = heal(example.source, { final: true, handlers, lint }).source;
    const opts = { preamble, files: { ...files, ...example.files }, inputs: example.inputs };
    const [pdf, docx] = await Promise.all([render(text, "pdf", opts), renderDocxModel(text, opts)]);
    if (!pdf.ok || !docx.ok) {
      const errors = (pdf.ok ? docx : pdf).diagnostics.filter((d) => d.severity === "error");
      results.set(example.name, { error: errors.map((d) => d.message).join("; ") || "no model" });
      continue;
    }
    const name = slug(example.name, taken);
    const typst = join(out, `${name}.typst.pdf`);
    const file = join(out, `${name}.docx`);
    writeFileSync(typst, pdf.data);
    writeFileSync(file, writeDocx(docx.model, docx.fonts, docx.pictures));
    exported.push({ example, typst, file, model: docx.model, scripts: OTHER_SCRIPT.test(example.source) });
  }
  const pdfs = layOut(
    exported.map((e) => e.file),
    { out: join(out, options.engine ?? "libreoffice"), engine: options.engine },
  );
  const validator = options.validator ?? VALIDATOR;
  const invalid =
    validator && exported.length
      ? validate(
          exported.map((e) => e.file),
          validator,
        )
      : {};
  for (const [i, { example, typst, file, model, scripts }] of exported.entries()) {
    const pdf = pdfs[i];
    if (!pdf) {
      results.set(example.name, { error: `${options.engine ?? "LibreOffice"} didn't lay it out`, file });
      continue;
    }
    results.set(example.name, {
      file,
      typst,
      pdf,
      invalid: invalid[file.split("/").at(-1)] ?? null,
      ...compareExport(typst, pdf, model, { scripts }),
    });
  }
  return results;
};

/** Whether `r` is laid out as Typst's PDF, equations aside: every line and page alike. */
const identical = (r) => r.same === r.lines && r.pageStartsSame === r.pageStarts && r.pages[0] === r.pages[1];

/**
 * The suite's DOCX tests, in vitest (Node): for each example, a valid DOCX that a layout engine lays out as Typst's
 * PDF, its pictures within the paged view's pixel tolerance and its equations whole. See docx.d.mts.
 * @param {ConformanceSuite} suite
 * @param {import("./docx.d.mts").DocxConformanceOptions} [options]
 */
export const docxConformance = (suite, options = {}) => {
  const engine = options.engine ?? (process.env.TYPSTREAM_DOCX_ENGINE === "onlyoffice" ? "onlyoffice" : "libreoffice");
  // Microsoft's validator where it is built; CI builds it, so there a missing one fails.
  const validator = existsSync(VALIDATOR) ? VALIDATOR : process.env.CI ? VALIDATOR : false;
  const mathLines = options.mathLines ?? 0.95;
  /** @type {Map<string, DocxResult>} */
  let results;
  describe(`${suite.name}: DOCX = PDF (${engine})`, () => {
    beforeAll(async () => {
      results = await checkDocx(suite, { engine, validator });
    }, 900_000);

    it.for(suite.examples.map((e) => e.name))("%s", (name) => {
      const r = results.get(name);
      if (!r || r.error) throw new Error(r?.error ?? "not exported");
      const where = `${name} (${r.file})`;
      if (validator) expect(r.invalid, `${where}: Microsoft's validator`).toBeNull();
      expect(
        r.pictures.filter((p) => p.cluster > TOLERANCE),
        `${where}: pictures off by more than ${TOLERANCE} pixels touching`,
      ).toEqual([]);
      if (r.math) expect(r.math.same, `${where}: equations' letters and digits`).toBe(r.math.chars);
      if (r.math) expect(r.math.missing, `${where}: operands the equations' math drew as missing ("¿")`).toBe(0);
      // Every line and page as Typst's; with equations, which each engine sets its own way (#132), the suite's share.
      if (!r.math) {
        expect(
          { lines: r.same, pages: r.pages[1], starts: r.pageStartsSame },
          `${where}: first difference ${JSON.stringify(r.first)}`,
        ).toEqual({
          lines: r.lines,
          pages: r.pages[0],
          starts: r.pageStarts,
        });
      }
      // Rules, borders, shading and blanks' lines, where the lines are all where Typst has them.
      if (r.ink && identical(r))
        expect(
          r.ink.cluster,
          `${where}: ink besides text on page ${r.ink.page + 1} at ${JSON.stringify(r.ink.box)}`,
        ).toBeLessThanOrEqual(INK_TOLERANCE);
      // Every word in its colours: a highlight, a shaded box or a coloured word, which the rest don't see.
      expect(
        r.colours.differing,
        `${where}: colours more than ${COLOUR_TOLERANCE} apart, first ${JSON.stringify(r.colours.first)}`,
      ).toBe(0);
      // And each line where Typst set it: the same lines a gap lower, or beside a label Word moved, would pass.
      if (r.drift && identical(r))
        expect(
          r.drift.distance,
          `${where}: line ${JSON.stringify(r.drift.text)} on page ${r.drift.page} moved by ${r.drift.dx.toFixed(1)}, ${r.drift.dy.toFixed(1)} pt`,
        ).toBeLessThanOrEqual(DRIFT_TOLERANCE);
    });

    it(`keeps ${Math.round(mathLines * 100)}% of the lines of examples with equations`, () => {
      const math = [...results.values()].filter((r) => !r.error && r.math);
      const lines = math.reduce((n, r) => n + r.lines, 0);
      const same = math.reduce((n, r) => n + r.same, 0);
      const detail = math
        .filter((r) => r.same < r.lines)
        .map((r) => `${r.file}: ${r.same}/${r.lines}, first difference ${JSON.stringify(r.first)}`);
      expect(lines ? same / lines : 1, detail.join("\n")).toBeGreaterThanOrEqual(mathLines);
    });
  });
};
