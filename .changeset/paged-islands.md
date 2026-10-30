---
"@typstream/dom": minor
---

Render islands on pages (#28, beta): the paged view mounts islands over their fallback drawing, so `<Typstream target="paged" islands>` and `mountTypstream` show interactive mind maps in the document panel too. `createPagedView` takes `islands`, `plugins` and `file` as `createHtmlRenderer` does, and `render(artifact, { stable })` (`PagedRenderOptions`) marks islands still being written incomplete; `mountPaged` passes the document's plugins, files and stable offset. Each island sits in a box over its page, positioned in units of the page's width like the links, so it scales with the page and stays mounted as pages are redrawn or it moves to another page. Once it renders it covers the drawing with the paper's white, and the text it covers is hidden from assistive technology. The page's canvas keeps Typst's drawing, which is what prints and exports.
