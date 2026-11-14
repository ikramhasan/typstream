import { packageConfig } from "../../tools/repo/tsup";

// index: the main-thread client. server: the worker half's API. worker: the
// default worker script, which `engineWorker()` loads from next to index.js.
// websocket: `fromWebSocket`, the client's transport to a remote server.
// images: `fetchImages`, which downloads the image URLs a document names.
// prefetch: `prefetchEngine`, which downloads the default worker's wasm and fonts without starting it.
export default packageConfig({
  entry: ["src/index.ts", "src/server.ts", "src/worker.ts", "src/websocket.ts", "src/images.ts", "src/prefetch.ts"],
});
