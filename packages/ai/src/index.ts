// @typstream/ai: typstream with AI SDKs (PLAN §4.1, #34). Generation: an
// assistant message as a document, streaming or finished. Edits: an answer's
// `<edit>`s applied to a document as they stream.

// The top-level blocks a streaming range and a selection edit cover (heal's, @beta).
export { blockStarts } from "@typstream/heal";
export { findQuote, type QuoteMatch } from "./edits/match";
export { type EditOp, type ParsedAnswer, parseEdits } from "./edits/parse";
export { editFeedback, editPrompt, editPromptRules, editRequest, selectionRequest } from "./edits/prompt";
export {
  blockRange,
  createEditSession,
  type EditError,
  type EditResult,
  type EditSession,
  type EditSessionState,
  type EditStatus,
} from "./edits/session";
export { type ChatLike, isStreaming, type MessageLike, type MessagePartLike, textOf, textStream } from "./messages";
