# Repo-map MCP: dogfooding log (v1.7)

## Process

Continuing v1.5/v1.6's own practice (`docs/v1.6/mcp-repo-map-issues.md`): every implementation
subagent for this chapter uses the repo-map MCP server for real navigation work, and reports what
happened.

Two outcomes, handled differently:

- **Trivial** (a config/registration/wiring problem, fixed in the same session it was found): fix
  it inline, log one line here (what broke, one-line fix) for the record, keep going. No process
  gate.
- **Non-trivial** (a wrong or incomplete result, a missing tool, a crash, anything where the fix is
  itself real work): log a full entry below, and **do not fix it inside that phase**. The next
  phase does not start until every open non-trivial entry from the phase before it is fixed and
  closed — a dedicated fix pass runs between the two, same shape as a bugfix.

Entries are closed in place (status flips to Fixed, commit noted) rather than deleted.

## Log

- **M1 (planning)**: used throughout for navigation — `search_symbols` for `Execute` found all 25
  call sites across adapters/adapterhost/frontend in one call (established the query-path routing
  section of the plan); `outline_file` covered `internal/connections/service.go`'s 42 declarations
  without reading its 692 lines; `read_symbol` read `mcpauth.LoadOrMint`'s declaration exactly;
  `find_references` found all three `mcpauth.Path` call sites; `search_files` located
  `state/connections.ts` by path fragment. Real work throughout, replacing several whole-file reads.

- **M1 (planning)**: `find_references` with both `file` and `symbol` set (`mcpauth/token.go`,
  `Path`) returned 10 hits, 6 of them unrelated `fd.Path()` calls in `internal/grpcclient` — the
  `file` hint narrows which symbol is *resolved*, not which results come back. Trivial and by
  design: the server's own tool description already says results are name-resolved, not
  type-resolved. No fix needed; noted so a future session doesn't trust a reference count filtered
  by `file` to be type-scoped.

### Non-trivial

- **M1 (planning) — the repo-map server refuses to start when `$KIRA_HOME` does not yet exist.**

  - **Found in**: M1 (planning)
  - **Status**: Fixes inside M1ab (M1's own implementation), not a dedicated pass — see below
  - **Query/tool call**: `bun run mcp:repo-map` (first run in this container, `$KIRA_HOME` absent)
  - **Expected**: server creates its storage directory and starts
  - **Actual**: exits 1: `kira-repo-map: repomap: resolve token: mcpauth: write
    /root/.kira-studio/mcp-repo-map-fc694cca06c3-token.json: … no such file or directory`. Cause:
    `mcpauth.Save` (`token.go:94`) calls `os.WriteFile` with no `os.MkdirAll` first. Worked around
    with `mkdir -p` for the rest of the planning session; not fixed there, per this log's own rule.
  - **Fix**: folded into M1's plan (`docs/v1.7/plans/M1-db-mcp-server-core.md` §2.6) rather than
    scheduled as a separate dedicated pass — M1 already owns `internal/mcpauth` for the 7-day
    rotation work and touches `Save` directly, so a standalone fix phase for a one-line
    `MkdirAll` would edit the same function a second time for no reason. Closed once M1ab lands the
    plan; if M1ab's committed diff does not include the `MkdirAll`, reopen this entry.

<!--
Entry template:

### N. <short title>

- **Found in**: M<phase>
- **Status**: Open | Fixed (`<commit sha>`)
- **Query/tool call**: what was asked of the MCP server
- **Expected**: what a correct answer looks like
- **Actual**: what came back
- **Fix**: (once fixed) what changed and why
-->
