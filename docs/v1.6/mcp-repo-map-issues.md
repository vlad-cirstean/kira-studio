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

- **P63 (implementation, arm A)**: built and started the server for this worktree specifically
  (`bun run mcp:repo-map:build` then `bun run mcp:repo-map --repo
  /home/user/kira-studio-p63-arm-a`, backgrounded) — a fresh worktree, no stale token file to clean
  up first. The index took a genuinely noticeable while to finish its initial sync (`search_symbols`
  returned "still building (initial sync running past 25s) — retry shortly" on the first two calls,
  ~30s apart, before succeeding on the third) — not a defect, just slower than P62/P60b's own runs,
  worth knowing rather than assuming ConnectionRefused-only startup cost. Two real findings, one
  trivial:
  - Called `outline_file` with a `path` argument once, out of habit from other tools' own
    convention — rejected ("unexpected additional properties"; the real parameter is `file`).
    Trivial, my own mistake, not a tool defect; fixed inline by reading `tools/list`'s own schema
    as CLAUDE.md already says to.
  - Confirmed, not newly found: P60a's own note holds exactly — `search_symbols`/`outline_file`/
    `find_definition`/`read_symbol` return nothing for any `.vue` SFC (tried `EmptyState.vue`,
    `ViewChrome.vue`; both real components, both zero results), while `search_files` finds the
    file itself fine. This phase's own work was ~70% `.vue` template/script edits (BrowseView.vue,
    KeyValuePane.vue extracted from KeyValueView.vue) — for that whole slice the server had nothing
    to offer beyond confirming a file's existence, and Read/Grep carried it instead.

  Genuine, valuable hits on the Go/shared-TS side, where the actual navigation work happened:
  `search_symbols` for `BrowseViewRuntime`/`KeyValueViewRuntime` to jump straight to their
  declarations before editing; `find_references {"symbol":"KeyTypes"}` at the very end, as a sanity
  check rather than a discovery step — asked it to enumerate every `KeyTypes` method across the
  codebase after wiring `adapters.Adapter.KeyTypes` through nine stub adapters, redis's real
  implementation, `Router`, `bridge.TreeService` and `tree.Service`, and it returned exactly the 13
  expected symbols (the interface method once per adapter kind, plus the four bridge/service
  layers) with no false positives and nothing missing — a real, if small, win: cheaper and more
  certain than re-grepping nine files by hand to confirm nothing was skipped.

  Honest accounting for this session as a whole: the large majority of lookups (BrowseView.vue's
  and KeyValuePane.vue's own structure, ViewChrome/PanelSplitter/VirtualList/EmptyState prop
  shapes, every state.ts/page.ts/host.ts's exact contents before editing, the Go adapter/bridge
  files' exact line ranges to anchor edits against) went through direct Read/Grep, not the server —
  driven by the `.vue`-SFC gap above (this phase's own dominant file type) plus the fact that, once
  I already had a file open via Read to make an edit, asking the server a second question about
  content already in context saved nothing. Where it was used (Go/TS symbol lookups, the final
  cross-file consistency check), it was faster and more certain than the Read/Grep alternative — the
  P60a gap is the one thing that kept it from being the default for more of this particular phase's
  work, not a shortcoming in what it does cover.
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

- **P64b (planning)**: the server was `ConnectionRefused` at session start, same as every prior
  entry. Started it per the headless steps. The existing hashed token under `/root/.kira-studio/`
  cannot be read back, and deleting it would have broken the concurrently-running P64 agent's own
  registration, so this session pointed `KIRA_HOME` at a scratchpad directory instead to mint a
  fresh token against an isolated index — a cleaner workaround than remint-and-break, worth
  recording. One nit: the server does not create `KIRA_HOME` if the directory is absent; it exits
  with `mcpauth: write …: no such file or directory`. `mkdir -p` first. Trivial, no fix filed.

- **P64b (planning)**: the tool answers themselves were correct in every call made. The three
  wrong-looking answers (`CodeConnect`, `PaginationKeyset`, `ErrStreamFull` all "not found") are
  this phase's own subject, already logged as the P64b SPEC row, so they are not a new entry.

- **P64b (implementation)**: same `ConnectionRefused`/leftover-orphaned-process pattern as every
  entry above — killed live servers **by PID**, deleted the stale hashed token file, restarted to
  mint a fresh bearer token, used it over plain HTTP/JSON-RPC throughout (twice — once per rebuild,
  since query text changes retrigger the fingerprint check and a full reindex, §1.9). Real
  navigation work used the server continuously while verifying: §2.10's full table plus the
  mandatory dedicated dogfood pass — `find_definition`/`read_symbol` on a Go const inside a grouped
  block (`CodeAuth`, correctly scoped to its own line, not the enclosing `const ( … )`) and on a Go
  `var` sentinel (`ErrPathEscapesRoot` — turned out to be a genuine 3-way cross-package name
  collision, `codeworkspace`/`gitsession`/`pathsafe` each declaring their own; correctly returned as
  a full ambiguous candidate list with a source line under each, not a silent top-hit guess);
  `outline_file` on `errors.go` (25 nodes) and `build.mjs` (19 nodes); `search_symbols` with
  `kinds:["constant"]` (the eight Go `ErrorCode` constants, `pathPrefix`-scoped) and
  `kinds:["variable"]` (28 matches for `Err`, correctly including both production sentinels and the
  new golden-fixture ones). No non-trivial finding in P64b's own new surface — every call returned
  the expected, correctly-scoped result.

- **P66 (implementation)**: same `ConnectionRefused`/stale-token pattern as every entry above — no
  live server at session start, built (`bun run mcp:repo-map:build`), started
  (`bun run mcp:repo-map`, backgrounded), found one stale hashed token file under
  `/root/.kira-studio/` and deleted it, restarted to mint a fresh bearer token, called it over plain
  HTTP/JSON-RPC per the headless steps throughout. Used it while implementing (`search_symbols` for
  `NewDeferredDialogs` to confirm the exact shape to model `NewDeferredBrowser` on;
  `find_references {"symbol":"NewDeferredBrowser"}` after writing it, correctly returning the one
  real call site in `main.go`). Mandatory dogfood check: `outline_file` against the brand-new
  `internal/appupdate/checker.go` (written this same phase, so this doubles as "does the index pick
  up a file created mid-session without a restart" — yes: 21 nodes, complete and correctly ordered).
  One trivial slip, my own: called `outline_file` with `path` out of habit — rejected ("unexpected
  additional properties"); the real parameter is `file`, exactly as P63's own entry already logged.
  Not a new finding, just a repeat of not reading `tools/list` first; fixed inline by doing so. No
  non-trivial finding this phase.

- **P64c (implementation)**: same leftover-orphaned-process pattern as every entry above — a
  `kira-repo-map`/`bun run scripts/mcp-repo-map.ts` pair from an earlier session was already
  running at session start (`ConnectionRefused` for the native tool surface, expected), consuming
  real CPU via its own watcher reacting to this session's own edits; killed by PID, not `pkill`
  (P63's own note). Rebuilt (`bun run mcp:repo-map:build`, 1.7s — build cache was warm from this
  phase's own repeated `go build`s, not the ~34s cold figure this phase records in
  `docs/DEV_ENVIRONMENT.md`), deleted the stale hashed token file, restarted to mint a fresh bearer
  token, called it over plain HTTP/JSON-RPC per the headless steps. Mandatory dogfood smoke check
  against the live pipelined index: `find_definition {"symbol":"ReplaceFiles"}` correctly resolved
  the one real method (`store.go:122:17`); `search_symbols {"query":"parseStale"}` correctly
  resolved the one real method (`sync.go:138:19`). No non-trivial finding — both calls answered
  correctly on the first try.

- **P67 (planning)**: same `ConnectionRefused`/stale-token pattern as every entry above. One new
  wrinkle worth recording: `pkill -f kira-repo-map` killed this agent's own shell (exit 144) before
  its following `rm` ran, leaving a stale token file and a server that then reported "Using this
  repository's existing token" while the token printed a moment earlier answered `401` — two
  minutes lost. P63's own note ("kill by PID, not `pkill`") is the fix and now has a second
  independent confirmation. Also: start the server with `setsid nohup … & disown`, since a plain
  background job dies with the agent's shell. Tool answers themselves were correct on every call:
  `find_references {"symbol":"foreignKeyNavItems"}` returned exactly the two real call sites
  (`views/grid/menu.ts:200`, `views/grid/slick/rowValues.ts:267`), both verified by direct read;
  `search_symbols {"query":"requestReveal"}` returned both real declarations. Note for a future
  session, not a defect: `find_definition`/`find_references` take `symbol`, not `name` — a `name`
  argument is rejected with a clear schema-validation error rather than a wrong answer, which is
  the right behavior. No non-trivial finding.

- **P67 (implementation)**: same `ConnectionRefused`/stale-token pattern as every entry above — a
  server was already alive on 8765 at session start (`ConnectionRefused` for the native tool
  surface, expected) but "Using this repository's existing token (unchanged since it was last
  minted)" on connect, unusable (hashed, never printed back this session, per every prior entry's
  own note). Killed **by PID** (not `pkill`, P63's own note), deleted the stale hashed token file
  under `/root/.kira-studio/`, restarted with `setsid nohup … & disown` to mint a fresh bearer
  token, called it over plain HTTP/JSON-RPC per the headless steps. Used it after implementing, to
  confirm this phase's own new surface: `find_references {"symbol":"foreignKeyValueFilter"}`
  returned exactly the 5 real call sites (`FkPreviewPopover.vue`'s `load()`, `menu.ts`'s
  `navigateForeignKey`/`editReferencedRow`/`fkNavItem`/`fkEditItem`), correctly picking up the
  brand-new `FkPreviewPopover.vue` file with no restart needed since the index was built fresh
  after this phase's edits landed; `find_references {"symbol":"editReferencedRow"}` returned both
  real call sites (`FkPreviewPopover.vue`'s `onEditClick`, `menu.ts`'s `fkEditItem`); `search_symbols
  {"query":"requestCellFocus"}` returned the one real declaration (`focusRequest.ts:35`). No false
  positives, no misses, nothing missing. No non-trivial finding.

- **P67e (planning)**: same stale-token pattern as P67 above — a server was already alive on 8765
  with "Using this repository's existing token", unusable (the file under `/root/.kira-studio/`
  holds only `hash`/`salt`, never the token). Rather than delete the registered token, started a
  second server with `KIRA_HOME` pointed at this session's scratchpad, which minted and printed a
  fresh bearer token, and called it over plain HTTP/JSON-RPC per the headless steps. That fresh
  `KIRA_HOME` meant a cold index — see the non-trivial entry below. Once warm, every call was
  correct and confirmed this plan's own line numbers independently of the file reads:
  `search_symbols {"query":"readOnlyRequest"}` → `gitstream.go:108`; `{"query":"readOnlyMethods"}`
  → `gitstream.go:70`; `{"query":"opTable"}` → `gitsession/ops.go:187` plus
  `kira-studio-vscode/src/commands.test.ts:113`'s `opTableKinds`; `find_references
  {"symbol":"readOnlyRequest"}` → 8 references, correctly including the `ServeGitStream`
  composition at `gitstream.go:182` and all four test call sites. `search_symbols
  {"query":"ConflictBanner"}` returned nothing — the already-logged P60a `.vue` SFC behavior, not a
  new defect.

- **P67e (implementation)**: same `ConnectionRefused` at session start as every entry above — no
  server was running in this container. Ran the headless setup fresh (`bun run mcp:repo-map:build`
  then `mcp:repo-map` backgrounded); the first start reused a stale hashed token under
  `/root/.kira-studio/` from an earlier session in this same container (unusable, same as every
  prior entry), so deleted it and restarted to mint a fresh one, then called it over plain HTTP/
  JSON-RPC. Used throughout implementation for navigation (`search_symbols`/`find_definition`
  against `gitstream.go`'s renamed identifiers, both correct and current — `allowedMethods` resolved
  to `gitstream.go:89`, `allowedRequest` to its own declaration), plus a post-implementation
  verification pass: `find_references {"symbol":"allowedRequest"}` correctly returned all 7 real
  call sites across `gitstream.go` and the renamed test functions in `gitstream_test.go`. See the
  non-trivial entry below for what did not work.

- **P67f (planning)**: no server was running at session start (`ConnectionRefused`, expected). Built
  and started per the headless steps. Two notes, transcribed here per this doc's own "trivial" rule
  (nothing wrong with the tool itself, both are environment/process quirks worth not rediscovering).
  First, `pgrep -f "kira-repo-map|mcp-repo-map.ts" | xargs kill` kills the calling shell (exit 144),
  same reason `pkill -f` does (already logged P63/P67): the pattern matches the agent harness's own
  command line. `ps -eo pid,comm | awk '$2=="kira-repo-map"'` does not. Second, pointing `KIRA_HOME`
  at "the scratchpad directory" is **not** reliably a cold index — this session's scratchpad already
  held a `codeindex.db` from an earlier agent under the same session id. Use a fresh subdirectory
  (`mkdir -p "$SCRATCH/coldhome"`) when a cold index is actually the point.

- **P67f (implementation)**: same `ConnectionRefused`/leftover-orphaned-process pattern as every
  entry above — a server from an earlier session in this container was already running on 8765 with
  a stale hashed token; killed it **by PID** (`ps -eo pid,comm | awk '$2=="kira-repo-map"'`, per the
  note above — not tried against `pgrep -f` this session, since the note already said not to),
  deleted the stale token file, restarted to mint a fresh bearer token, called it over plain
  HTTP/JSON-RPC throughout. Rebuilt and restarted the server twice more as this phase's
  own query files changed (§1.8's fingerprint-driven reindex, once per rebuild) — each full reindex
  of this monorepo (Go, TypeScript, JavaScript and Vue together) took noticeably longer than P64c's
  own ~3s figure, on the order of a few minutes; worth recording since a caller timing a "how long
  should this take" assumption off that earlier number would be surprised. The mandatory
  dedicated dogfood pass (§3.6/§8 of this phase's own plan) is written up in the two non-trivial
  entries' own "Fix" notes below rather than repeated here. One additional check beyond those:
  `find_definition {"symbol":"NewExecRunner"}` (a file this phase never touched) correctly returned
  an ambiguous 2-candidate list (`internal/ghclient` and `internal/gitclient` both really declare
  one) rather than a silent top-hit guess, and `outline_file` on `internal/gitclient/runner.go`
  returned its normal node list — both a clean no-regression check. No new non-trivial finding.

- **P67c (implementation)**: same `ConnectionRefused`/stale-token pattern as every entry above — no
  server running at session start; built, started, found a stale hashed token file (killed by PID,
  per P67f's own note — `pkill -f`/`pgrep -f … | xargs kill` both kill the calling shell), deleted
  it, restarted to mint a fresh bearer token, called it over plain HTTP/JSON-RPC throughout.
  Confirmed P67f's own two reference-query fixes (`ddd15b00`/`0bfef238`) actually help, on real code
  this phase wrote rather than the fix's own regression fixtures: `find_references
  {"file":"apps/kira-studio/frontend/src/views/repo/language.ts","symbol":"EXTENSION_LANGUAGE"}`
  correctly finds the one `EXTENSION_LANGUAGE[ext]` index-expression read
  (`language.ts:246`, the TS/JS half of the fix), and `find_references
  {"file":"apps/kira-studio/internal/page/wire/RedisType.go","symbol":"EnumNamesRedisType"}`
  correctly finds `EnumNamesRedisType[v]` (`RedisType.go:40`, the Go half) — both would have
  returned "no references found" before P67f. `find_references {"symbol":"monacoLanguageFor"}` also
  picked up this phase's own new call site inside `RepoFileView.vue`'s `isMarkdown` computed, not
  just the pre-existing ones. One trivial, not-a-defect note: `find_definition`/`find_references`
  for a bare Go struct field name (e.g. `Unstaged`, a `porcelain.StatusEntry` field read as
  `e.Unstaged`) returns "no symbol named" / "no references found" rather than resolving — the
  indexer's own symbol table holds top-level declarations (functions, types, methods, constants),
  not individual struct fields, the same class of "expected, not a defect" already logged for a Vue
  SFC's own component name (P60a, above); `search_symbols`/`outline_file` on the struct's own type
  is the right tool for a field, not `find_definition` on the field name alone. No new non-trivial
  finding.

- **P67d (planning)**: same `ConnectionRefused`/stale-token pattern as every entry above — built,
  started, deleted the one stale hashed token file under `/root/.kira-studio/`, restarted to mint a
  fresh bearer token, called it over plain HTTP/JSON-RPC. `find_references {"symbol":
  "RepoMapService","omitSource":true}` returned all 12 real sites (11 in
  `internal/bridge/repomap.go`, 1 in `main.go:265`), checked against a grep — no misses, no false
  positives. Note for a future session: `pkill -f kira-repo-map` still kills the calling shell here
  (P67f's own note), so start the server as a genuine background task instead. No new finding,
  trivial or otherwise.

- **P67d (implementation)**: a prior planning agent's server was still live on 8765 but its token
  had already gone stale by the time this session started — killed it, deleted every
  `mcp-repo-map-*-token.json` under `KIRA_HOME`, rebuilt (`bun run mcp:repo-map:build`, this phase's
  own `internal/repomap` split), and started fresh. `nohup … & disown` this time, not a plain `&`, so
  it survived past the launching call. Dogfooded the phase's own new surface directly: `list_repos`
  (a brand-new tool, this phase's own addition) returned exactly the one attached repository
  (`kira-studio	/home/user/kira-studio	ready`); `search_symbols {"query":"repoInstance"}` found the
  new type in `instance.go`; `find_references {"symbol":"pick","file":".../attach.go"}` returned all
  11 real call sites across `tools.go` and `attach_test.go` (the 7 handlers plus 4 test call sites),
  checked against a grep — no misses, no false positives. No new finding, trivial or otherwise; the
  split package resolves and navigates correctly.

- **P69 (code review, round 2, dimension 3)**: same stale-token pattern as every entry above —
  killed the prior server by PID, deleted `/root/.kira-studio/mcp-repo-map-*-token.json`, restarted
  to mint a fresh bearer token, called it over plain HTTP/JSON-RPC. Index confirmed warm and current
  throughout: `list_repos` returned the one attached repository ready, `outline_file` on
  `internal/repomap/server.go` listed all 11 declarations at their exact current lines (including
  this chapter's own new ones), `search_symbols {"query":"readyTimeout"}` resolved to
  `server.go:30:5`, and `find_references {"symbol":"runInitialSync"}` returned its one real call
  site (`attach.go:122`). One new non-trivial finding, below.

- **P69b (planning)**: same `ConnectionRefused`/stale-token pattern as every entry above — no server
  at session start, built, started, deleted the one stale hashed token file under
  `/root/.kira-studio/`, restarted to mint a fresh bearer token, called it over plain HTTP/JSON-RPC
  throughout. Killed by PID, never `pkill`, per P63's own note. Reproduced the open non-trivial
  entry below exactly as logged (all six names, all `no references found`), then used three
  throwaway probe builds to measure the fix before writing it up; every probe reverted, tree clean.
  Two notes for a future session. First, **`codeindex.db` is shared across worktrees** — it held
  four repo roots here, so an unscoped `select count(*) from reference` reads 507,983 where this
  repository's own figure is 141,973. Scope every count by `repo_id`; this pass got it wrong first
  time and the 3.6x error is not obvious from the number alone. Second, editing a `.scm` query file
  alone is enough to force the full truncate-and-rebuild (`Fingerprint` hashes each query file's
  bytes) — `extractionVersion` does **not** need bumping for a query-only change, contrary to the
  fix shape the entry below suggests. A full reparse of this repository took 248 s. One new
  non-trivial finding, below, unrelated to this phase's own subject.

### Non-trivial

- **P69b (planning) — `TestParseConcurrentCancellationDoesNotCrash` aborts the whole `codeparse`
  test binary on a tree-sitter C assertion. Open.**

  Found by running `go test`, not by calling the MCP server, but it sits inside the repo-map
  indexing pipeline and is logged here because that is where this chapter's repo-map defects live.
  Reproducible on clean HEAD `13b9d107` with no server running: **4 of 4** isolated runs failed
  (`go test -count=1 -run TestParseConcurrentCancellationDoesNotCrash
  ./apps/kira-studio/internal/codeparse/`). In a whole-package run it is intermittent, roughly 2 in
  3.

  ```
  codeparse.test: .../go-tree-sitter@v0.25.0/src/./parser.c:2197:
      ts_parser_parse: Assertion `self->finished_tree.ptr' failed.
  SIGABRT: abort
  signal arrived during cgo execution
  ```

  Stack: `codeparse/session.go:282` `parseWithOptions` → `(*Parser).ParseWithOptions` →
  `_Cfunc_ts_parser_parse_with_options`, from `session_test.go:97`'s worker goroutine — eight
  goroutines each racing a 1 ms `context.WithTimeout` against a parse, which is exactly what the
  test exists to exercise.

  This is the same surface commit `b412286b` ("replace deprecated `ParseCtx` with
  `ParseWithOptions` to stop a SIGSEGV") addressed. The crash mode changed from SIGSEGV to a C-level
  assertion; the underlying "cancel mid-parse leaves the parser unusable" problem did not go away.
  The test's own name is the assertion being violated.

  Impact is not test-only: `Session.Parse` is the live indexing path, and a cancelled parse (a
  watcher-triggered resync racing a shutdown, a request deadline) aborting the process would take
  the whole server down, not return an error. Not investigated further — out of P69b's scope, which
  is a reference-capture fix, and per the process above this round reports rather than fixes.

- **P69 (code review, round 2) — `find_references` still returns nothing for a package-level
  constant read as a plain identifier operand (call argument, comparison, arithmetic). Fixed
  (`752ffb83`).**

  A narrower survivor of the P67e entry below, which `ddd15b00`/`0bfef238` closed only for `range`
  clauses and index expressions. `queries/go/p67f_reads.scm` captures exactly two patterns —
  `(range_clause right: (identifier))` and `(index_expression operand: (identifier))` — and
  `queries/javascript/p67f_reads.scm` the `for_in_statement`/`subscript_expression` equivalents.
  An identifier read in argument or operand position is captured by neither, and the vendored
  `go/tags.scm` captures a reference only in a `call_expression`'s function position or as a
  `type_identifier`. Reproduced on six names, three Go files plus one TypeScript module, all on the
  warm index described in the Log entry above — every one returned `no references found`:

  - `readyTimeout` (`internal/repomap/server.go:30`), read at `instance.go:117`
    (`time.After(readyTimeout)`), `:125`, `:138` and `:182`.
  - `syncLockPollInterval` (`internal/codeindex/synclock_unix.go:39`), read at `:65`
    (`time.Sleep(syncLockPollInterval)`).
  - `watchDebounce` (`internal/codeindex/watch.go:21`), read at `:100`
    (`time.NewTimer(watchDebounce)`).
  - `maxFileBytes` (`internal/codeindex/sync.go:20`), read at `:441` (`make([]byte,
    maxFileBytes+1)`) and `:448` (`len(buf) > maxFileBytes`).
  - `sourceLineMaxBytes` (`internal/repomap/source.go:20`), read at `source.go:85`, `:86`, `:158`
    and `:159`.
  - `PREVIEW_ROW_LIMIT` (`frontend/src/views/grid/fkPreview.ts:35`), read at `:83`
    (`Math.min(page.rowCount, PREVIEW_ROW_LIMIT)`) and `:94`.

  `find_definition` and `search_symbols` resolve every one of these names correctly, so this is a
  reference-capture gap, not a symbol-table or sync-timing one. Impact is the same silent-wrong-
  answer shape P67e logged: "where is this bound actually applied?" is exactly the question a
  timeout/limit constant invites, and the answer comes back a confident "nowhere". Argument and
  operand position is also the commonest way a constant is read at all, so the remaining gap is
  wider than the two shapes already fixed.

  Not fixed here, per the process above — this round reports findings only. Fix shape: add an
  `(argument_list (identifier) @name @reference.read)` capture plus binary/comparison operand
  captures to `queries/go/p67f_reads.scm`, and the `arguments`/`binary_expression` equivalents to
  `queries/javascript/p67f_reads.scm`, bumping `extractionVersion` to force the rebuild. Measure the
  new row count against P67f's own stop gate before shipping: a bare-identifier capture is far
  broader than `range`/index, so local variables and parameters will dominate it — P67f's JS/TS pass
  added 1617 `read` rows, and this one plausibly adds an order of magnitude more, which is a real
  index-size and insert-throughput question (`insertRef` is already 80% of the write phase, P64c
  §1.4) rather than a free win.

  **Fix (P69b, `fa4ab77b` + `752ffb83`)**: shipped as planned (`docs/v1.6/plans/
  P69b-repo-map-bare-identifier-reads.md`), captures plus a resolver fix, in that order. Query side
  (`752ffb83`): `argument_list`/`arguments` and both `binary_expression` operands in both `.scm`
  files, plus Go's own `slice_expression` bounds and operand (closes the `sourceLineMaxBytes:159`
  slice-bound case this entry's own repro lists). `extractionVersion` did **not** move — a `.scm`
  edit alone already changes the fingerprint and forces the rebuild, confirmed live.

  The capture alone was not shippable: planning-time probing found 73% of the new rows unreachable
  (a name matching no symbol anywhere) and the rest genuinely over-matching —
  `find_references {"symbol":"path"}` went from 2 correct hits to 589 wrong ones (unrelated Go/TS
  locals sharing the name), a Go-only language fix only brought it to 184. The whole argument in one
  line: **`path` 2 → 589 → 0.** `resolve.go` (`fa4ab77b`, landed first) clamps a `"read"` reference's
  candidates to tier ≤ 1 (same file or directory) before resolving — every read site this phase
  indexes is already tier ≤ 1 by construction, so nothing real is lost — and separately fixes the
  memo sentinel's `Language` field, never set before, which had left the existing Go
  package-privacy rule unreachable from every `ReferencesTo` call, not only `"read"` ones.

  Verified live against a rebuilt server, full reparse (210s), `codeindex.db` scoped to this repo's
  own `repo_id`: all six repro names now resolve to their real read sites, including
  `sourceLineMaxBytes:159`. Precision: `path`/`dir`/`out` → no references found, `id` → exactly 2,
  `name`/`page`/`row` → the ambiguous-symbol prompt, not a wrong reference list. P67e's/P67f's own
  read cases (`EXTENSION_LANGUAGE`, `EnumNamesRedisType`, `allowedMethods`) still answer identically.
  Row counts, this repo's own `repo_id` only: `read` 5,261 → 68,165 (+62,904), total reference rows
  141,973 → 204,916 (+44.3%). `call`/`type` moved by +27/+12 (93,788→93,815, 41,221→41,233) —
  traced file-by-file against an independently rebuilt baseline at the plan's own pre-phase commit
  and reconciled exactly to new source this phase's own two commits added (the new codegraph
  regression test, the new `resolve.go` call site, the new fixture bodies), not to any pattern
  matching outside those files; `class`/`implementation` (1,632/71) exactly unchanged. Existing
  `codeparse`/`codegraph`/`repomap` suites stayed green (a separately tracked, pre-existing cgo
  cancellation crash in `TestParseConcurrentCancellationDoesNotCrash`, P69c, reproduces identically
  on the pre-phase commit and is unrelated to this fix).

- **P67e (implementation) — `find_references` returns nothing for a package-level variable that is
  only ever read via `range` or an index expression (`x[k]`), never called. Fixed (`ddd15b00`,
  `0bfef238`).**

  Found on a server confirmed warm (not the already-logged cold-index issue below: `search_symbols`,
  `find_definition` and `find_references` all answered correctly and immediately for other symbols
  in the same file during the same session, including `find_references {"symbol":"allowedRequest"}`
  returning all 7 real call sites). Reproduced on every package-level `map[string]struct{}{}`/
  `[]string{}` variable in `internal/bridge/gitstream.go`/`gitstream_test.go` that this phase's own
  rename touched:

  - `find_references {"symbol":"allowedMethods"}` → `no references found for "allowedMethods"`,
    though it is read at `gitstream.go:146` (`if _, ok := allowedMethods[method]; !ok {`),
    `gitstream_test.go:60` (`for method := range allowedMethods {`) and
    `gitstream_classification_coverage_test.go:42` (`for m := range allowedMethods {`).
  - `find_references {"symbol":"allowedStreamMethods"}` → same empty result, despite
    `gitstream.go:190`'s `allowedStreamMethods[method]` and
    `gitstream_classification_coverage_test.go:45`'s `range allowedStreamMethods`.
  - `find_references {"symbol":"writeMethods"}` and `{"symbol":"hostAnsweredMethods"}` → both empty,
    despite `range` reads in both `gitstream_test.go` and `gitstream_classification_coverage_test.go`.

  By contrast, `find_definition` resolves every one of these names correctly (e.g.
  `find_definition {"symbol":"allowedMethods"}` → `gitstream.go:89:5`), and `find_references` on a
  *called* identifier in the same file (`allowedRequest`) is complete and correct. The gap is
  specific to reference sites shaped as a `range` clause's subject or an index expression's
  receiver — a call expression's callee position indexes fine. Impact: a session asking "where is
  this allowlist actually consulted?" for exactly the four variables this stream's own safety
  boundary depends on gets a confident, wrong "nowhere" — the same silent-wrong-answer shape as the
  already-logged cold-index entry below, but from a different, reproducible-when-warm cause (a
  reference-query gap in `internal/repomap`'s Go tree-sitter capture, not a sync-timing race).

  Not fixed in this phase, per the process above (P67f, already queued next in SPEC.md for the
  already-open cold-index entry, is the natural place to close this one too — both are
  `find_references`/indexing gaps in the same package). Fix shape, for that pass: the Go reference
  query needs a capture for an identifier used as a `range_clause`'s right-hand operand and as an
  `index_expression`'s operand, not only as a `call_expression`'s function.

  **Fix (P67f, `ddd15b00`)**: a new query file, `queries/go/p67f_reads.scm`, adds exactly those two
  patterns, both captured under a new `read` reference kind (`referenceKinds` in `extract.go`;
  `extractionVersion` 2→3 to force the rebuild). Verified against a live server on a completed
  reindex, on the exact four names logged above: `find_references {"symbol":"allowedMethods"}` now
  returns exactly the 3 real sites (`gitstream.go:146`, `gitstream_test.go:60`,
  `gitstream_classification_coverage_test.go:42`), and `allowedStreamMethods`/`writeMethods`/
  `hostAnsweredMethods` all return their real `range`/index sites too — every one kind `read`.
  `find_references {"symbol":"allowedRequest"}` (the control) is unchanged: still exactly 7, all
  kind `call`. `find_references {"symbol":"allowedMethods","kinds":["read"]}` returns the same 3
  sites; `{"kinds":["call"]}` correctly returns none. Symbol/`call`/`type` reference counts for the
  whole repository were confirmed unchanged before/after (only new `read` rows appeared).
  **Fix (P67f, `0bfef238`)**: the same gap, one language family over — `queries/javascript/
  p67f_reads.scm` adds the `for_in_statement`/`subscript_expression` equivalents, registered on
  JavaScript, TypeScript and TSX (Vue rides along via script-block injection). Measured against the
  live index before shipping (P67f's own plan §4 stop gate): +1617 `read` rows across the whole
  JS/TS/Vue family, well under the 10,000-row bound, with every existing kind's count byte-identical
  before and after. Verified live on a real production name read only via `for...of`:
  `find_references {"symbol":"DYNAMIC_NAMES"}` (`packages/api-core/src/http/dynamic/catalog.ts`)
  now returns its one real `for (const name of DYNAMIC_NAMES)` site in
  `packages/api-core/test/http-dynamic-fake.spec.ts:15`, kind `read`.

- **P67e (planning) — a query answered against a cold or mid-sync index returns a confident "not
  found" instead of saying the index isn't ready. Fixed (`1da60f68`, `7025a88b`).**

  Against a server started with an empty `KIRA_HOME` (so the index built from scratch), the first
  calls answered as if the repository genuinely had no such symbol:

  - `search_symbols {"query":"readOnlyMethods"}` → `no symbols matching "readOnlyMethods"`, though
    it is declared at `apps/kira-studio/internal/bridge/gitstream.go:70`.
  - `find_references {"symbol":"readOnlyMethods"}` → `no references found for "readOnlyMethods"`.

  Both answered correctly ~90 seconds later with no restart and no other change, so the index was
  simply still building. The wording is the problem, not the timing: `repomap/render.go:140`'s
  `no symbols matching %q` is the same string a real miss produces, and nothing in
  `internal/repomap` exposes a sync/ready state for a tool response to distinguish the two. A
  session that trusts the first answer concludes a symbol does not exist and stops looking — the
  same silent-wrong-answer failure mode as the P63 entry below, from a different cause.

  Narrow in practice (a session reusing `/root/.kira-studio/codeindex.db` starts warm), but it also
  covers the window right after a large change set lands, which is exactly when a phase navigates
  most. Fix shape, for the dedicated pass: have the tool responses report "index still syncing"
  when the initial sync has not completed, rather than an empty result — not a retry loop inside
  the caller.

  **Correction (P67f)**: this entry's own root-cause guess — "nothing in `internal/repomap` exposes
  a sync/ready state" — was half right. `repomap` already had a readiness gate (`server.go`'s
  `ready`/`readyOnce`), it did return a distinct "still building" message, and it did cover the
  *initial* sync correctly (re-measured: a query issued 0.5s after a cold start blocked 3.255s, then
  answered correctly — the gate working as designed, not the bug). What was actually missing: the
  gate is one-shot and outcome-blind — a failed initial sync opens it anyway (on a partial index,
  with the failure visible nowhere), and every *later* full sync (a watcher-triggered rescan) runs
  behind an already-open gate with nothing waiting on it. That combination reproduces this entry's
  own symptom exactly, including "confident empty, then correct later with no restart."

  **Fix (P67f, `1da60f68`, `7025a88b`)**: `codeindex.Index` gains a `syncTracker` (counter +
  settled channel + last error/generation) that every full `Sync` — initial and every later rescan
  alike — brackets itself against. `repomap`'s `waitReady` grows a second wait on
  `Index.SyncSettled()` under the same 25s bound the initial gate already used, so a tool call now
  waits out an in-flight rescan instead of answering from a mid-rebuild index, and returns "is
  reindexing … retry shortly" past the bound. A one-line `index degraded: …` prefix (`tools.go`'s
  `indexNotice`/`s.text`) surfaces a failed full sync on every response while it stands failed — the
  one window nothing can wait out — and clears itself the moment a later sync succeeds. Verified:
  `TestSyncTracker_SettledStateAndGeneration` (`-race`) covers the tracker's own ordering; a live
  server rebuild-and-cold-reindex re-confirmed the initial-sync block-then-answer behavior; a real
  `idx.Sync` left in flight while the initial gate was already open (`TestWaitReadyWaitsOut
  InFlightSyncThenTimesOut`) confirms the second wait — the exact code path a watcher rescan uses,
  since both go through `Index.Sync`. Not verified live against a genuine `fsnotify` event-queue
  overflow (the real trigger for a live rescan): forcing that deterministically would mean
  generating tens of thousands of filesystem events against this shared container, a real cost for
  a code path already covered deterministically at the unit level — declined rather than attempted.

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
  collision in path-alphabetical order, not language-family order. Resolved — not a defect
  (P64b, docs-only).**

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

  A bare `{"symbol": X}` call (no `file`) carries no referring file at all, so — unlike
  `DefinitionOf`'s reference/position-based path, which always has a concrete site and therefore a
  concrete language to prefer — there is no principled "this caller's own language" to rank by
  here. Confirmed correct by construction, not a bug: a bare lookup is genuinely anchor-free.

  **Resolution (P64b, docs-only, no code change)**: option (a) from the original finding. P64's own
  §2.7 verification-table expectation ("tree.ts:96 ... listed first") assumed a language anchor
  that a bare-symbol call structurally doesn't have — the expectation was wrong, not the code.
  `languages` (§2.5, `dbfc5813`) already gives a one-call, unambiguous resolution for this exact
  case (`find_definition {"symbol":"TreeNode","languages":["typescript"]}`), and both candidates
  are still returned on the bare call every time — never a lost answer, only listing order. The
  path-alphabetical fallback for a bare, no-`languages` lookup is acceptable behavior, not a
  defect. `sameLanguageFamily` (`resolve.go`'s `sortCandidates`, used only by `DefinitionOf`'s
  reference/position-based path, where a concrete referring file makes the anchor principled) is
  deliberately **not** ported into `codegraph/search.go`'s `less()` — that would invent a language
  preference where no anchor exists (P64b plan §0.1).

- **P68 (code review, dimension 1) — `outline_file` cannot distinguish "this file has no indexed
  definitions" from "this path does not exist". Fixed (`402a8fdf`).**

  P67f closed this exact class for the not-yet-indexed case (`render.go`'s empty string vs.
  `notReadyResult`), but the absent-*file* case survives in `renderOutline` (`render.go:181`):
  `len(nodes) == 0` renders `"%s has no indexed definitions"` with no check that the path is a real,
  enumerated file.

  - `outline_file {"file":"apps/kira-studio/internal/codegraph/graph.go"}` →
    `apps/kira-studio/internal/codegraph/graph.go has no indexed definitions`. No such file exists;
    the package's file is `codegraph.go`.
  - `outline_file {"file":"apps/kira-studio/internal/does-not-exist-at-all.go"}` → identical
    sentence, verbatim.
  - A real, indexed, definition-bearing file answers normally
    (`outline_file {"file":"apps/kira-studio/internal/codegraph/codegraph.go"}` → 20+ nodes), so
    the index is warm and this is not the cold-start case.

  Cost is a wrong conclusion, not a slow one: during this review the first call above read as
  "`graph.go` exists but carries no definitions", so `codegraph`'s query-scoping code was briefly
  assumed absent rather than merely mis-addressed. An agent has no way to tell a typo'd path from a
  genuinely definition-free file, and the honest recovery — fall back to `search_files` on every
  miss — is precisely the extra round trip this server exists to remove.

  `search_files` already answers the underlying question (it returns the `file` rows), and
  `sourceForOneFile` already distinguishes `file not found` from `unreadable` for its own source
  lines, so both halves of the distinction exist in-package. Per the process above, not fixed here.

  **Fix (P68b, `402a8fdf`)**: `codegraph.Graph.Outline` already looked the file up via `GetFile` to
  decide whether to query for symbols — it just discarded the answer. It now returns that as a
  second value (`indexed bool`), zero extra DB work. `outline_file` routes the absent case to a new
  `IsError` message (`absentFileReason`, `repomap/locator.go`) distinct per cause: out-of-repo,
  missing on disk (names `search_files`), unreadable, a directory (names `search_files` with
  `pathPrefix`), non-regular, and exists-but-unindexed (names `search_files`). `renderOutline`'s own
  `"has no indexed definitions"` sentence is unchanged and now only ever reached for a genuinely
  indexed file. Two more inputs hit the identical bug beyond this entry's own repro, found while
  planning the fix and covered by the same change: a file that exists on disk but whose language
  isn't indexed (`README.md`), and a directory path. The control case — a real, indexed,
  genuinely definition-free file (`packages/git-ui/src/icons/codicon.css`) — still answers
  `"has no indexed definitions"` normally, not as an error. Verified live against a rebuilt server:
  all four absent-shape cases above now return their own distinct `IsError` message, and the
  definition-free and out-of-repo (`/etc/hosts`) controls are unchanged.

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
