/// <reference lib="dom" />
// Universe's packages, in a few examples, in the paged view equal their PDF (#135).
import { pagedConformance } from "@typstream/conformance/paged";
import { suite } from "./suite";

pagedConformance(suite);
