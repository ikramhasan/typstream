---
"@typstream/dom": patch
---

The HTML target's page layout measures text with one range instead of one per run of text. WebKit and Chromium update every live range on each change to the document until it is collected, so the thousands a layout made slowed the renderer's next updates several times over (WebKit's update p50 on a 20-page stream: 5–6 ms → 2–3 ms).
