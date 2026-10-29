import type { ConformanceSuite } from "./suite";

export type { ConformanceExample, ConformanceSuite } from "./suite";

/** Options of {@link docxConformance}. */
export interface DocxConformanceOptions {
  /** The layout engine; default LibreOffice, or ONLYOFFICE with `TYPSTREAM_DOCX_ENGINE=onlyoffice`. */
  engine?: "libreoffice" | "onlyoffice";
  /**
   * The share of Typst's lines the examples with equations must keep together (default 0.95, as tools/docx-check's
   * floor): engines set math their own way (#132).
   */
  mathLines?: number;
}

/** One example against Typst's PDF (compare.mjs), or why it couldn't be. */
export type DocxResult =
  | { error: string; file?: string }
  | {
      error?: undefined;
      file: string;
      typst: string;
      pdf: string;
      invalid: string[] | null;
      lines: number;
      same: number;
      pages: [number, number];
      pageStarts: number;
      pageStartsSame: number;
      first: { typst: string[]; other: string[] } | null;
      pictures: { page: number; cluster: number; box: number[] | null }[];
      math?: { chars: number; same: number };
      /** None with equations. */
      ink: { page: number; pixels: number; cluster: number; box: number[] | null } | null;
    };

/** Exports every example and compares it with Typst's PDF. */
export function checkDocx(
  suite: ConformanceSuite,
  options?: { engine?: "libreoffice" | "onlyoffice"; validator?: string | false; out?: string },
): Promise<Map<string, DocxResult>>;

/**
 * Defines the suite's DOCX tests (vitest, Node; LibreOffice and poppler on PATH): each example's DOCX is valid
 * (Microsoft's validator, where it is built), its pictures match the PDF's pixels and its equations are whole; without
 * equations, every line and page is Typst's, and so are rules, borders and shading.
 */
export function docxConformance(suite: ConformanceSuite, options?: DocxConformanceOptions): void;
