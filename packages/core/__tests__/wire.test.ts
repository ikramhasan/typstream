import { describe, expect, it } from "vitest";
import { type ClientMessage, deserializeMessage, type ServerMessage, serializeMessage } from "../src";

const roundTrip = (m: unknown) => deserializeMessage(serializeMessage(m));

describe("serializeMessage / deserializeMessage", () => {
  it("round-trips plain messages unchanged", () => {
    const m: ClientMessage = {
      id: 3,
      method: "compile",
      params: { uri: "a", rev: 2, target: "paged", inputs: { theme: "dark" } },
    };
    expect(roundTrip(m)).toEqual(m);
  });

  it("carries bytes of every length as base64", () => {
    for (let n = 0; n < 70; n++) {
      const bytes = Uint8Array.from({ length: n }, (_, i) => (i * 37 + n) & 0xff);
      const out = roundTrip({ data: bytes }) as { data: Uint8Array };
      expect(out.data).toBeInstanceOf(Uint8Array);
      expect([...out.data]).toEqual([...bytes]);
    }
  });

  it("matches the standard base64 alphabet and padding", () => {
    const text = serializeMessage(new TextEncoder().encode("Typst?>"));
    expect(text).toBe(JSON.stringify({ $bytes: Buffer.from("Typst?>").toString("base64") }));
  });

  it("encodes Node Buffers as bytes, not through Buffer#toJSON", () => {
    const out = roundTrip({ pdf: Buffer.from([1, 2, 255]) }) as { pdf: Uint8Array };
    expect([...out.pdf]).toEqual([1, 2, 255]);
  });

  it("restores bytes nested in files and results", () => {
    const m: ServerMessage = {
      id: 1,
      result: { uri: "a", rev: 1, diagnostics: [], status: "ok", data: new Uint8Array([37, 80, 68, 70]) },
    };
    const out = roundTrip(m) as { result: { data: Uint8Array } };
    expect([...out.result.data]).toEqual([37, 80, 68, 70]);
    const open = roundTrip({ files: { "img/a.png": new Uint8Array([9]), "data.json": "{}" } });
    expect(open).toEqual({ files: { "img/a.png": new Uint8Array([9]), "data.json": "{}" } });
  });

  it("leaves objects that merely contain a $bytes key with others alone", () => {
    expect(roundTrip({ x: { $bytes: "AA==", other: 1 } })).toEqual({ x: { $bytes: "AA==", other: 1 } });
  });

  it("rejects malformed base64", () => {
    expect(() => deserializeMessage('{"$bytes":"a*b"}')).toThrow(SyntaxError);
  });
});
