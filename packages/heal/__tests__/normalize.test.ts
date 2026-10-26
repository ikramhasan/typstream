import { describe, expect, it } from "vitest";
import { createHealer, heal, normalize } from "../src";

describe("normalize", () => {
  it("unwraps a ```typst fence, complete or still streaming", () => {
    expect(normalize("```typst\n= A\n```").text).toBe("= A");
    expect(normalize("```typ\n= A\n```\n\n").text).toBe("= A");
    expect(normalize("```typst\n= A\n``", { streaming: true }).text).toBe("= A");
    expect(normalize("```typst\n= A\n``").text).toBe("= A\n``");
  });

  it("leaves other fences: a document may start with a raw block", () => {
    expect(normalize("```py\nx\n```").text).toBe("```py\nx\n```");
    expect(normalize("```typst\n= A", { unwrapFences: "never" }).text).toBe("```typst\n= A");
  });

  it("strips a BOM and holds back half a surrogate pair while streaming", () => {
    expect(normalize("\ufeff= A").text).toBe("= A");
    expect(normalize("a \ud83d", { streaming: true }).text).toBe("a ");
    expect(normalize("a 😀", { streaming: true }).text).toBe("a 😀");
  });

  it("a stream split inside a surrogate pair heals the same as an unsplit one", () => {
    const healer = createHealer();
    healer.push("*a \ud83d");
    expect(healer.result().source).toBe("*a *");
    expect(healer.push("\ude00").source).toBe(heal("*a 😀").source);
  });
});

describe("normalize: patches", () => {
  it("records each cut with its reason, in input and output offsets", () => {
    expect(normalize("\ufeff```typst\n= A\n```")).toEqual({
      text: "= A",
      patches: [
        { original: { from: 0, to: 1 }, result: { from: 0, to: 0 }, reason: "normalize:bom" },
        { original: { from: 1, to: 10 }, result: { from: 0, to: 0 }, reason: "normalize:fence-open" },
        { original: { from: 13, to: 17 }, result: { from: 3, to: 3 }, reason: "normalize:fence-close" },
      ],
    });
  });

  it("records a held-back half surrogate pair", () => {
    expect(normalize("a \ud83d", { streaming: true }).patches).toEqual([
      { original: { from: 2, to: 3 }, result: { from: 2, to: 2 }, reason: "normalize:hold-back" },
    ]);
    // Behind a partial closing fence the cut is the fence's.
    expect(normalize("```typst\nA\ud83d\n``", { streaming: true })).toEqual({
      text: "A",
      patches: [
        { original: { from: 0, to: 9 }, result: { from: 0, to: 0 }, reason: "normalize:fence-open" },
        { original: { from: 10, to: 14 }, result: { from: 1, to: 1 }, reason: "normalize:fence-close" },
      ],
    });
  });

  it("records nothing for clean text", () => {
    expect(normalize("= A\n")).toEqual({ text: "= A\n", patches: [] });
    expect(normalize("a 😀", { streaming: true }).patches).toEqual([]);
  });
});

describe("normalize: fence edges", () => {
  const text = (raw: string, streaming = false) => normalize(raw, { streaming }).text;

  it("the opening fence may follow blank lines and indentation, and carry trailing spaces", () => {
    expect(text("\n\n```typst\n= A\n```")).toBe("= A");
    expect(text("\n  ```typst\n= A\n```")).toBe("= A");
    expect(text("  ```typ\n= A\n```")).toBe("= A");
    expect(text("```typst  \n= A\n```")).toBe("= A");
    expect(text("```typst\t\r\n= A\r\n```\r\n")).toBe("= A");
  });

  it("the opening fence must start the text, and name typst or typ exactly", () => {
    expect(text("x\n```typst\n= A\n```")).toBe("x\n```typst\n= A\n```");
    expect(text("x```typst\n= A\n```")).toBe("x```typst\n= A\n```");
    expect(text("```typstx\n= A\n```")).toBe("```typstx\n= A\n```");
    // A BOM is stripped first; the fence behind it still counts.
    expect(text("\ufeff```typ\nA\n```")).toBe("A");
  });

  it("a stream that is so far only the opening fence is empty", () => {
    expect(text("```typst", true)).toBe("");
    expect(text("```typst\n", true)).toBe("");
  });

  it("the closing fence may be indented and followed by blank space only", () => {
    expect(text("```typst\n= A\n  ```")).toBe("= A");
    expect(text("```typst\n= A\n```  ")).toBe("= A");
    expect(text("```typst\n= A\n```\n  \n")).toBe("= A");
    // The last fence closes; a raw block before it stays.
    expect(text("```typst\nA\n```py\nx\n```\n```")).toBe("A\n```py\nx\n```");
    expect(text("```typst\nA\n``` x")).toBe("A\n``` x");
  });

  it("a partial closing fence is only held back at the very end of a stream", () => {
    expect(text("```typst\n= A\n  ``", true)).toBe("= A");
    expect(text("```typst\n= A\n`code` b", true)).toBe("= A\n`code` b");
  });

  it("half surrogate pairs are only held back while streaming", () => {
    expect(text("a \ud83d")).toBe("a \ud83d");
  });
});
