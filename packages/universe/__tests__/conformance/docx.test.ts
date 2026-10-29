// Universe's packages, in a few examples, exported to DOCX equal their PDF in LibreOffice (#135).
import { docxConformance } from "@typstream/conformance/docx";
import { suite } from "./suite";

// LibreOffice sets an inline fraction at display size (#132): physica's `dv(x, t)` at the end of a line pushes the
// comma after it onto the next, 2 of the 11 lines with equations.
docxConformance(suite, { mathLines: 0.8 });
