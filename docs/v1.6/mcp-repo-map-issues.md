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

- **P62 (implementation)**: same `ConnectionRefused` at session start as every prior entry above —
  the server from the planning session's own run was still alive on port 8765 but its token file
  had already been deleted (planning session's own cleanup), so the live process's in-memory token
  no longer matched anything on disk. Killed and restarted it per the headless steps to mint a
  token this session actually has, then verified over plain HTTP/JSON-RPC: `search_symbols` for
  `gitRepoIdFor` returned the one correct definition (`hostHandlers.ts:68`), and `find_references`
  for `formatRelativeDate` returned all three real call sites (`CommitGrid.vue`, `columns.ts`,
  `ReviewCommitRow.vue`) — checked against a plain grep beforehand, no false positives, no misses.
  No fix needed beyond the restart; noted so a future session finds a live-but-orphaned process on
  8765 unsurprising.

- **P63 (planning)**: same `ConnectionRefused` at session start as every entry above, same fix —
  started the server per the headless steps, deleted the stale hashed token file under
  `/root/.kira-studio/`, restarted to mint a fresh bearer token, called it over plain
  HTTP/JSON-RPC. Two notes for a future session. First, `pkill -f mcp-repo-map` /
  `pkill -f kira-repo-map` **kills the calling shell too** — the pattern matches the agent
  harness's own command line, so the rest of the compound command (the `rm` of the token file)
  never runs and the restart then reports the token unchanged, which looks like a server bug and
  is not. Kill the server by PID instead. Second, the server picked port 41521 rather than 8765
  while an earlier instance still held 8765; the printed URL is authoritative, so read it from the
  startup output rather than assuming the documented port. Neither is a defect.
- **P64 (planning)**: same `ConnectionRefused` at session start as every entry above, same fix —
  killed the two live servers **by PID** (`pkill` kills the calling shell, per the P63 note),
  deleted both stale hashed token files under `/root/.kira-studio/`, restarted to mint a fresh
  bearer token. Reproduced the open non-trivial entry below exactly as logged. Found it is wider
  than logged, and recorded in `plans/P64-repo-map-type-aliases-and-read-symbol.md` §1.4 rather
  than amending that entry: `enum` declarations and module-level `const`s are missing too (0 rows
  of each for the whole TypeScript family), and the gap blocks `find_references` as well as
  `find_definition` — `locate` reaches reference rows only through a symbol-table lookup, so a
  missing definition makes existing `@reference.type` rows unreachable. `outline_file` on
  `packages/shared/domain/tree.ts` returns 7 of 23 declarations. No new entry opened: same root
  cause, same fix pass.

- **P63 (planning)**: `find_references` did the real work this phase needed and did it well —
  `openKeyValueTab` returned 13 hits (8 production, 5 test) each with its enclosing function name,
  and `findKeyValueTab`/`patchKeyValueTabState` returned 7 and 5 production sites, which is what
  sized the plan's refactor seam. No false positives, no misses against a spot-check.

- **P64 (implementation)**: same `ConnectionRefused`/leftover-orphaned-process pattern as every
  entry above — killed live servers **by PID**, deleted the stale hashed token file, restarted to
  mint a fresh bearer token, used it over plain HTTP/JSON-RPC throughout. Real navigation work used
  the server continuously while implementing (finding `resolveName`'s own line range via
  `read_symbol` instead of guessing a `Read` window, checking `sortCandidates`'/`search.go`'s own
  call sites, etc.), plus the mandatory dedicated dogfood pass: `read_symbol` against a Go method
  (`codegraph.resolveName`, doc comment + exact 292-376 range), a Go struct and a TypeScript type
  alias sharing one name (`TreeNode`, both directions — `.go`-referring and `.ts`-referring — ranked
  by the correct language via §2.4's fix), and a Vue SFC function (`BranchPicker.vue`'s `open`,
  doc comment correctly walked back through a multi-line G10 comment block); `search_symbols` with
  `pathPrefix:"packages/"` cut 100 unfiltered "open" hits to 38, all genuinely under `packages/`;
  `maxLines` truncation ("… truncated at 5 lines (symbol spans 85)") and `[stale]` (verified against
  a scratch file created, indexed, edited without a resync, and deleted) both behaved exactly as
  designed. One non-trivial finding, logged below and left open per process.

### Non-trivial

- **P63 (planning) — TypeScript `type` aliases are absent from the index; a name shared with Go
  silently resolves to the Go symbol only. Fixed (`54e77579`).**

  `search_symbols` and `find_definition` both miss every `export type X = …` alias:

  - `find_definition {"symbol":"BrowseTabState"}` → `no symbol named "BrowseTabState" found`,
    though it is declared at `packages/shared/domain/tabs.ts:204`.
  - `search_symbols {"query":"BrowseTab"}` → `no symbols matching "BrowseTab"`, though
    `BrowseTabState` and `BrowseTabRecord` both exist. Matching is by prefix and works otherwise:
    `{"query":"browse"}` correctly returns `browseMenuItem`, `browseInvalidate` and
    `BrowseViewRuntime`, so the alias is genuinely not indexed rather than merely unmatched.
  - Worse, silently: `find_definition {"symbol":"TreeNode"}` returns **one** definition, the Go
    struct at `internal/storage/model/tree.go:33`, and never mentions the TypeScript
    `export type TreeNode = z.infer<typeof treeNodeSchema>` at
    `packages/shared/domain/tree.ts:96`. A single confident hit reads as "this is the definition",
    so a frontend question gets answered with a backend type.

  Impact here is real rather than theoretical: this repo derives most of its shared domain types
  from zod (`z.infer`), so `TreeNode`, `NodeKind`, every `*TabState` and every `*TabRecord` — the
  exact types a frontend phase navigates by — are invisible. Interfaces (`BrowseViewRuntime`) and
  functions index correctly, so the gap is specifically TS type-alias declarations.

  Per the process above, not fixed in this phase. P64 waits on a dedicated fix pass. A fix likely
  needs both halves: index `type_alias_declaration` in the TS/TSX tree-sitter queries, and make a
  cross-language name collision report every hit rather than the first.

  **Fix (P64, `54e77579`)**: two new repo-authored query files
  (`queries/typescript/p64_declarations.scm`, `queries/tsx/p64_declarations.scm`) add the missing
  `type_alias_declaration`/`enum_declaration`/module-level-`const` patterns; `codegraph.resolve.go`
  gained a same-language-family tiebreak (`4760482a`) so a cross-language collision now ranks the
  referring file's own language first instead of losing on directory accident; `find_definition`/
  `find_references`/`find_implementations` gained a `languages` filter (`dbfc5813`) to resolve one
  in a single call. **Correction to the original finding above**: the gap was wider than first
  logged — `enum` declarations and module-level `const`s were invisible too (P64's own planning
  pass measured 0 rows of each across the whole TypeScript family), and since `locate` reaches
  reference rows only through a symbol-table lookup, the missing definitions also silently broke
  `find_references` for every one of these names, not only `find_definition`. Verified against a
  live server on a completed reindex: `BrowseTabState`/`BrowseTabRecord`/`treeNodeSchema` all now
  resolve, and `outline_file` on `packages/shared/domain/tree.ts` returns 23 nodes rather than 7.

- **P64 (implementation) — a bare-symbol ambiguous listing still lists the cross-language
  collision in path-alphabetical order, not language-family order. OPEN.**

  `find_definition {"symbol":"TreeNode"}` (no `file`, no `languages`) correctly returns both
  candidates now (§2.2's fix), but lists `apps/kira-studio/internal/storage/model/tree.go` (the Go
  struct) **first** and `packages/shared/domain/tree.ts` (the TypeScript alias) second — the
  opposite of what P64's own plan (§2.7's verification table) expects ("tree.ts:96 present and
  listed first").

  Root cause: this is a *different* code path from the one §2.4's language-family tiebreak
  touches. A bare `{"symbol": X}` call with several exact matches never reaches
  `codegraph.resolveName`/`sortCandidates` at all — `repomap/locator.go`'s own `locate()` resolves
  it directly via `codegraph.SearchSymbols`, whose Go-side ranking (`codegraph/search.go`'s
  `less()`) has no language concept, only exact/prefix/offset/name-length then plain path-string
  comparison. `apps/kira-studio/...` sorts before `packages/...` alphabetically regardless of which
  file shares the caller's own language. §2.4's fix (`4760482a`) lives entirely in
  `resolve.go`'s `sortCandidates`, used only by `DefinitionOf`'s reference/position-based
  resolution (confirmed working correctly: `read_symbol` with a `.go` referring file ranks the Go
  candidate first, a `.ts` referring file the TypeScript one) — it was never wired into
  `SearchSymbols`'s own ranking or into `locate()`'s ambiguous-listing path.

  `languages` (§2.5, `dbfc5813`) is the working escape hatch for this exact case today —
  `find_definition {"symbol":"TreeNode","languages":["typescript"]}` resolves cleanly in one call —
  so the gap is cosmetic (list order), not a missing answer: both candidates are still returned,
  every time, just not language-ordered by default.

  Not fixed in this phase, per process (the finding surfaces from P64's own new/changed surface, so
  it waits on a dedicated fix pass before the next phase starts). One nuance for that pass to
  settle first, not just a mechanical port: a **bare** `{"symbol": X}` call (no `file`) carries no
  referring file at all, so — unlike `DefinitionOf`'s reference/position-based path, which always
  has a concrete site and therefore a concrete language to prefer — there is no principled "this
  caller's own language" to rank by here. Confirmed correct by construction, not a bug: a bare
  lookup is genuinely anchor-free. So either (a) the plan's own §2.7 expectation ("listed first")
  was written assuming a language anchor that a bare-symbol call structurally doesn't have, and the
  fix is to correct that expectation rather than the code — `languages` already gives the caller a
  one-call, no-ambiguity escape hatch, which may be the intended answer — or (b) some other
  tiebreak entirely (alphabetical-by-language-name? Go-before-everything as a stable default?) is
  wanted for this specific no-anchor case, which is a real design decision, not a one-line
  `sameLanguageFamily` port. Either way, the next pass should decide deliberately rather than
  silently reusing §2.4's fix where it structurally doesn't fit.

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
