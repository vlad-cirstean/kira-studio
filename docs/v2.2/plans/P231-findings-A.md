# P231 findings, Stream A

## A1 graph.refresh after Show more drops loaded rows
- Test: gitflow TestGraphRefreshAfterExternalCommit/keeps_every_loaded_row (skipped "P231 finding A1")
- Failure: `refresh kept 100 rows, want at least the 300 loaded before plus the new commit`
- Repro: 600-commit history, graphPageSize 100, `graph.stream`, 2x `graph.loadMore`, external `git commit`, wait `repo.changed`, `graph.refresh`, `graph.stream`.
- Suspected cause: apps/kira-space/internal/gitsession/walk.go:154-160 `ensureFreshLocked` -> `resetLocked` drops the store; next `graph.stream` re-reads one page only. Found by read. Same item P225 left open.
- Class: needs design decision (keep rows loaded vs reload one page; client may re-issue loadMore)

## A2 reloaded Review pane never opens its repo on the new connection
- Test: e2e-real git-review-real `P231 finding A2` (test.fixme)
- Failure: Review pane shows `Couldn't compare — gitrpc: repository is not open on this connection`; the open diff tab shows the same text. Retry and re-clicking the repo row do not recover.
- Repro: review a branch, open its diff tab, reload the page with the Review sidebar and diff tab restored, graph tab not shown. Opening the graph tab (first workspace tab), then Retry, recovers.
- Suspected cause: only the graph host sends `repo.open` on a fresh stream connection; Review pane and diff editor compare before it, and Retry does not re-open the repo. Not traced to a line (found in the browser).
- Class: obvious fix (Review and diff paths ensure `repo.open` on connect/Retry)

## A3 code search results never reach a server-build window
- Test: e2e-real repos-dialog-real `P231 finding A3` (test.fixme)
- Failure: search status stays "Searching…"; no result rows.
- Suspected cause: apps/kira-space/internal/shell/wails.go `emitter.EmitTo` (~37-47) finds no window via `app.Window.GetByName(windowKey)` in the `-tags server` build; silent no-op. Also hits other EmitTo events (terminal output, ADE open-session).
- Class: needs harness/Commit-0 change (server-build emitter delivers EmitTo to browser window by key, or broadcasts)
