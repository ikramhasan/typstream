/// <reference lib="dom" />
// Universe's packages, in a few examples, in the paged view equal their PDF (#135), and the HTML
// target shows them as the paged view does.
import { htmlConformance } from "@typstream/conformance/html";
import { pagedConformance } from "@typstream/conformance/paged";
import { suite } from "./suite";

pagedConformance(suite);
htmlConformance(suite);
