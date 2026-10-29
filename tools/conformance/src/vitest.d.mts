import type { TestProjectInlineConfiguration } from "vitest/config";

/** The conformance suite's vitest projects, `paged` and `docx`, with the plugin's aliases. */
export function conformanceProjects(alias: Record<string, string>): TestProjectInlineConfiguration[];
