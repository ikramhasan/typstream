// The `typstream` Trusted Types policy (#70), against a stand-in for the DOM's
// `trustedTypes`. The policy is created once per module, so each test loads a
// fresh copy.
import { afterEach, describe, expect, it, vi } from "vitest";

const load = async () => {
  vi.resetModules();
  return import("../src/trusted");
};

/** A `trustedTypes` that wraps values, refuses names it doesn't allow, and doesn't allow duplicates. */
const stubTrustedTypes = (allowed: string[]) => {
  const created: string[] = [];
  vi.stubGlobal("trustedTypes", {
    createPolicy(name: string, rules: { createHTML(s: string): string; createScriptURL(s: string): string }) {
      if (!allowed.includes(name) || created.includes(name)) throw new TypeError(`policy ${name} refused`);
      created.push(name);
      return {
        createHTML: (s: string) => ({ html: rules.createHTML(s) }),
        createScriptURL: (s: string) => ({ url: rules.createScriptURL(s) }),
      };
    },
  });
  return created;
};

afterEach(() => vi.unstubAllGlobals());

describe("the typstream policy", () => {
  it("passes strings through where there are no Trusted Types", async () => {
    const { trustedHTML, trustedScriptURL } = await load();
    expect(trustedHTML("<b>x</b>")).toBe("<b>x</b>");
    expect(trustedScriptURL("/worker.js")).toBe("/worker.js");
  });

  it("makes trusted values from one policy named typstream, created on first use", async () => {
    const created = stubTrustedTypes(["typstream"]);
    const { trustedHTML, trustedScriptURL } = await load();
    expect(created).toEqual([]);
    expect(trustedHTML("<b>x</b>")).toEqual({ html: "<b>x</b>" });
    expect(trustedHTML("<i>y</i>")).toEqual({ html: "<i>y</i>" });
    expect(trustedScriptURL("/worker.js")).toEqual({ url: "/worker.js" });
    expect(created).toEqual(["typstream"]);
  });

  it("falls back to strings when the page refuses the name or already has it", async () => {
    stubTrustedTypes(["other"]);
    expect((await load()).trustedHTML("<b>x</b>")).toBe("<b>x</b>");

    const created = stubTrustedTypes(["typstream"]);
    (
      globalThis as unknown as { trustedTypes: { createPolicy(n: string, r: object): unknown } }
    ).trustedTypes.createPolicy("typstream", {});
    const { trustedHTML, trustedScriptURL } = await load();
    expect(trustedHTML("<b>x</b>")).toBe("<b>x</b>");
    expect(trustedScriptURL("/worker.js")).toBe("/worker.js");
    expect(created).toEqual(["typstream"]);
  });
});
