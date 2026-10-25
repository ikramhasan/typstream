import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeDoc } from "./src/docs.mjs";
const dir = mkdtempSync(join(tmpdir(), "cal-"));
for (const n of process.argv.slice(2).map(Number)) {
  const d = join(dir, String(n)); execFileSync("mkdir", ["-p", d]);
  writeFileSync(join(d, "main.typ"), makeDoc(n));
  execFileSync("typst", ["compile", "--font-path", "assets/fonts", "--ignore-system-fonts", join(d, "main.typ"), join(d, "p{p}.svg")]);
  console.log(n, "sections ->", readdirSync(d).filter((f) => f.endsWith(".svg")).length, "pages,", makeDoc(n).length, "chars");
}
