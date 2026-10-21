# v2.10

First phase `P322` (highest in `docs/HISTORY.md` is `P321`). Branch `v2.10`. Phases run top to bottom.

| # | Phase | Status |
|---|-------|--------|
| P322 | Over-length comments. Handle what the v2.8 P320 sweep skipped: comments over 2000 characters (56 listed: Go 17, TS 31, Vue 8) plus the comments left as `kept:<gate>` (width, hedge, tokens, grew, form, directive) and the TS pointer losses the P320 judge flagged. Input: `plans/P320-not-applied.md` (line numbers refer to scan base `aee071c`, since rebased; re-extract with `scripts/commentsweep`). Opus plan decides the approach per case (split at paragraph boundaries with the marker handled, condense by hand-reviewed rewrite, or leave) and the cost. Plan and cost estimate need owner acceptance before running. | Todo |
