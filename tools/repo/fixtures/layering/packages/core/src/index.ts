// core imports a higher layer (type-only imports count too) and an npm package.
import type { Healed } from "@typstream/heal";
import { useState } from "react";

export type Core = Healed | typeof useState;
