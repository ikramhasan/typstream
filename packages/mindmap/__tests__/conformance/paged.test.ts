/// <reference lib="dom" />
// mindmap's examples in the paged view equal their PDF (#135).
import { pagedConformance } from "@typstream/conformance/paged";
import { suite } from "./suite";

pagedConformance(suite);
