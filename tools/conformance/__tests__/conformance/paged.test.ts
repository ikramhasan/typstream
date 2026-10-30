/// <reference lib="dom" />
// Typst's own elements in the paged view equal their PDF (#118).
import { pagedConformance } from "../../src/paged";
import { suite } from "./suite";

pagedConformance(suite);
