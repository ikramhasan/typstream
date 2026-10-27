---
"@typstream/dom": patch
"@typstream/react": patch
---

A `stream` given to more than one mount is read once and shared (#81). Each mount shows all of its text, including what arrived before it mounted, so `<Typstream stream={…}>` under React StrictMode (which mounts, unmounts and mounts again) no longer loses chunks or ends early, and neither does a mount replaced while the stream continues. The stream is closed when a chunk arrives after the last mount reading it is gone, and a failed stream is reported once rather than per mount.
