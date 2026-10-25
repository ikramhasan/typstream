---
"@typstream/heal": patch
---

Edits in the middle of a document re-parse only the edited block: the incremental healer resyncs with its previous state at the first matching checkpoint past the edit and reuses the rest (#5). `push` and `applyEdit` no longer diff the whole text. Also fixes a case where an edit right after a checkpoint (`#\n*` + `/*`) left the incremental result different from stateless healing.
