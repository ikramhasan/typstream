import { defineConfig } from "vitest/config";
import { conformanceProjects } from "./src/vitest.mjs";

// The suite of Typst's own elements, without a plugin (pnpm test:paged and test:docx): its documents' pages against
// their PDF, and their DOCX export against the PDF.
export default defineConfig({ test: { projects: conformanceProjects({}) } });
