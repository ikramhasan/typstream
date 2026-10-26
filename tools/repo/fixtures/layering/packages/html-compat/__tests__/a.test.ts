// Tests may import testDeps (engine-wasm), but nothing else outside deps (heal).
import type { Engine } from "@typstream/engine-wasm";
import type { Healed } from "@typstream/heal";

export type T = [Engine, Healed];
