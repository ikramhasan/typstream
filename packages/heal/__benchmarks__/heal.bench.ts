// Run with `pnpm bench`. Budgets are asserted separately in scripts/perf.mjs.
import { bench, describe } from "vitest";
import { BLOCK_ATOMS, INLINE_ATOMS } from "../__tests__/support/generators";
import { createHealer, heal } from "../src";

// Deterministic document of roughly `size` characters.
const makeDoc = (size: number): string => {
  const atoms = [...BLOCK_ATOMS, ...INLINE_ATOMS];
  let out = "";
  for (let i = 0; out.length < size; i++) out += `${atoms[(i * 7) % atoms.length]}\n\n`;
  return out.slice(0, size);
};

describe("stateless heal of a truncated document", () => {
  for (const size of [1_000, 10_000, 100_000]) {
    const doc = makeDoc(size);
    bench(`${size / 1000} KB`, () => {
      heal(doc);
    });
  }
});

describe("one streamed token (8 chars) at the end of a 50 KB document", () => {
  const doc = makeDoc(50_000);
  const healer = createHealer();
  healer.set(doc.slice(0, 40_000));
  let pos = 40_000;
  bench("incremental push", () => {
    if (pos >= doc.length) {
      healer.reset(doc.slice(0, 40_000));
      pos = 40_000;
    }
    healer.push(doc.slice(pos, pos + 8));
    pos += 8;
  });
  bench("stateless heal (full rescan)", () => {
    heal(doc.slice(0, 45_000));
  });
});

describe("one-character edit in the middle of a 100 KB document", () => {
  const doc = makeDoc(100_000);
  const healer = createHealer();
  healer.set(doc);
  let i = 0;
  bench("incremental applyEdit (resync)", () => {
    const at = 40_000 + ((i++ * 7919) % 20_000);
    healer.applyEdit({ from: at, to: at, insert: "x" });
    healer.applyEdit({ from: at, to: at + 1, insert: "" });
  });
  bench("stateless heal (full rescan)", () => {
    heal(doc);
  });
});

describe("constructs", () => {
  for (const input of ["Hello *bold", "#table(columns: 2, [a], [b", "$frac(a, ", "#let x = ", "```py\nprint(1)"]) {
    bench(JSON.stringify(input), () => {
      heal(input);
    });
  }
});
