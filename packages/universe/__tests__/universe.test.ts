import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { UNIVERSE_PACKAGES, universe } from "../src/index";

const spec = (p: { namespace: string; name: string; version: string }) => `@${p.namespace}/${p.name}:${p.version}`;

/** A ustar archive's regular files by path (Universe tarballs have nothing else but directories). */
const untar = (gz: Uint8Array): Map<string, Buffer> => {
  const tar = gunzipSync(gz);
  const files = new Map<string, Buffer>();
  for (let at = 0; at + 512 <= tar.length && tar[at] !== 0; ) {
    const field = (from: number, length: number) =>
      tar.toString("latin1", at + from, at + from + length).replace(/\0.*$/s, "");
    const size = Number.parseInt(field(124, 12).trim() || "0", 8);
    const prefix = field(345, 155);
    const name = (prefix ? `${prefix}/` : "") + field(0, 100);
    const type = field(156, 1);
    if (type === "0" || type === "") files.set(name.replace(/^\.\//, ""), tar.subarray(at + 512, at + 512 + size));
    at += 512 + Math.ceil(size / 512) * 512;
  }
  return files;
};

const vendored = UNIVERSE_PACKAGES.map((p) => ({ ...p, files: untar(readFileSync(fileURLToPath(p.url))) }));

describe("vendored packages", () => {
  it("are the files listed, and their tar has the integrity listed", () => {
    const dir = fileURLToPath(new URL("../vendor/", import.meta.url));
    const listed = UNIVERSE_PACKAGES.map((p) => fileURLToPath(p.url).slice(dir.length)).sort();
    expect(readdirSync(dir).sort()).toEqual(listed);
    for (const p of UNIVERSE_PACKAGES) {
      const tar = gunzipSync(readFileSync(fileURLToPath(p.url)));
      expect(`sha256-${createHash("sha256").update(tar).digest("base64")}`, spec(p)).toBe(p.integrity);
    }
  });

  it("have the name and version their manifest says", () => {
    for (const p of vendored) {
      const manifest = p.files.get("typst.toml")?.toString("utf8") ?? "";
      expect(manifest, spec(p)).toMatch(new RegExp(`^name = "${p.name}"$`, "m"));
      expect(manifest, spec(p)).toMatch(new RegExp(`^version = "${p.version}"$`, "m"));
    }
  });

  it("bring every package they import", () => {
    const listed = new Set(UNIVERSE_PACKAGES.map(spec));
    const missing = new Set<string>();
    for (const p of vendored) {
      for (const [path, bytes] of p.files) {
        if (!path.endsWith(".typ")) continue;
        for (const [, imported] of bytes.toString("utf8").matchAll(/"(@[a-z0-9-]+\/[a-z0-9-]+:\d+\.\d+\.\d+)"/g)) {
          if (!listed.has(imported as string)) missing.add(`${imported} (from ${spec(p)}/${path})`);
        }
      }
    }
    expect([...missing]).toEqual([]);
  });
});

describe("universe plugin", () => {
  it("allows every vendored package, with its URL and integrity", () => {
    expect(universe.engine.packages.map(spec)).toEqual(UNIVERSE_PACKAGES.map(spec));
    for (const p of universe.engine.packages) {
      expect(p.url).toMatch(/\.tar\.gz$/);
      expect(p.integrity).toMatch(/^sha256-/);
    }
  });

  it("tells the model the packages documents import, and not their dependencies", () => {
    const rules = universe.prompt.rules.join("\n");
    for (const p of UNIVERSE_PACKAGES) {
      if (p.topic) expect(rules).toContain(`#import "${spec(p)}"`);
      else expect(rules).not.toContain(spec(p));
    }
  });
});
