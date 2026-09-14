# Repo-map MCP: dogfooding log (v1.6)

## Process

Continuing v1.5's own practice (`docs/v1.5/mcp-repo-map-issues.md`): every implementation subagent
for this chapter uses the repo-map MCP server (v1.5 C3, later given source-line context in C8) for
real navigation work, and reports what happened.

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

- **P60a**: `search_symbols` finds nothing for a `.vue` SFC's own component name (e.g.
  `MonacoHost`) — expected, not a defect: `<script setup>` declares no symbol actually named after
  the file, so there's nothing to index. `search_files` (finds the file) plus `find_references` on
  a function/type it exports (both work correctly, verified against `loadMonaco`/
  `monacoLanguageIdFor`) is the right combination for a Vue SFC. No fix needed; noted so a future
  session doesn't spend time on it.

- **P60b**: the native `mcp__kira-repo-map__*` tool surface was unreachable at session start
  (`ConnectionRefused`) — expected per the setup doc's own note (the harness's tool manifest is
  fixed at session start, not read from MCP config at runtime). Built + started the server per the
  headless steps; found two stale hashed token files under `KIRA_HOME`, neither of which prints its
  raw bearer token back (tokens are stored hashed by design) — deleted both and restarted to mint a
  fresh one, then used it over plain HTTP/JSON-RPC as documented. `search_symbols` and
  `find_references` against `sql-tokens.ts`'s new `tokenizeSql` both returned correct, complete
  results (31 real call sites, no false positives). No fix needed beyond the token remint; noted so
  a future session with two stale token files doesn't waste time guessing which one is live.

- **P62 (planning)**: same `ConnectionRefused` at session start as P60b, same cause and same fix —
  started the server per the headless steps, deleted the one stale hashed token file under
  `/root/.kira-studio/`, restarted to mint a fresh bearer token, then called it over plain
  HTTP/JSON-RPC. `search_symbols` for `BlameLine` returned all four real Go symbols
  (`porcelain.BlameLine`, `BlameLineArgs`, `RepoEntry.BlameLine`, `gitrpc.BlameLineParams`) with no
  false positives; `search_symbols` for `attachReviewDecorations` returned the one correct
  definition. No fix needed.

_No non-trivial entries._

<!--
Entry template:

### N. <short title>

- **Found in**: P<phase>
- **Status**: Open | Fixed (`<commit sha>`)
- **Query/tool call**: what was asked of the MCP server
- **Expected**: what a correct answer looks like
- **Actual**: what came back
- **Fix**: (once fixed) what changed and why
-->
