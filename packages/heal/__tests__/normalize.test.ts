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
