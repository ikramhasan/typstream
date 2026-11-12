import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Nothing for typstream: the engine's worker, the Typst wasm and its fonts are emitted as assets by `vite build`.
export default defineConfig({ plugins: [react()] });
