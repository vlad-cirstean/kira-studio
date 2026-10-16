# Review triage investigation: can CodeGraph pre-classify review hunks?

Feasibility study, not a plan, not a numbered phase. Written against `70440ae`/`c7ff3f9e` (`v2.0`).
Target consumer: P150 review window (`plans/P150-review-code.md`), built on `gitsession`
`RangeFiles`/`ReviewFileDiff`/`FileDelta` and `packages/git-ui` `ReviewFilesState`.

**Verdict up front:** deterministic triage works for a narrow, high-precision slice (generated/lock
paths, comment-only, whitespace/format-only, dead-code deletion, pure call-site ripple). CodeGraph adds
one real signal git and a parser cannot: **fan-in / blast radius** of a changed symbol. It is weak or
misleading for the most important class (security-sensitive behavior change), needs a second index
for the base side, and cannot ship inside the app cleanly. Recommend: git + stdlib/tree-sitter tiers
in a later phase, CodeGraph only as an optional enrichment, LLM for the "needs attention" residue.
Nothing auto-hidden, ever.

## 1. What CodeGraph exposes (verified on this repo)

Installed: `@colbymchenry/codegraph` 1.6.2, **MIT** (package.json `license`). Per-platform bundle
`codegraph-linux-x64` is **286 MB** (vendored Node 24 runtime + Rust tree-sitter kernel). Telemetry
on unless `CODEGRAPH_TELEMETRY=0`/`DO_NOT_TRACK=1`.

Index: `.codegraph/codegraph.db`, SQLite WAL, 139 MB for this repo. `project_metadata`:
`indexed_with_version=1.6.2`, `indexed_with_extraction_version=27`, `indexed_at_commit=70440ae…`,
schema version 11. Internal schema, no stability contract.

| Table | Usable columns |
|---|---|
| `nodes` | `kind`, `name`, `qualified_name`, `file_path`, `language`, `start_line`/`end_line` (+cols), `signature`, `visibility`, `is_exported`, `docstring`, `return_type`, `decorators` |
| `edges` | `source`, `target`, `kind`, `line`, `col`, `provenance` (`heuristic` on 4,000 of 123,259) |
| `files` | `path`, `content_hash` (= **sha256 of file bytes**, verified), `generated` flag (64 files, all `internal/gitwire/*.go`), `errors` |
| `unresolved_refs` | 106,793 `failed` (mostly stdlib/test helpers: `t.Fatalf` 5,841, `expect` 7,103) |

Edge kinds: `contains` 41,400, `calls` 41,269, `references` 19,545, `imports` 14,047, `instantiates`
6,618, `implements` 369, `extends` 11. Languages: TS 992 files, Go 978, Vue 353.

Data-quality gaps found:
- Go `is_exported` is **0 for every method** (`('method', 0, 1749)` for capitalised names); functions
  are right. Derive exportedness from the name instead.
- `visibility` NULL for all Go/Vue nodes.
- No body hash per symbol. "Body changed vs signature changed" needs line overlap or two indexes.
- Cross-language edges missing: Wails-bound Go service methods show **0 callers**
  (`CodeWorkspaceService::ReorderRepos fanin 0`, yet `coderepos.ts:58` calls
  `control.codeWorkspaceReorderRepos`). Interface-dispatched Go calls also miss
  (`AdeQueueRepo::UpdateNewWork fanin 0`, called via `q.deps.Store.UpdateNewWork`).

Access surfaces:

| Surface | Fit for app use |
|---|---|
| CLI `callers`/`callees`/`impact`/`query --json`, `affected --stdin` | Works; `impact adeQueueError --json` **391 ms** per call (process start) vs **21 ms** direct SQLite |
| MCP `codegraph serve --mcp` (`codegraph_explore`, `codegraph_node`) | Agent-facing markdown; not a structured API |
| Daemon socket `.codegraph/daemon.sock` | Undocumented internal MCP proxy; one writer per project |
| Library `CodeGraph.open()` (`getCallers`, `getImpactRadius`) | Node 22.5+ only; Go backend cannot link it |
| Direct SQLite read (modernc already a dep) | Fastest; couples app to an unversioned internal schema |

Index scope: **one directory's working tree**, not git objects. It never sees a non-checked-out
branch. Review compares commits (`diff-tree mergeBase tip`, `cat-file` blobs), so:
- Tip side valid only if a worktree sits at the tip and is clean. ADE task branches do have
  worktrees (P150 A1), but agents leave them dirty. Guard: compare `files.content_hash` with sha256
  of `git show tip:path` per file (done in the experiment; `index=fresh` else skip).
- Base side (needed for signature-changed) needs a **second** checkout + index.
- Measured: full `codegraph init` of a fresh worktree **31.9 s wall** (5.7 s index), 136 MB.
  `codegraph sync` after checkout of another commit: **7.7 s** (P140 range), **7.2 s** for 6 files
  (580 ms of real work; rest is startup and reference resolution).

Embedding verdict: MIT is fine under CLAUDE.md's open-source rule. Shipping is not sound: 286 MB
runtime, Node-only library, unversioned schema, per-worktree 136 MB DB, telemetry default. Sound use:
**optional enrichment when the user already runs CodeGraph on that worktree**, read-only SQLite with
a schema-version check, degrade to "no fan-in data" otherwise. Agent tool belt (review agent's MCP)
is the natural home.

## 2. Signals derivable without an LLM

| Tier | Signal | Source | Precision | Main failure mode | Cost |
|---|---|---|---|---|---|
| 0 | Lock/generated/vendor/snapshot path | path rules, `.gitattributes linguist-generated` (repo has none today), CodeGraph `files.generated` | High | Hand-edited generated file; lock bump that is a security upgrade | ~0 |
| 0 | Rename/copy, similarity, mode-only, binary/LFS/too-large | already on the wire: `FileChange.kind/originalPath/similarity`, `FileDiffBody.empty.modeChangeOnly` | High | `-M` threshold misses rename+edit; mode `+x` can matter | 0, exists |
| 1 | Whitespace-only hunk | `git diff -w --ignore-blank-lines` | High | Python/YAML/Makefile indentation is semantic | 1 spawn/file |
| 1 | Moved block | `--color-moved=blocks --color-moved-ws=allow-indentation-change` | High when hit, **low recall** | Moved-and-edited code (extract refactor) not detected | 1 spawn/range |
| 2 | Comment-only / token-equal hunk | Go: stdlib `go/scanner` (BSD); TS/Vue: TS scanner (Apache-2.0) or tree-sitter | High | Directive comments change behavior: `//go:build`, `//go:embed`, `//go:generate`, `//nolint`, `// @ts-ignore`, `eslint-disable` | ms/hunk |
| 2 | Import-order / format reflow | token multiset or AST-equal after normalisation | High for imports; reflow covered by token-equal | Import side effects (TS `import './x'`, Go `_` imports) | ms |
| 2 | Changed-symbol mapping, signature vs body | tree-sitter on base+tip blobs (no index needed), or two CodeGraph indexes | High for Go/TS, coarse for Vue templates | Vue `<template>` changes map to the whole component | ms/file |
| 3 | Call-site ripple of a signature change in same diff | signature-changed set + "every changed line is a call to it" + `calls` edge | Medium-high | Ripple that also changes an argument's meaning; interface calls lack edges | ms |
| 3 | Fan-in / blast radius of changed symbol | CodeGraph `edges` (only CodeGraph has this) | Medium | Undercounts: Wails bridge, interface dispatch, Pinia dynamic dispatch partly synthesized | 21 ms SQL |
| 3 | Dead-code deletion | base index: deleted symbols have 0 inbound edges | High | Reflection/string lookups | needs base index |
| 3 | Test-only vs prod | path rules (+ CodeGraph `affected` for test↔source link) | High for classification, **not for value** | Deleted/weakened assertions are high value | ~0 |
| – | Security-sensitive / public contract | no reliable non-LLM signal; path + keyword heuristics only (SQL literals, `auth`, `crypto`, `ipcerr`, `internal/bridge/*Service`) | Low | Exactly the hunks that matter most | – |

Library options for tier 2 (all open source, check before adoption):
- Go stdlib `go/scanner`, `go/parser`: zero dependency, Go files only. Used in the experiment.
- `github.com/tree-sitter/go-tree-sitter` (MIT) + `tree-sitter-go`, `tree-sitter-typescript` (MIT):
  needs cgo (already on for darwin builds: `build/darwin/Taskfile.yml CGO_ENABLED: 1`). Vue grammar
  (`tree-sitter-vue`) is community-maintained; verify maintenance and license at adoption time.
- difftastic (MIT, Rust CLI): good structural diff, but separate binary and its JSON output is
  flagged unstable. Not worth bundling for classification alone.

## 3. Experiment (real commands, this repo)

Script: Python driver over `git diff -M -C -U0`, `git diff -w`, `--color-moved`, a `go/scanner`
token normaliser, TS `createScanner(skipTrivia)` normaliser, and read-only SQLite over CodeGraph
indexes built in a scratch worktree at each commit (`codegraph init`/`sync`, then copy the DB).
Per-file `content_hash` check confirmed every index used was fresh for the tip.

### R1 mechanical: `85a8f34` lint fix, `6baacda` delete `useDragReorder`

```
processlist_darwin.go 46+1 -1 +1 tokEq False  [listProcesses fanin 1]
processlist_darwin.go 49+1 -1 +1 tokEq False  [listProcesses fanin 1]
sampler.go 377+3 -0 +3 tokEq True             [gopsutilProbe fanin 1]
```
Human: all lint-driven, low risk. Signals: comment hunk correctly trivial, but it adds
`//nolint:unused`, a directive (lint behavior, not runtime). The two code hunks (`[N]C.char` array to
`make([]C.char, N)`, dropped casts) are not token-equal; correctly left as "needs attention".
Conservative disagreement, acceptable.

`6baacda`: at `6baacda^`, `useDragReorder` has 0 `imports` edges into its file and 0 callers. Signal:
dead-code deletion, matches human reading.

### R2 refactor: `19b78e0` extract `useSortableReorder`, TabStrip onto it

```
TabStrip.vue          hunks 6 ws_left 6 moved [7, 32]
useSortableReorder.ts hunks 2 ws_left 2 moved [7, 67]
```
Human: extract-and-generalise refactor, worth a real look at the new util, TabStrip side mostly
removal. Signals: git saw only **7 of 99** changed lines as moved; whitespace and token tiers found
nothing. Moved-code detection fails on moved-and-edited code, the common extraction shape. Vue
hunks all map to the whole `TabStrip` component node (fan-in 4), too coarse to help.

### R3 feature: `58269ff..2457e9f` (P140 repo drag-reorder, 12 files)

Token-equal hunks: 4, all comment edits (`useAdeTabStripHost.ts:8`, `bridge/index.ts:156`,
`coderepos.ts:10`, `codeworkspace.go:90`). Whitespace-only: 0 (`ws_left == hunks` in every file:
gofmt/prettier keep whitespace churn out). New symbols correctly flagged `new`:
`CodeReposRepo::Reorder`, `CodeWorkspaceService::ReorderRepos`, `reorderCodeRepos`.
Fan-in disagrees with a human:
```
CodeWorkspaceService::ReorderRepos fanin 0   (new IPC entry point, frontend calls it)
useCodeReposStore fanin 15 files 13          (only a new action added)
```
Test path rule marks `tests/ui/ade-module.spec.ts` (-10) low priority; it deletes the assertion that
drag does **not** reorder. Human: relevant (test now matches new behavior). Test-path must not mean
"collapse".

### R4 mixed with signature changes: `108ada87` (6 Go files)

Two indexes (`108ada87^`, `108ada87`) give real signature diffs:
```
signature-changed: Rebind, UpdateNewWork, bindNewWorkLocked, reconcileHeuristicNewWork, reconcileNewWork, reconcileTypedNewWork
queue.go:1025+1 names=[reconcileTypedNewWork] all_lines_are_callsites=True cg_calls_edge=True
queue.go:1284+1 names=[UpdateNewWork]         all_lines_are_callsites=True cg_calls_edge=False
adeQueueError fanin 19
```
Ripple detector: 6 hunks pure call-site ripple (5 confirmed by a CodeGraph `calls` edge, 1 missed
because the call goes through an interface field). Human agrees they are ripple.
But the commit's most important change is `adequeue.go:504-507`:
`WHERE id = ?` became `WHERE code_repo_id = ? AND id = ? AND archived_at IS NULL` (write scoping, a
correctness/security fix). Signals: `sig_changed` body hunk, **fan-in 0** (interface dispatch). A
fan-in ranking would put it last. `adeQueueError` (19 callers, one new `errors.Is` branch) is where
fan-in genuinely helps: a one-line change with wide reach.
`main.go:438-444` (replace `List()`+filter with `ListByRepo`) is a behavior-preserving refactor no
deterministic tier recognises.

### Tally

| Range | Hunks | Deterministically "low value" | Human agrees | Missed low-value | False "low value" |
|---|---|---|---|---|---|
| R1 | 3 + 1 file | 1 comment + 1 dead file | 2/2 (directive caveat) | 2 lint code hunks | 0 |
| R2 | 8 | 0 | – | most of TabStrip side | 0 |
| R3 | 25 | 4 comment | 4/4 | test/doc-only edits | 0 (test deletion kept, by rule) |
| R4 | 41 | 3 comment + 6 ripple | 9/9 | `main.go` refactor | 0 |

Deterministic tiers trimmed about 15-20% of hunks with no false "low value" in this sample, provided
directive comments and test deletions are excluded. Sample is small (59-commit shallow clone); treat
the percentage as indicative only.

## 4. Where an LLM remains necessary, and hybrid proposal

LLM still needed for: security/contract judgement (R4's `WHERE` scoping), behavior-preserving
refactors (R4 `main.go`, R2 extraction), "does this test change match the code change", lint fixes
that are not token-equal (R1).

Pipeline (cheapest first, each tier only labels; none deletes):

1. **Tier 0** (exists on wire): path class, rename similarity, mode-only, binary/LFS/too-large.
2. **Tier 1** git: `-w` whitespace-only, `--color-moved` blocks. One extra spawn per range.
3. **Tier 2** parser on base+tip blobs (Go stdlib, then tree-sitter for TS/Vue): comment-only
   (directive allowlist forces "attention"), import-only, changed-symbol list, signature vs body,
   new/deleted symbols.
4. **Tier 3** relational: ripple groups (signature change + call-site hunks), dead-code deletion,
   fan-in from CodeGraph **when a fresh index exists** (content_hash check), else omitted.
5. **LLM** only for hunks left "unknown", fed a compact record per hunk: path, symbol, kind,
   signature delta, fan-in (with "may undercount: interface/bridge" flag), ripple group, plus the
   hunk text. Ask for: label (`behavior`, `contract`, `security`, `refactor`, `test`), one-line reason,
   confidence. Cheaper and more accurate than whole-diff prompting; the review agent (P150 §5.4)
   could run it.

Review-window surface:
- Three groups in the Files pane: **Needs attention**, **Ripple / follow-on** (grouped under the
  signature change that caused it), **Mechanical** (comment-only, whitespace, generated, lock, dead
  deletion). Mechanical collapsed by default, never hidden; "Expand all" always available; counts
  shown.
- Each label shows its reason ("comment-only: token stream equal", "ripple of `UpdateNewWork(...)`
  signature change", "generated: `internal/gitwire`"). No label without a reason.
- Reviewed state unchanged: marking stays explicit per file/range (`review.mark`). No auto-mark of
  mechanical files. GitHub viewed sync (P150 §6) syncs only files the user fully marked; triage never
  marks anything viewed.
- Since-review mode: triage runs on the delta body (`FileDelta`), so a file whose only post-review
  change is a comment lands in Mechanical.

Risks and mitigations:
- **False "mechanical" on a behavior change (worst case).** Only token-equal or path-rule evidence
  may label Mechanical. Directive comments, `_`/side-effect imports, YAML/Python whitespace, test
  assertion deletions, and lockfile changes touching a dependency's major version never qualify.
  Ripple is grouped, not demoted below "attention", and links to the callee change.
- **Fan-in misleads.** Display it as context, never as a ranking that buries low-fan-in hunks.
  Mark `internal/bridge/*Service` methods and Wails-bound types as entry points by rule.
- **Stale index.** Per-file sha256 check; mismatch drops CodeGraph data for that file.
- **LLM disagreement.** LLM can only promote toward attention, never demote a deterministic
  "attention".

## 5. Verdict

| Tier | Go/no-go | Effort | Notes |
|---|---|---|---|
| 0 path/rename/mode | **Go** | S (0.5 day) | Mostly exists; add path rules + optional `.gitattributes` |
| 1 whitespace/moved | **Go** (low yield here) | S | gofmt/prettier repo: 0 whitespace hunks in sample |
| 2 comment/token-equal, symbol mapping | **Go** | M (2-4 days Go stdlib; +2-3 days tree-sitter TS/Vue) | Best value per effort |
| 3a ripple groups | **Maybe** | M (2 days, needs tier 2 both sides) | Works without CodeGraph if tier 2 parses both sides |
| 3b fan-in via CodeGraph | **Maybe, optional only** | S-M (1-2 days read-only SQLite + guard) | Only real CodeGraph-unique signal; undercounts |
| CodeGraph shipped in app | **No-go** | – | 286 MB runtime, unversioned schema, per-worktree index, base side unindexed |
| Deterministic replaces LLM for importance | **No-go** | – | Missed the most important hunk in R4 |
| LLM on residue with structured context | **Go, later** | M | Review agent can host it |

Does CodeGraph help? A little. Git + a parser deliver nearly all of the trimming. CodeGraph's unique
contribution is fan-in/blast radius, useful as context ("19 callers") but unreliable as a rank
because it misses bridge and interface calls. Also its index covers only a checked-out tree.

Recommendation:
- **P150:** none of this in scope. At most, display what already exists (rename/similarity,
  mode-only, binary) as file badges. Keep P150 focused on its §1 ask.
- **Later phase (after P150):** tier 0-2 in Go (`gitreview`/`gitsession`, new `review.triage`
  method), Mechanical/Attention grouping in `ReviewFilesPane`. Then a follow-up for ripple groups,
  optional CodeGraph fan-in, and LLM residue via the review agent.

Questions for the user:
1. Hunk-level grouping inside a file, or file-level only (a file is Mechanical only if all hunks
   are)? File-level is simpler and fits current `review.mark`.
2. Accept tree-sitter (cgo) for TS/Vue, or Go-only first using stdlib?
3. CodeGraph fan-in as an optional enrichment when present, or skip CodeGraph entirely in the app?
4. Should the LLM pass run automatically per review open (cost) or on demand from the questions panel?
5. Lockfile changes: always Mechanical, or Attention when a direct dependency's version changes?

## 6. Optional installed CodeGraph

User follow-up: CodeGraph is not shipped, but it is installed on the user's machine. Can the app
use it when present (degrade to Go-only when absent) and skip its own tree-sitter? Verified on
1.6.2 below.

### 6.1 What it exposes for hunk triage

| Need | Available? | Evidence |
|---|---|---|
| Per-symbol line/column ranges | Yes | `nodes.start_line/end_line/start_column/end_column`; CLI `query`/`callers` JSON carry `startLine` |
| Stored signature | Yes, raw source text | `Queue::reconcileTypedNewWork … '(ctx context.Context, entry *gitsession.RepoEntry, …) (bool, error)'`; whitespace not normalised, app must normalise |
| Body hash / normalised-body hash / AST hash | **No** | `nodes` columns: none; `ExtractionResult.Node` keys: `id,kind,name,qualifiedName,filePath,language,startLine,endLine,startColumn,endColumn,updatedAt,signature` |
| File hash | Raw bytes only | `files.content_hash` = sha256 of file; comment/whitespace-sensitive |
| Comment ranges, token stream, parse tree | **Not on any public surface** | Library-internal `dist/extraction/syntax-tokens` classifies comments for its viewer; no CLI/MCP/JSON output |
| Parse-only command | **No** | CLI: `init index sync status query explore context node files callers callees impact affected …`; MCP `tools/list` returns one tool, `codegraph_explore`, markdown, no `outputSchema` |
| Callers/callees/impact | Yes, JSON | `callers --json` keys `symbol,targets,ambiguous,aggregation,filteredOut,definitions,callers,total,limit,truncated` |

So formatting-only, comment-only and import-order-only **cannot** be decided from CodeGraph's public
outputs. It gives symbol mapping, signature-text comparison, new/deleted symbols, and caller counts.
Comment-only needs a tokenizer either way.

### 6.2 Languages and parsing a base blob without a second checkout

Grammars bundled (`tree-sitter-wasms`): go, typescript, tsx, javascript, vue, json, yaml, toml, html,
css and ~25 more. Covers all of Go/TS/Vue. Vue granularity is coarse (R2: hunks map to the whole
component node).

No stdin mode. Two workable routes, both measured:

| Route | How | Latency | Stability |
|---|---|---|---|
| Temp project of changed base blobs | write `git show base:path` files to a temp dir keeping paths, `codegraph init -y` there, read its SQLite | 1-file: **1,270 ms**; 9 base blobs of P140 range: **1,234 ms** (65 Go, 92 TS, 35 Vue nodes); DB 692 KB | Public CLI; correct signatures for the base side (`reconcileTypedNewWork` 1051-1063, old param list) |
| Internal `extractFromSource` via bundled Node | `require('…/dist/extraction/tree-sitter.js').extractFromSource(path, src)` | 237 ms load + **46 ms** for `queue.go` | Not exported from the package entry (`extractFromSource is not a function` from `dist/index.js`); internal path, breaks on any release. Also returned 2 nodes for `TabStrip.vue` vs 35 via `init`. **Do not use** |

Temp-project route removes the need for a second full checkout. Edges in it cover only the changed
files, so it gives base signatures and symbol ranges, never base-side caller counts. Tip side: use
the user's existing index for the worktree if fresh, else the same temp-project trick on tip blobs.

### 6.3 Cost, stability, version detection

- Spawn cost: `codegraph version` **139 ms**, `callers --json` **368 ms**, `impact --json` 391 ms.
  Direct read-only SQLite of an existing index: **21 ms**. Prefer SQLite for queries, CLI only for
  `status --json` and temp-project `init`.
- Daemon: `.codegraph/daemon.pid` JSON `{pid, version, socketPath}`; socket is an MCP proxy, not a
  documented query API. Do not use it; a present `daemon.pid` only tells the index is being kept
  fresh.
- Freshness: `status --json` has `pendingChanges {added,modified,removed}`, `worktreeMismatch`
  (borrowed parent index, see `dist/sync/worktree.d.ts`), `index.state`, `reindexRecommended`. Plus
  per-file sha256 check against `git show tip:path`.
- Versioning: JSON has no schema version field. Detect via `status --json` `version` (semver) and
  `index.builtWithExtractionVersion` (27), plus DB `schema_versions` max (11). App pins a tested
  range (e.g. `1.6.x`, schema 11) and degrades to Go-only on anything else, logging why.
- Telemetry: spawn with `CODEGRAPH_TELEMETRY=0`. Temp-project runs also need `CODEGRAPH_NO_DAEMON=1`
  so no watcher daemon lingers.
- Writes: `init` in a temp dir writes only `<tmp>/.codegraph`. Never run `init`/`sync` in the user's
  repo from the app; read their index as-is.

### 6.4 Updated verdict

Detection: `exec.LookPath("codegraph")` (same posture as `ghclient.Discovery`), `status --json` with
a TTL, version gate. Absent or incompatible: Go-only path, no error surfaced beyond a "symbol
insights unavailable" hint.

| Signal | Go-only path | + optional CodeGraph | Tier verdict |
|---|---|---|---|
| Path/rename/mode/binary, whitespace, moved | git | same | Go |
| Comment-only / token-equal, Go | `go/scanner` | same (CodeGraph cannot) | Go |
| Comment-only / token-equal, TS/Vue | none, unless Monaco's Monarch `editor.tokenize` (TS grammar already registered, `monarch/decorators.ts`) in the frontend | same (CodeGraph cannot) | Maybe, via Monaco, verify Vue |
| Symbol mapping + signature change, Go | `go/parser` | redundant | Go |
| Symbol mapping + signature change, TS/Vue | none | **yes**: temp-project base + tip, ~1.3 s per side | Maybe (CodeGraph-only) |
| Ripple groups, TS/Vue | none | yes, built on the row above | Maybe |
| Caller count / blast radius | none | yes, tip index if fresh; undercounts bridge/interface calls | Maybe, context only |
| Dead-code deletion | none | needs base-side edges, not in temp project; only if user's index predates the change | No-go |

What optional CodeGraph buys over Go-only: TS/Vue symbol mapping, signature-change and ripple
detection, and caller counts. It does **not** replace a tokenizer: comment/format/import-only stays
Go stdlib for Go and Monaco tokenize (or nothing) for TS/Vue. So "skip our own tree-sitter" holds:
Go-only + Monaco tokenize + optional CodeGraph covers every tier the tree-sitter plan did, except
TS/Vue symbol tiers when CodeGraph is absent.

Recommended order for the later phase: Go-only tiers 0-2 first, then the optional CodeGraph adapter
(detect, version gate, temp-project base parse, SQLite reads), then Monaco tokenize for TS comment-
only. P150 scope unchanged.
