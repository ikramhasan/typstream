---
"@typstream/dom": patch
---

SVG images on canvas pages land where the PDF has them in Firefox. Firefox rasterizes an SVG image at a whole number of pixels and resamples it to the fractional place and size a page draws it at, so its edges came out soft and up to a pixel off. The paged view now draws an unrotated SVG image through a version of it that is a whole number of pixels, at a whole pixel (an SVG holding the original, moved and scaled to its box), which every browser draws exactly; until that version is decoded, the image is drawn as before.
