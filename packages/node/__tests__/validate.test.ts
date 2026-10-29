import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CORPUS_ROOT, loadCorpus } from "@typstream/corpus";
import { strFromU8, unzipSync } from "fflate";
import { afterAll, describe, expect, it } from "vitest";
import { createEngine, render, validate } from "../src";

const engine = createEngine({ workers: 3 });
afterAll(() => engine.close());

/** Files corpus documents read, by the path they use. */
const corpusFiles = {
  "assets/climate-refs.yml": readFileSync(join(CORPUS_ROOT, "edu/assets/climate-refs.yml")),
};

const pdfPages = (pdf: Uint8Array): number =>
  (
    Buffer.from(pdf)
      .toString("latin1")
      .match(/\/Type\s*\/Page\b/g) ?? []
  ).length;

describe("validate: the corpus", () => {
  const corpus = loadCorpus();

  // Native typst 0.15.1 compiles these (corpus:validate); the wasm engine must agree, page for page.
  for (const entry of corpus.filter((e) => (e.meta.expect ?? "ok") === "ok")) {
    it(`${entry.id} compiles to ${entry.meta.expectedPages} pages`, async () => {
      const r = await validate(entry.source, { engine, files: corpusFiles, lint: false, timeoutMs: 120_000 });
      expect(r.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
      expect(r.ok).toBe(true);
      expect(r.pageCount).toBe(entry.meta.expectedPages);
      const allowed = entry.meta.allowedWarnings ?? [];
      for (const w of r.diagnostics) expect(allowed.some((a) => w.message.includes(a))).toBe(true);
    }, 180_000);
  }

  for (const entry of corpus.filter((e) => e.meta.expect === "error")) {
    it(`${entry.id} reports ${JSON.stringify(entry.meta.expectedErrors)}`, async () => {
      const r = await validate(entry.source, { engine, lint: false });
      expect(r.ok).toBe(false);
      const messages = r.diagnostics.map((d) => d.message).join("\n");
      for (const e of entry.meta.expectedErrors ?? []) expect(messages).toContain(e);
    });
  }

  // Native typst runs these into the time or memory limit. The wasm engine must not hang or
  // take the process down: the watchdog stops it, wasm32's memory cap traps, or Typst gives up.
  for (const entry of corpus.filter((e) => e.meta.expect === "limit")) {
    it(`${entry.id} fails without hanging`, async () => {
      const r = await validate(entry.source, { engine, lint: false, timeoutMs: 2_000 });
      expect(r.ok).toBe(false);
      expect(r.ms).toBeLessThan(10_000);
    });
  }
});

describe("validate", () => {
  it("reports Typst errors with UTF-16 spans and leaves valid documents clean", async () => {
    const ok = await validate("= Fine\nজল 💧 is *water*.", { engine });
    expect(ok).toMatchObject({ ok: true, diagnostics: [], pageCount: 1 });

    const source = "জল 💧 #table(columns: 2, [a]";
    const bad = await validate(source, { engine, lint: false });
    expect(bad.ok).toBe(false);
    const [d] = bad.diagnostics;
    expect(d?.message).toBe("unclosed delimiter");
    expect(d?.span && source.slice(d.span.from, d.span.to)).toBe("(");
    expect(bad.pageCount).toBeUndefined();
  });

  it("adds heal's lint findings as warnings with a concrete fix", async () => {
    const source = "This is **bold** and costs $5 and $10. Mail me@example.com.";
    const r = await validate(source, { engine });
    // Only the email fails to compile; the bold and the prices compile but render wrongly.
    expect(r.diagnostics.filter((d) => d.severity === "error").map((d) => d.message)).toEqual([
      "label `<example.com>` does not exist in the document",
    ]);
    const lint = r.diagnostics.filter((d) => d.source === "heal");
    expect(lint.map((d) => d.code).sort()).toEqual(["currency-dollar", "email-at", "markdown-bold"]);
    const bold = lint.find((d) => d.code === "markdown-bold");
    expect(bold).toMatchObject({ severity: "warning", hints: ["replace `**bold**` with `*bold*`"] });
    expect(bold?.span && source.slice(bold.span.from, bold.span.to)).toBe("**bold**");
    // Heal's "escaped it" describes streaming; here nothing was changed.
    expect(lint.find((d) => d.code === "email-at")).toMatchObject({
      message: "`@` inside a word is read as a reference",
      hints: ["replace `@example.com` with `\\@example.com`"],
    });

    const quiet = await validate(source, { engine, lint: false });
    expect(quiet.diagnostics.some((d) => d.source === "heal")).toBe(false);
    const someOff = await validate(source, { engine, lint: { "currency-dollar": "off" } });
    expect(someOff.diagnostics.some((d) => d.code === "currency-dollar")).toBe(false);
  });

  it("reports Markdown headings both as Typst's error and as a lint fix", async () => {
    const r = await validate("# Heading\nText", { engine });
    expect(r.ok).toBe(false);
    expect(r.diagnostics.find((d) => d.code === "markdown-heading")?.hints).toEqual(["replace `#` with `=`"]);
  });

  it("checks the HTML target on request", async () => {
    const source = '#html.elem("div", attrs: (onclick: 1))[x]';
    expect((await validate(source, { engine, target: "html" })).ok).toBe(false);
  });

  it("applies the preamble, files and inputs, and maps positions back to the text", async () => {
    const r = await validate('#greet(sys.inputs.who)\n#include "part.typ"\n#nope', {
      engine,
      preamble: "#let greet(x) = [Hello #x]",
      files: { "part.typ": "Included." },
      inputs: { who: "class" },
      lint: false,
    });
    expect(r.diagnostics).toMatchObject([{ message: "unknown variable: nope", span: { from: 44, to: 48 } }]);
  });

  it("mounts a local package from files keyed by its spec", async () => {
    const r = await validate('#import "@typstream/demo:0.1.0": greet\n#greet("class")', {
      engine,
      files: {
        "@typstream/demo:0.1.0/typst.toml": '[package]\nname = "demo"\nversion = "0.1.0"\nentrypoint = "lib.typ"\n',
        "@typstream/demo:0.1.0/lib.typ": "#let greet(who) = [Hello, #who!]",
      },
      lint: false,
    });
    expect(r.diagnostics).toEqual([]);
  });

  it("rejects file paths outside the document", async () => {
    await expect(validate("x", { engine, files: { "../etc/passwd": "" } })).rejects.toThrow(/invalid file path/);
    await expect(validate("x", { engine, files: { "main.typ": "" } })).rejects.toThrow(/reserved/);
  });

  it("can't read the server's filesystem", async () => {
    const r = await validate('#read("/etc/passwd")', { engine, lint: false });
    expect(r.diagnostics[0]?.message).toMatch(/file not found/);
  });
});

describe("render", () => {
  it("exports PDF, HTML and SVG", async () => {
    const source = "= Title\nSome $x^2$ math.\n#pagebreak()\nPage two.";
    const pdf = await render(source, "pdf", { engine });
    expect(pdf.ok).toBe(true);
    if (!pdf.ok) return;
    expect(Buffer.from(pdf.data.slice(0, 5)).toString()).toBe("%PDF-");
    expect(pdfPages(pdf.data)).toBe(2);
    expect(pdf.pageCount).toBe(2);

    const html = await render(source, "html", { engine });
    expect(html.ok && html.data).toContain("<h2>Title</h2>");

    const svg = await render(source, "svg", { engine });
    expect(svg.ok && svg.data.length).toBe(2);
    expect(svg.ok && svg.pageCount).toBe(2);
    expect(svg.ok && svg.data.every((page) => page.startsWith("<svg"))).toBe(true);
  });

  it("exports DOCX (#131): the document's text, a page break where pagebreak() put one", async () => {
    const r = await render("= Title\nSome words.\n#pagebreak()\nPage two.", "docx", { engine });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(Buffer.from(r.data.slice(0, 2)).toString()).toBe("PK");
    const doc = strFromU8(unzipSync(r.data)["word/document.xml"] as Uint8Array);
    for (const text of ["Title", "Some words.", "Page two."]) expect(doc).toContain(text);
    expect(doc).toContain("<w:pageBreakBefore/>");
    expect(r.pageCount).toBe(2);
  });

  it("exports what Word can't draw as pictures (#133): SVG with a PNG, and a warning for a rounded box's text", async () => {
    const source =
      "Before.\n\n#box(width: 4cm, height: 2cm, place(circle(radius: 0.5cm, fill: blue)))\n\n" +
      "#block(radius: 4pt, stroke: 1pt, inset: 6pt)[Rounded text]\n\nAfter.";
    const r = await render(source, "docx", { engine });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const files = unzipSync(r.data);
    const doc = strFromU8(files["word/document.xml"] as Uint8Array);
    for (const text of ["Before.", "After."]) expect(doc).toContain(text);
    // The rounded box's text is in its picture.
    expect(doc).not.toContain("Rounded text");
    expect(doc.match(/<wp:anchor /g)).toHaveLength(2);
    expect(strFromU8(files["word/media/picture1.svg"] as Uint8Array)).toMatch(/^<svg /);
    expect([...(files["word/media/picture1.png"] as Uint8Array).slice(1, 4)]).toEqual([0x50, 0x4e, 0x47]);
    const warning = r.diagnostics.find((d) => d.code === "docx/fallback");
    expect(warning).toMatchObject({ severity: "warning", source: "typstream" });
    expect(warning?.message).toContain("a box with rounded corners is a picture");
    expect(source.slice(warning?.span?.from, warning?.span?.to)).toContain("block(");
  });

  it("returns diagnostics and no data for a broken document", async () => {
    const r = await render("#nope", "pdf", { engine });
    expect(r).toMatchObject({ ok: false, diagnostics: [{ message: "unknown variable: nope" }] });
    expect("data" in r).toBe(false);
  });

  it("renders every page of the corpus' largest paged document as SVG", async () => {
    const entry = loadCorpus({ sets: ["edu"] }).find((e) => e.name === "report-climate-change");
    const r = await render(entry?.source ?? "", "svg", { engine, files: corpusFiles });
    expect(r.ok && r.data.length).toBe(10);
  });
});
