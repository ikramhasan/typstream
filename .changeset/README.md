# Changesets

Run `pnpm changeset` in a PR that changes a published package, pick the bump, and describe the change for the changelog.

`@typstream/core`, `heal`, `engine`, `dom`, `react` and `typstream` share one **fixed** version (PLAN.md §10.4): a bump to any of them bumps them all. Content and integration packages version on their own. The fixed group lists only packages that exist; `pnpm check:layers` fails when a package marked `fixed` in `tools/repo/layers.mjs` is missing from it.

Releasing is #4.
