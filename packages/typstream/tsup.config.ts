import { packageConfig } from "../../tools/repo/tsup";

// Next.js's App Router renders components on the server unless their module says otherwise.
export default packageConfig({ entry: ["src/index.tsx"], banner: { js: '"use client";' } });
