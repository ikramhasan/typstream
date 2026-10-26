// HEAL_PROPERTY_SEED pins fast-check's seed so a run is reproducible. Mutation
// testing sets it: with random seeds a mutant could be killed in one run and
// survive the next.
import fc from "fast-check";

if (process.env.HEAL_PROPERTY_SEED) fc.configureGlobal({ seed: Number(process.env.HEAL_PROPERTY_SEED) });
