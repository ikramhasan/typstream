// Static server for the bench. Serves the harness, node_modules and the custom
// engine build. Sends COOP/COEP unless the page is requested with ?coi=0
// (needed for typst-wasm's worker backend). .wasm/.otf/.ttf are sent
// brotli-compressed (cached on disk) so download sizes match production.
import { createServer } from "node:http";
import { createReadStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { brotliCompressSync, constants } from "node:zlib";

const ROOT = resolve(".");
const CUSTOM = resolve("../custom-engine");
const CACHE = resolve(".br-cache");
mkdirSync(CACHE, { recursive: true });
const PORT = Number(process.env.PORT ?? 5174);
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".wasm": "application/wasm", ".otf": "font/otf", ".ttf": "font/ttf", ".json": "application/json", ".map": "application/json" };
const COMPRESS = new Set([".wasm", ".otf", ".ttf", ".js", ".mjs"]);

const brotliPath = (file) => {
  const st = statSync(file);
  const key = join(CACHE, `${file.replaceAll("/", "_")}.${st.size}.${st.mtimeMs}.br`);
  if (!existsSync(key)) {
    const t = Date.now();
    writeFileSync(key, brotliCompressSync(readFileSync(file), { params: { [constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_SIZE_HINT]: st.size } }));
    console.log(`brotli ${file} ${st.size} -> ${statSync(key).size} (${Date.now() - t} ms)`);
  }
  return key;
};

createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  let path = decodeURIComponent(url.pathname);
  if (path === "/") path = "/index.html";
  const file = path.startsWith("/custom/") ? join(CUSTOM, path.slice(8)) : join(ROOT, path);
  if (!(file.startsWith(ROOT) || file.startsWith(CUSTOM)) || !existsSync(file) || statSync(file).isDirectory()) {
    res.writeHead(404).end("not found");
    return;
  }
  const ext = extname(file);
  const headers = { "content-type": TYPES[ext] ?? "application/octet-stream", "cache-control": "no-store", "cross-origin-resource-policy": "same-origin" };
  if (url.searchParams.get("coi") !== "0") {
    headers["cross-origin-opener-policy"] = "same-origin";
    headers["cross-origin-embedder-policy"] = "require-corp";
  }
  let body = file;
  if (COMPRESS.has(ext) && /\bbr\b/.test(req.headers["accept-encoding"] ?? "")) {
    body = brotliPath(file);
    headers["content-encoding"] = "br";
  }
  headers["content-length"] = statSync(body).size;
  res.writeHead(200, headers);
  createReadStream(body).pipe(res);
}).listen(PORT, () => console.log(`http://localhost:${PORT}`));
