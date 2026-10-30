import type { TypstBlock, TypstValue } from "../../src/index";

/** A value without block ids, for comparing values parsed separately. */
export const withoutIds = (value: TypstValue): Omit<TypstBlock, "id">[] =>
  value.map(({ id: _, ...block }) => block as Omit<TypstBlock, "id">);
