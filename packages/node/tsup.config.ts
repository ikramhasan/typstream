import { packageConfig } from "../../tools/repo/tsup";

// The worker is its own entry: the pool starts it by URL (dist/worker.js).
export default packageConfig({ entry: ["src/index.ts", "src/worker.ts"] });
