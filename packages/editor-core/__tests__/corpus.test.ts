// Every corpus document through the editor's model: unchanged, it comes back byte for byte;
// written canonically, Typst's parser reads it back into the same value.
import { ALL_SETS, loadCorpus } from "@typstream/corpus";
import { hasErrors, parse } from "@typstream/syntax";
import { beforeAll, describe, expect, it } from "vitest";
import { serializeValue, TypstDocument } from "../src/index";
import { loadParser } from "./support/syntax";
import { withoutIds } from "./support/values";

beforeAll(loadParser);

const corpus = loadCorpus({ sets: ALL_SETS });

describe("corpus", () => {
  it("writes an unchanged document back exactly", () => {
    for (const entry of corpus) {
      const doc = new TypstDocument(entry.source);
      expect(doc.serialize(doc.value), entry.id).toBe(entry.source);
      expect(doc.update(doc.value), entry.id).toBeNull();
    }
  });

  it.each(corpus.map((entry) => [entry.id, entry.source]))("reads %s's canonical Typst back the same", (_, source) => {
    // Where a document has syntax errors it is code, which the editor never rewrites.
    if (hasErrors(parse(source))) return;
    const value = new TypstDocument(source).value;
    const canonical = serializeValue(value);
    const again = new TypstDocument(canonical).value;
    expect(withoutIds(again)).toEqual(withoutIds(value));
    expect(serializeValue(again)).toBe(canonical);
  });
});
