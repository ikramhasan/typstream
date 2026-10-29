// mindmap's examples exported to DOCX equal their PDF in LibreOffice (#135).
import { docxConformance } from "@typstream/conformance/docx";
import { suite } from "./suite";

docxConformance(suite);
