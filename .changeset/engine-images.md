---
"@typstream/engine": minor
"@typstream/dom": minor
"@typstream/react": minor
"typstream": minor
---

Images a document names but has no file for. Such a document used to fail to compile; now the image shows as a placeholder (a box with the file's name) that keeps the call's size and alt text and a figure's caption, while streaming and when finished. The worker stands placeholders in for every image whose path is a string without a file before the first compile (Typst stops at the first image it can't read), and a new `missing-image` fixer (`missingImage` in `@typstream/engine/server`, in `DEFAULT_FIXERS`) handles paths in variables and files whose extension names another format. Finished documents still report the error.

To fill such images in, documents take a `resolveImage(path, { signal })` option (`engine.open`, `mountTypstream`, `<Typstream>` and `<TypstreamProvider>`): the client finds complete `image("…")` paths in the input, asks it once per path for the bytes, and writes them into the document's files. Diagnostics say an image is loading, or why it failed. `fetchImages({ hosts })`, in the new entry point `@typstream/engine/images` and re-exported by `typstream`, downloads `http(s)` URLs from the hosts you allow, without credentials (or through your `proxy`), accepting PNG, JPEG, GIF, WebP and SVG. Nothing is fetched by default, and the engine itself never fetches images. The engine's main-thread budget goes from 8.5 to 9.5 KB gzipped.

In the HTML target, an image shrunk to fit its element or set to a width (`width: 100%`) now keeps its proportions; it used to keep the height Typst gave it and come out stretched.
