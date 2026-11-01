/// <reference lib="dom" />
// Typst's own elements in the paged view equal their PDF (#118), and the HTML target shows them as the paged view does.
import { htmlConformance } from "../../src/html";
import { pagedConformance } from "../../src/paged";
import { suite } from "./suite";

pagedConformance(suite);
htmlConformance(suite);
