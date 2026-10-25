// Allowed: heal → core. Forbidden: heal → engine (higher layer), heal → spikes.
import type { Core } from "@typstream/core";
import type { Engine } from "@typstream/engine";
import { spike } from "../../../spikes/spike";

export type Healed = Core | Engine | typeof spike;
