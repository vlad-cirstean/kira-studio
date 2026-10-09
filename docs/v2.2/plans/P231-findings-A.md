# P231 findings, Stream A

## A1 graph.refresh after Show more drops loaded rows
- Test: gitflow TestGraphRefreshAfterExternalCommit/keeps_every_loaded_row (skipped "P231 finding A1")
- Failure: `refresh kept 100 rows, want at least the 300 loaded before plus the new commit`
- Repro: 600-commit history, graphPageSize 100, `graph.stream`, 2x `graph.loadMore`, external `git commit`, wait `repo.changed`, `graph.refresh`, `graph.stream`.
- Suspected cause: apps/kira-space/internal/gitsession/walk.go:154-160 `ensureFreshLocked` -> `resetLocked` drops the store; next `graph.stream` re-reads one page only. Found by read. Same item P225 left open.
- Class: needs design decision (keep rows loaded vs reload one page; client may re-issue loadMore)
