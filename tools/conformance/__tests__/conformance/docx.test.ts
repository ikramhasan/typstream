// Typst's own elements exported to DOCX equal their PDF in LibreOffice (#118).
import { docxConformance } from "../../src/docx.mjs";
import { suite } from "./suite";

docxConformance(suite);
