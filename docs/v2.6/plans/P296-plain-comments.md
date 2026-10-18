# P296 plan: code comments are plain comments

SPEC row P296 (`docs/v2.6/SPEC.md`). Base: `e8bb1fd3` (v2.6). Planner: Opus. Implementer: one sequential
Sonnet subagent (section 5). No split: the removals chain (`commentFor` needs `FormatComment`, `memcheck` needs
`ParseComments`, the flow test needs both), so every group depends on the one before.

Discovery: `codegraph_explore` over `ParseComments FormatComment MarkersFor commentFor Service.Prepare
PrepareResult asComment commentMarker`, over `memcheck Check scannable ParseComments callers`, and over
`memcheck Run installHook InstallCommand HookLine TestCommentCheckHook asCommentThroughClaude FactIDPattern`;
`git grep` for every symbol, i18n key, IPC channel, contract key and budget line below; reads of
`internal/memory/memfmt/*`, `internal/memory/memcheck/*`, `internal/memory/mcpserver/server.go`,
`internal/memory/service.go` (Prepare block), `internal/llmprompts/registry.go` (memory entries),
`testdata/budget.tsv`, `cmd/checkprompts/style.go`, `packages/theme/src/i18n/en.json`, the three site pages,
`site/scripts/docsRules.ts` (`sources:` rule), `docs/ARCHITECTURE.md` (memory section),
`docs/DEV_ENVIRONMENT.md` (real `claude` rows), `apps/kira-space/tests/claude/memory{,_docs}_test.go`,
`apps/kira-space/internal/flows/memoryflow/format_test.go`, `.githooks/*`.

## 1. Current state (verified)

- `store_memory` `asComment` (path or extension) runs `Service.Prepare`: same `decide` as `Store`, persists
  nothing, mints fresh unstored ids for `add`, then `commentFor` builds `memfmt.Block`s and
  `memfmt.FormatComment` renders a `kira-memory origin=… scope=…` header plus `<km_id> <fact>` lines in the
  marker `MarkersFor` picks. So an `add` id in a pasted block never resolves: it was never stored.
- Consumers of the comment format: `memfmt` (`ParseComments`, `commentParser`, `blockState`, `commentText`,
  `inScopeText`, `factLine`, `parseHeader`, `FormatComment`, `commentWriter`, `Block`, `CommentLine[Source]`,
  `markers.go` whole), `memcheck` (`Check` comment branch, `scannable`, `--print-regex` comment line),
  `mcpserver` (`AsComment`, `commentMarker`, `prepareMemory`, `storeOutput.Comment/Prepared`, status
  `prepared`), `service.go` (`PreparedFact`, `PrepareResult`, `Prepare`, `preparedFact`, `cleanText`,
  `commentFor`), `llmprompts` (`store_memory` description sentence, `arg asComment`, `MemoryStorePrepared`),
  `budget.tsv` (2 lines), `en.json` (`llmPrompts.entry.memoryMcpStorePrepared`, `memory.commentCheck.*`), bridge
  `MemoryCommentCheck`/`CommentCheck` and its UI (`CommentCheckSection.vue`, schema, control, query, mocks,
  contract `memory-settings.json`, visual `settings.spec.ts`), tests (`memfmt_test`, `check_test`,
  `server_test` `TestAsCommentPersistsNothingAndTextIsGrepFirst`, `service_test`
  `TestPrepareMapsDecisionsToIDs`, flow `TestMcpPrepareComment` and `TestCommentCheckHook`, real `claude`
  `asCommentThroughClaude`), site `memory-formats.md`, `mcp-tools.md`, `space/memory.mdx`,
  `docs/ARCHITECTURE.md` lines ~4856, 4909-4944.
- Not consumers: `internal/mcpinstall` holds no comment text (grep); the "install instructions" are the server
  instructions `memory.mcp.instructions`. `.githooks/*` never runs `memory-check`. No memory gate, reconcile or
  import prompt mentions comments. `tests/claude/memory_eval_corpus_test.go` `isCommentLine` extracts Go doc
  comments for an eval corpus, unrelated. `gitreview.FormatComments`, `ade.PrepareResult` are other features.
- Comment blocks already in the repo: none in code. Only historical plan docs (`docs/v2.5/plans/P273-…`,
  `P285-part3-…`), the site `memory-formats.md` example, and test fixtures.

## 2. Decisions

### D1. Reference syntax: the bare fact id

A code comment cites a memory with its fact id as one token: `km_` plus 12 Crockford base32 chars, the
existing `memfmt.FactID`. Anywhere in the comment, surrounded by any prose:

```go
// Amounts are integer cents; the ledger rejects fractions (km_7h3kq9x2mfa4).
```

- Fact id only, never a version id (`km_….3`): the fact id always resolves to the current version.
- Grep-first: `grep -rn km_7h3kq9x2mfa4` finds every citing comment, and the same grep over the store output
  finds every version. All references: `grep -rnoE 'km_[0-9a-hjkmnp-tv-z]{12}'`.
- Cannot be read as prose: a fixed prefix plus 12 lowercase base32 chars. It is already how agents cite a
  memory (`memory.mcp.instructions`: "Cite a memory by fact id") and how one fact cites another.
- The comment holds nothing else of the memory: no header, no fact copy, no reason, origin, scope, keywords.
  Its own words are a normal comment.

Rejected: `memory:km_…`, `@km_…`, `[km_…]` (a prefix or bracket adds characters and no information; `km_`
already namespaces it); `kira-memory km_…` (collides with the retired header D3 detects); a `kira://memory/…`
URL (no resolver handles it, longer); a required `see` word (prose-dependent, not one token); version ids
(pin a stale version).

### D2. Validator does not resolve references

`memory-check` never opens `memory.db`. Reasons: the store is per user and local (`~/.kira-memory`), so a
reference valid for its author fails for every teammate and in CI; P273's rule "No `memory.db` check, so hooks
and CI run anywhere" stays. The id resolves by construction: the agent stores first and cites the returned
id. An agent checks one with `memory_history` when it needs to.

Rejected: an opt-in `--resolve` flag (no consumer, same per-user problem); a malformed-id check on plain
comments (a comment or identifier such as `km_per_hour` would be flagged in other people's repos; the
`km_`-token rule stays for doc text only, via `CheckText`); resolving against `.memory.md` docs in the repo
(docs are not the store).

### D3. What `memory-check` does with comments: flags retired blocks only

- Doc paths (`.md`, `.txt`): `ParseDoc` and the cross-file drift check, unchanged (P297 owns docs).
- Every other scanned file: one problem per retired block header, nothing else. Header = a line matching
  `^[[:space:]]*(//|#|--|;|%|<!--|/\*) kira-memory [a-z]+=` (the old marker set, as the old
  `CommentLineSource` listed it; `[a-z]+=` also catches a malformed header; `kira-memory-check` and prose
  such as `// kira-memory server` never match). Fact lines (`// km_… text`) are not flagged: that shape is
  also a legal plain comment that starts with a reference.
- Message (memfmt style, lowercase, no period): `kira-memory comment blocks are retired (P296); store the
  facts with store_memory and cite the returned km_ id in a plain comment`.
- Scope of scanned files: `markers.go` goes, so `scannable` goes; every tracked or staged file that passes
  `usable` (4 MiB cap, no NUL in the first bytes) is read. Newline-in-path guard in `staged` stays.
- `--print-regex` prints `doc: <DocLineSource>` and `reference: <FactID>`; the `comment:` line goes.
- Exit codes, `--staged`, `--install-hook`, hook script, `hookMarker`, `InstallCommand`, `HookLine` unchanged.

Why keep any comment scan: v2.5 users have pasted blocks whose `add` ids were never stored (section 1), which
breaks "the id always resolves". Rejected: dropping comment scanning (those blocks go unnoticed); keeping
`markers.go` to scope the detector (80 lines of extension table kept for one regex that already carries the
marker set).

### D4. Existing blocks and migration

- This repo: none in code. Historical plan docs stay as written (records). The site example is rewritten (D7).
- Other repos: the hook reports each block with D3's message. Migration is agent-driven and manual: store each
  fact with `store_memory` (gate and reconcile run; a stored match comes back as a noop with its existing id),
  then replace the block with a plain comment citing the returned ids, or delete it. Never reuse the block's
  ids: `add` ids in it were never stored. Rejected: `memory-check --migrate` or any tool that rewrites files
  (the memory tool never touches files, and each fact needs a real gated store call).

### D5. Removals and keeps, per symbol

`internal/memory/memfmt`:
- Delete `markers.go` (`Marker`, `markersByExt`, `extOf`, `MarkersFor`, `Supported`). Move `IsDocPath` into
  `memfmt.go`: lowercase `path.Ext` is `.md` or `.txt` (its only callers are `memcheck`; bare-word extension
  support existed only for `asComment`).
- `parse.go`: delete `factLine`, `commentText`, `inScopeText`, `blockState`, `commentParser` and its methods,
  `ParseComments`, `parseHeader`. Add `retiredHeader` regex and `RetiredComments(src []byte) []Problem` (D3).
  Rename `retiredCommentMsg` to `retiredLineMsg` (the doc parser is its only user; text unchanged). Keep
  `retiredLine`, `isReasonText`, `validOrigin`, `validScope`, `sourceTag`, `splitLines`, all doc code.
- `format.go`: delete `commentWriter`, `FormatComment`. `checkProvenance(p, doc bool)` loses `doc` (only the
  doc writer calls it; keep the doc checks). Keep `retiredPrefixes` and `checkFact` (doc writer uses them).
- `memfmt.go`: delete `Block`, `CommentLineSource`, `CommentLine`. Package doc: one doc format plus shared ids
  and text rules; comments cite by id. `Provenance` comment drops the comment sentence.
- `locator.go`, `text.go`: unchanged.

`internal/memory/memcheck`: `check.go` non-doc branch calls `memfmt.RetiredComments` (no facts counted from
code files); package doc updated. `source.go`: delete `scannable`; `readDisk` and `staged` keep `usable` only.
`run.go`: print-regex per D3; flag help text unchanged.

`internal/memory/service.go`: delete `PreparedFact`, `PrepareResult`, `Prepare`, `preparedFact`, `cleanText`,
`commentFor`. Keep `decide` (Store uses it), `factOr`, `reasonOr`, `newFactID`, `keptBesideWhy`. Check
`decide`'s doc comment for a Prepare mention. Drop the `memfmt` import only if nothing else in the file uses it
(`ParseLocator`/`Locator` still do).

`internal/memory/mcpserver/server.go`: delete `storeInput.AsComment`, `commentMarker`, `prepareMemory`,
`storeOutput.Comment`, `storeOutput.Prepared`; status comment becomes `"stored" | "challenged"`;
`storeMemory` loses the marker branch; `storeOutput` doc drops the asComment clause; drop the `memfmt` import
if unused. The arg leaves the schema (`InputSchema[storeInput]` derives it). A stale client sending
`asComment` then gets a schema error from the SDK, if the generated schema closes `additionalProperties`;
either outcome is fine, no code for it.

### D6. Prompts (`internal/llmprompts/registry.go`)

- Delete the `asComment` arg line and `MemoryStorePrepared`.
- `memory.mcp.tool.store_memory`: replace `With asComment, stores nothing and returns the facts as a code
  comment.` with `A code comment cites a stored fact by its id only.`
- `memory.mcp.instructions`: replace the distill paragraph's first sentence group with:

  ```
  Code comments are plain comments. Never write a kira-memory header, fact, reason, origin or scope into one. To tie a comment to a memory, store it first, then cite the returned fact id (km_...) in the comment.
  Condense long text or a file into short lines without storing (for a comment too): call distill with text or an absolute path; do not Read the file first. Mode instructions for prompts. To store a file use ingest_files.
  ```

  (the distill sentences keep their wording plus `(for a comment too)`; P297 rewrites distill.)
- `testdata/budget.tsv`: delete `memory.mcp.tool.store_memory.arg.asComment` and `memory.mcp.store.prepared`;
  set `memory.mcp.instructions` and `memory.mcp.tool.store_memory` to the new rendered sizes (run
  `go run ./internal/llmprompts/cmd/checkprompts`, it prints the size). No golden file covers these entries
  (grep); run `go test ./internal/llmprompts -run TestGolden` anyway.
- `en.json`: delete `llmPrompts.entry.memoryMcpStorePrepared`.

### D7. Wire, bridge and UI: rename "comment check" to "check hook"

The Settings section stays (the hook still validates docs and flags retired blocks), but every "comment"
name now lies. One term per concept:

| Old | New |
|---|---|
| Go `bridge.MemoryCommentCheck`, method `MemoryService.CommentCheck` | `MemoryCheckHook`, `CheckHook` |
| `packages/shared/domain/memory.ts` `memoryCommentCheckSchema`, `MemoryCommentCheck` | `memoryCheckHookSchema`, `MemoryCheckHook` |
| `module.ts` `memoryCommentCheck()`; `queries.ts` `useMemoryCommentCheck`, key `'commentCheck'` | `memoryCheckHook()`, `useMemoryCheckHook`, `'checkHook'` |
| `apps/kira-space/frontend/src/bridge/memoryControl.ts` entry | renamed, calls `MemoryService.CheckHook` |
| `settings/CommentCheckSection.vue`, `MemoryPane.vue` import | `settings/CheckHookSection.vue` |
| i18n `memory.commentCheck.*` | `memory.checkHook.*` |
| test `ipcChannels.ts` `memoryCommentCheck: 'kira:memory:commentCheck'`, `mockRuntime.ts` two entries | `memoryCheckHook: 'kira:memory:checkHook'`, `'MemoryService.CheckHook'` |
| contract key `MemoryService.CommentCheck` (`tests/contract/memory-settings.json`) | `MemoryService.CheckHook` |
| flow `TestCommentCheckHook` | `TestCheckHook` |

`data-testid="memory-check-*"` stay (already neutral). Copy (check-copy rules apply):
- `memory.checkHook.title`: `Memory commit check`
- `memory.checkHook.description`: `Checks kira-memory doc files in any git repository and flags retired kira-memory comment blocks. The hook reads staged files only and skips itself when this app is missing.`
- `install.hint`, `hook.hint`: unchanged.
Regenerate bindings with `wails3 task common:generate:bindings` (never hand-edit `frontend/bindings`).
The section's `// P273:` comment becomes `// P273, P296: the commands that install the memory commit check in another repository.`

Rejected: keep the wire names and change copy only (names say "comment" for a check that no longer reads
comments); remove the section (the hook still has a job).

### D8. Docs

- `site/.../reference/memory-formats.md`: description `The plain-text doc format for memory facts, and how a
  code comment cites a memory.` Intro: the doc format is grep-first. Replace `## Code comments` with: a code
  comment is a plain comment; it cites a memory by fact id only (D1 example); store first, then cite;
  `memory-check` flags a retired `kira-memory` block (D3 message gist) and the D4 migration, including "never
  reuse its ids". Drop the marker list. The retired-format paragraph keeps the doc v1 and `<id> fact:` lines.
  `sources:` drop `markers.go`, add `internal/memory/memcheck/check.go`.
- `reference/mcp-tools.md`: drop the `asComment` bullet; add one line under `store_memory`: `To cite a memory in
  a code comment, write its fact id.`
- `space/memory.mdx`: heading `## Check memory docs`; body: the pre-commit hook checks kira-memory doc files and
  flags retired comment blocks. `sources:` unchanged (paths still exist).
- `docs/ARCHITECTURE.md`: tools list drops `asComment`; "Agent docs (P276)" contract adds "a code comment cites a
  memory by fact id only; the tool never writes or returns comment text"; "Text formats" bullet drops
  `MarkersFor` and "Both formats" becomes the doc format; replace the "Comment format" bullet with a
  "Code comments (P296)" bullet (D1, D2, D3 in brief); delete the `asComment` bullet; "Validator" bullet:
  docs plus retired-block detection, `--print-regex` prints doc and reference, Settings names
  `CheckHookSection.vue`, `MemoryService.CheckHook`.
- `docs/DEV_ENVIRONMENT.md`: real `claude` table unchanged in paths; record the measured spend of the new
  subtest (D9) in the spend line.
- `apps/kira-space/internal/appwire/wire.go` comment (~line 48): `memory-check is the kira-memory doc
  validator, run as a git hook.`
- Do not touch the `.memory.md` format, `ParseDoc`, `FormatDoc`, `DocLineSource`, `writedoc.go`, `applydoc.go`,
  ingest write-back (P297 seam).

### D9. Tests (CLAUDE.md test bar)

Delete: `memfmt_test` `TestParseCommentsValid`, `TestParseCommentsRules`, `wrap`, `blockLines`, `clearLines`,
the comment half of `TestFormatRoundTrip` (keep the doc half and the doc retired-prefix refusal), the comment
half of `TestRegexMatchesParser` (keep the doc half); `service_test` `TestPrepareMapsDecisionsToIDs`;
`server_test` `TestAsCommentPersistsNothingAndTextIsGrepFirst`; flow `TestMcpPrepareComment` (and `storeOut`
fields `Comment`/`Prepared` plus `callStore` if nothing else uses them; `factID` helper likewise);
`asCommentThroughClaude` and its call. No replacement test for the removal (single bad input to single error).

Rewrite:
- `memcheck/check_test.go` `TestCrossFileDrift` (cross-file rules, complex): fixtures become `kira-memory: 2`
  docs (`*.memory.md`) for the drift and reason cases, plus one `old.go` holding a retired block and one
  `plain.go` whose comment cites `idA` (no problem). Assert the drift lines, the retired line at its header,
  the count, and the clean run's `N file(s), M fact(s) ok`. Keep fixture strings so no source line starts with a
  comment marker followed by `kira-memory ` (this repo's own `memory-check` run must stay clean).
- Flow `TestCheckHook` (backend half of contract `memory-settings`): orphan-`km_` and P273-line commits are
  replaced by: a retired block commit is blocked with `bad.go:2:` and `retired (P296)`; a plain comment citing
  `km_7h3kq9x2mfa4` commits clean; foreign-hook part unchanged. Rewrite the contract with `KIRA_CONTRACT=write`.
- UI half `settings-memory.spec.ts`, plus `copy-coverage.spec.ts`, `visual/settings.spec.ts`: rename only.
  Visual baseline: copy changed, so update the `settings` snapshot after confirming Inter per
  `docs/DEV_ENVIRONMENT.md` "tests/visual/* pixel diffs".

Add (real `claude`, opt-in, it proves the prompt change steers): `TestMemoryMcpFollowsDocs` subtest `comment`.
The test writes `billing.go` (`package billing` plus `func Charge(amount int) {}`) in `repo`; one-sentence
prompt: `Add a comment above func Charge in billing.go saying amounts are integer cents because the ledger
rejects fractions, and remember that for the team with the kira-memory server.` Allowed tools: `memTools` plus
`Read,Edit`. Assert: a `store_memory` use exists and no use input has an `asComment` key; `billing.go` holds a
`km_` id equal to a stored row's lineage id (`app.W.Memory.Recent`); `memfmt.RetiredComments` on the file is empty. Update the test's doc comment.

## 3. Commit groups (Conventional Commits, in order)

1. `refactor(memory)!: drop store_memory asComment and Service.Prepare`: D5 `service.go` and `mcpserver`,
   D6 arg and `MemoryStorePrepared` deletion, budget lines, `en.json` entry, deleted tests, flow and real
   `claude` removals. Footer `BREAKING CHANGE: store_memory no longer accepts asComment.`
2. `refactor(memory)!: memfmt drops the comment format; memory-check flags retired blocks`: D5 `memfmt`,
   `memcheck`, `TestCrossFileDrift`, `memfmt_test` trims, flow `TestCheckHook` behaviour (still under its old
   name until group 3), `wire.go` comment. Footer `BREAKING CHANGE: kira-memory comment blocks are no longer
   valid; memory-check reports each one.`
3. `refactor(space): rename memory comment check to check hook`: D7 all rows, bindings, contract, copy, visual
   baseline.
4. `feat(memory): agent docs say comments cite memories by id`: D6 text and budget sizes, `comment` subtest.
5. `docs: plain comments cite memories by id`: D8 site pages, `ARCHITECTURE.md`, `DEV_ENVIRONMENT.md`.
6. `docs(v2.6): P296 result`: result section here, SPEC row status.

## 4. Verification (run once near the end; fast checks per commit)

- Per commit: `go build ./...`, `bun run typecheck`, `bun run lint`, pre-commit hook clean (never `--no-verify`).
- `go test ./internal/memory/... ./internal/llmprompts/...`; `go run ./internal/llmprompts/cmd/checkprompts`.
- `CGO_ENABLED=1 KIRA_CONTRACT=write go test ./apps/kira-space/internal/flows/memoryflow/ -run TestCheckHook`,
  then the whole memoryflow package without `KIRA_CONTRACT`.
- `npx playwright test --config=apps/kira-space/playwright.config.ts --project=ui settings-memory copy-coverage`,
  then the visual `settings` spec.
- `bun run lint:rules` (copy, catalog `--unused`, checkprompts, check-docs), `bun run lint:dead` (knip),
  `bun run lint:go`, `bun run lint:claude`.
- Greps that must return nothing outside `docs/v2.5/` and `docs/v2.6/plans/`: `asComment`, `ParseComments`,
  `FormatComment`, `MarkersFor`, `CommentLine`, `commentFor`, `PrepareResult`, `PreparedFact`,
  `MemoryStorePrepared`, `store.prepared`, `CommentCheck`, `commentCheck`, `markers.go`.
- Build the kira-space binary (as the flow harness does) and run `<bin> memory-check` at the repo root: exit 0.
  Then in a temp repo: a staged retired block exits 1 with D3's message; a plain `// … (km_7h3kq9x2mfa4)`
  comment exits 0.
- Real `claude` rows (`docs/DEV_ENVIRONMENT.md`, append `-count=1`): the prompt-registry row (registry defaults
  changed), which includes the Memory MCP row's `TestMemoryMcpThroughClaude|TestMemoryMcpFollowsDocs|…`.
  Record spend in the result section.

## 5. File ownership

One implementer owns every file named in sections 2 and 3. Streams rejected: groups 1 and 2 share
`memfmt`/flow tests and run in order (`commentFor` must go before `FormatComment`); group 3 renames what group
2's flow test calls.

## 6. Out of scope (P297 or never)

`.memory.md` format and version, `ParseDoc`/`FormatDoc`/`DocLineSource`, `writedoc.go`, import write-back,
distill tool shape and modes, `kind` column, gate durability rules.

## 7. Result

Commits (v2.6, in order): `91b01d21` drop asComment and Service.Prepare; `76810e62` memfmt drops comment format,
memory-check flags retired blocks; `8ce1a57c` rename comment check to check hook; `16acb7b0` agent docs and
`comment` subtest; `672a28ca` fix: instructions tell agents to cite the stored id; `04d68bac` docs.

Checks:
- `go test ./internal/memory/... ./internal/llmprompts/...`: all ok. Flow `TestCheckHook` (contract unchanged
  after rename) and whole memoryflow package: ok.
- `bun run typecheck`, `bun run lint` (incl. lint:rules), `lint:dead`, `lint:go`, `lint:claude`: clean.
- UI `settings-memory`, `copy-coverage`: 34 passed. Visual `settings` Memory pane re-recorded with Inter.
- Grep for removed names outside `docs/v2.5/` and plans: only the real `claude` test asserting `asComment` absent.
- Built `kira-space`: `memory-check` at repo root exit 0; temp repo with staged retired block exit 1 with the
  D3 message at `bad.go:2`; plain `// ... (km_7h3kq9x2mfa4)` comment exit 0.
- Real `claude` prompt-registry row (Space, one run) 0.083 USD, 427 s: the new `comment` subtest failed first
  (agent stored, no id in comment). Instructions reworded (`672a28ca`); `TestMemoryMcpFollowsDocs` (all 5
  subtests) and `TestMemoryMcpThroughClaude` then passed, 0.032 USD. All other rows passed in the first run.
  Studio suite passed.

Deviations: `--print-regex` flag help text reworded (old text named the comment regex). `memory.mcp.instructions`
wording differs slightly from D6 (see fix commit); budget lines set to the rendered sizes (1901, 469).
Not verified: the other Space rows were not rerun after the one-sentence reword in `672a28ca`.
