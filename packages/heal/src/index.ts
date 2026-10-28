export { anchorPoints, blockStarts } from "./blocks";
export {
  createHealer,
  type Healer,
  type HealHandler,
  type HealHandlerContext,
  type HealOptions,
  type HealResult,
  heal,
  type OpenFrame,
} from "./heal";
export type { Mode } from "./lexer";
export {
  DEFAULT_LINT,
  type LintFinding,
  type LintRuleId,
  type LintSeverity,
  type TextChange,
} from "./lint";
export { type Normalized, type NormalizeOptions, normalize } from "./normalize";
export {
  type Checkpoint,
  type FrameKind,
  type LintEvent,
  type ModeSpan,
  type Recognition,
  type RecognizeOptions,
  type Requirement,
  recognize,
  type SyntaxIssue,
} from "./recognizer";
