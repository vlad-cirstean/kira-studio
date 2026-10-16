# P94 pass 3 — TS/Vue complexity at 30, and knip's dead exports

Pass 3 of P94, sketched in `docs/v1.8/plans/P94-code-quality-tooling.md` §11. Planned against the
tree pass 2 left (`claude/v1-8-p82-p83-implementation-ocpvj1` at `c4979d87`, "docs(v1.8): record P94
pass 2"). Every count below is a real run in this container against that commit, not the sketch's
numbers and not pass 1's §1 table.

Two halves: Biome's `complexity/noExcessiveCognitiveComplexity` at 30, and dropping `--include` from
`lint:dead` so knip gates on `exports`/`types` (and, it turns out, `binaries`) too. Both end with the
same rule pass 1 set: **a rule enters the enabled set only in the commit that drives it to zero.**

## 0. What the sketch left open, and what re-measurement changed

| Open | Resolution | Where |
|---|---|---|
| "21 functions" over complexity 30 | **21 raw, 19 real.** 2 of the 21 are test files, which §4.2 exempts. The exemption needs a `biome.json` override that does not exist yet — pass 1 added no test override at all | §1, §3.1 |
| "71 + 46" knip export/type findings | **73 + 46 is wrong on both counts: 73 exports + 49 types = 122.** Pass 1's barrel changes did not lower it | §1 |
| Does dropping `--include` only add `exports`/`types`? | **No.** It also turns on `binaries`, which reports 1 finding: `go`, invoked by six `package.json` scripts. Needs `ignoreBinaries` or `lint:dead` goes red | §1, §3.2 |
| Does knip see `.vue` imports? It reports `.vue` as "not registered as a compiler" | **Yes, imports resolve.** Verified on three vue-only consumers in three packages (`formatShortcut`, `useGraphVisible`, `connColorVar`) — none is flagged. The hint is cosmetic; a compiler is declined, §3.2 | §3.2 |
| Does knip see `apps/kira-studio/tests/**`, which is in no knip workspace? | **Yes.** Verified: 5 frontend symbols imported only by `tests/**` and referenced nowhere else in `frontend/src` are all unflagged. So no test-only blind spot, and no test-only exemption is needed | §5.1 |
| "Expect a meaningful share to be test-only helpers and intentional public API" | **Neither, measured.** 106 of 122 are exports used only inside their own file — the fix is dropping one keyword. 15 are entries in a re-export list. 1 is genuinely dead | §5 |
| Should `ignoreExportsUsedInFile` clear the 106 instead? | **Declined**, with reason — it would permanently blind the repo to the whole category | §5.2 |
| One subagent or several? | **One sequential.** 5 files carry a finding from *both* halves, and both halves end in the same three config files | §8 |

Carried forward, still open, untouched by pass 3:

- **P95** (`errcheck`, `staticcheck`) — its own phase, opened by pass 1.
- **Pass 4**'s named flakes, including `http-request-body.spec.ts`'s 500-byte threshold and the two
  long-standing Biome findings (`UncommittedChangesStrip.vue:49` `useShorthandFunctionType` info,
  `RequestSettingsPane.vue:2` `useImportType` warning). Both survive pass 3 untouched and are
  confirmed still present in §10's baseline run.
- **`docs/ARCHITECTURE.md:42` is stale since pass 2** — it still lists 9 golangci-lint linters, not
  the 11 pass 2 landed. Pass 3 corrects that line while it is editing it anyway (§7 commit 26).

---

# 1. The measured scope

## 1.1 Biome cognitive complexity at 30

Measured by temporarily adding the rule to `biome.json` at `maxAllowedComplexity: 30` and running
`biome check .` over all 1174 checked files. **21 findings. 19 after §3.1's test override.**

| Score | Function | File:line | Kind |
|---|---|---|---|
| 92 | `parseCurl` | `packages/api-core/src/http/curl/parse.ts:132` | ts |
| 79 | `tokenizeXml` | `apps/kira-studio/frontend/src/beautify.ts:282` | ts |
| 46 | `computeSelEdgeHashes` | `apps/kira-studio/frontend/src/views/shared/slick/selectionEdges.ts:41` | ts |
| 43 | `scanLevel` | `packages/shared/domain/sql-tokens.ts:227` | ts |
| 42 | `onPaste` | `apps/kira-studio/frontend/src/views/grid/SlickGridHost.vue:1843` | **vue** |
| 40 | `onKeydown` | `apps/kira-studio/frontend/src/workbench/ContextMenu.vue:136` | **vue** |
| 38 | `parseColumnDef` | `apps/kira-studio/frontend/src/views/console/ddl.ts:164` | ts |
| 37 | `lintMongoBrackets` | `apps/kira-studio/frontend/src/views/console/lint.ts:35` | ts |
| 36 | socket `'data'` handler | `packages/git-ipc/src/socketChannel.ts:122` | ts |
| 36 | `buildRowPlan` | `packages/git-core/src/graph/rowPlan.ts:252` | ts |
| 36 | `resolve` | `packages/api-core/src/http/substitute.ts:139` | ts |
| 35 | `scanSqlSpan` | `packages/shared/domain/sql-lex.ts:36` | ts |
| 35 | `handleKeyDown` | `packages/git-ui/src/components/CommitGrid.vue:605` | **vue** |
| 35 | `mount` | `apps/kira-studio/frontend/src/views/repo/RepoFileView.vue:131` | **vue** |
| 35 | `refsInStatement` | `apps/kira-studio/frontend/src/views/console/sqlRefs.ts:115` | ts |
| 33 | `detectWrapper` | `apps/kira-studio/frontend/src/views/shared/document/ejson.ts:93` | ts |
| 33 | `mount` | `apps/kira-studio/frontend/src/views/repo/useDiffEditor.ts:94` | ts |
| 32 | `searchResult` computed | `apps/kira-studio/frontend/src/project/state/tree.ts:521` | ts |
| 31 | `onGrpcCall` handler | `apps/kira-studio/frontend/src/views/grpcrequest/state.ts:232` | ts |
| 36 | `send` | `apps/kira-studio/tests/ui/support/gitStreamMock.ts:127` | **test — exempt** |
| 34 | ink-bbox `evaluate` | `apps/kira-studio/tests/ui/mode-switch.spec.ts:234` | **test — exempt** |

15 in `.ts`, 4 in `.vue` SFCs. No finding above 92; the tail is short (one 92, one 79, then 46 down).

**Biome scores a nested function twice: once on its own, once inside its parent.** Measured by
re-running at `maxAllowedComplexity: 3`: `parseCurl` is 92, and its three nested closures report
separately at 7 (`:157`), 21 (`:183`) and 11 (`:282`). That is why lifting a closure out of its
parent is a real fix and not bookkeeping — it removes the child's score *and* its nesting penalty
from the parent. It also means an extracted helper must be checked on its own; §4 names the target.

**One near-threshold neighbour, do not push it over:** `beautify.ts:43` scores **29**. It sits one
point under the gate in the same file as the 79. Nothing may move into it.

## 1.2 knip

Measured with `knip --include exports,types` and with a plain `knip` (what `lint:dead` becomes):

| Rule | Findings | Note |
|---|---|---|
| Unused exports | **73** | sketch said 71 |
| Unused exported types | **49** | sketch said 46 |
| Unlisted binaries | **1** | `go`, in `package.json`. Not gated today — `--include ... unlisted ...` is a *different* rule from `binaries` |
| Duplicate exports | 6 | `rules.duplicates: "warn"` since pass 1 — does not fail, stays as is |
| Configuration hints | 13 | 8 actionable, §3.2 |
| everything else (`files`, `dependencies`, `unlisted`, `unresolved`, …) | 0 | pass 1 cleared these and they stayed clear |

`knip --include files,dependencies,unlisted,duplicates` (today's `lint:dead`) exits **0**. Plain
`knip` exits **1**. The 122 + 1 findings above are exactly the gap pass 3 closes.

The 122 break down, by shape rather than by guesswork:

| Shape | Count | Fix |
|---|---|---|
| Export used only inside its own file | **106** | drop the `export` keyword |
| Name in an `export { … }` / `export type { … }` list nothing imports | **15** | remove that name from the list |
| Declared, referenced nowhere, not even locally | **1** | delete it (`findVariableSetTab`) |

68 files carry at least one. Pass 1's `noReExportAll` work did not move the count: it converted
`export *` to named re-exports, which is what makes these 15 visible in the first place.

---

# 2. What passes 1 and 2 actually moved

**Pass 2: nothing on this side, by construction.** It was Go-only — 49 Go function refactors plus
`.golangci.yml`. `git diff --stat f7b51382..c4979d87` touches no `.ts` or `.vue` file outside
`docs/`, so neither the Biome nor the knip number moved between pass 1's §1 and this plan.

**Pass 1 moved the knip baseline in the other direction from the sketch's guess.** §11 assumed the
barrel rewrites would cut the export count from 71. They raised it to 73 (+ types 46 to 49): turning
`export *` into named re-exports makes each individual re-exported name visible to knip, and 15 of
them turned out to be unimported. That is the rule working as intended, not a regression.

---

# 3. The config diffs

## 3.1 `biome.json`

Two edits. Verified together with a full `biome check .`: **19 errors**, plus the two pre-existing
`useShorthandFunctionType`/`useImportType` findings and nothing else new.

Beside the existing `performance` block, in `linter.rules`:

```json
"complexity": {
  "noExcessiveCognitiveComplexity": {
    "level": "error",
    "options": { "maxAllowedComplexity": 30 }
  }
},
```

`preset: "recommended"` already enables other `complexity/*` rules; adding this block extends that
set rather than replacing it, exactly as pass 1's `performance` block did. Confirmed by the run
above — no other rule's count changed.

And, first in `overrides`, the test exemption §4.2 of the parent plan promised but never wrote:

```json
{
  "includes": ["**/tests/**", "**/test/**", "**/*.test.ts", "**/*.spec.ts"],
  "linter": {
    "rules": {
      "complexity": { "noExcessiveCognitiveComplexity": "off" }
    }
  }
},
```

Four patterns, because this repo puts tests in four shapes: `apps/*/tests/**`, `packages/api-core/
test/**`, `packages/*/src/**/*.test.ts`, and `*.spec.ts` anywhere. Both exempted findings sit in
`apps/kira-studio/tests/ui/`; the other three patterns are there so the next test written elsewhere
is covered without another config change. Order in `overrides` is irrelevant here (no other override
mentions `complexity`) — first is simply where it reads.

**Do not re-argue the threshold.** 30 is settled in the parent plan §4.2: one metric, one number
across Go and TS, matching `gocognit`'s own default and pass 2's landed `min-complexity: 30`.

## 3.2 `knip.json` and `package.json`

`package.json`:

```
-"lint:dead": "knip --include files,dependencies,unlisted,duplicates",
+"lint:dead": "knip",
```

`knip.json` gains `ignoreBinaries` and folds in the 8 actionable configuration hints:

```jsonc
  // `go` is the system Go toolchain, invoked by six scripts in this file's own package.json
  // (`dev`, `mcp:repo-map:build`, `lint:go`, `package`, `test:go`, `typecheck` via `go env`).
  // It is not an npm bin and never will be. Gated only from pass 3, when `lint:dead` dropped
  // its `--include` filter and turned the `binaries` rule on.
  "ignoreBinaries": ["go"],
```

Hint fixes, each one knip's own words:

- `packages/api-core` entry `test/**/*.test.ts` → **`test/**/*.spec.ts`**. knip reports "Refine entry
  pattern (no matches)" because that directory holds `*.spec.ts`, not `*.test.ts`. Pass 1's pattern
  has matched nothing since the day it landed.
- Remove 7 "redundant entry pattern" entries — knip already reaches each through a `package.json`
  `main`/`exports` field or a plugin: `src/main.ts` (`apps/kira-studio/frontend`),
  `playwright.config.ts` (`apps/kira-studio-vscode`), `src/index.ts` (api-core, git-ui, git-core,
  git-ipc, kira-ui), `src/icons/setiFileIcon.ts` (git-ui). Re-run knip after removing them and
  confirm the finding set is unchanged; if any removal adds a finding, keep that one and record why.

**The 4 remaining hints stay, declined with reason.** They ask for a `.vue`/`.css` compiler, which
knip only accepts from a JS/TS config file — so honouring them means converting `knip.json` to
`knip.ts`. The reason to do that would be false positives from unparsed SFCs, and there are none:
`.vue` imports already resolve (§0), and the whole 122-finding set was triaged in §5 without one
SFC-caused false positive. Converting the config format to silence an informational hint is not
worth the change. Hints do not affect knip's exit code.

`rules.duplicates: "warn"` and the four `ignoreDependencies` entries are pass 1's, still correct,
untouched.

---

# 4. The 19 refactors

## 4.1 Four shapes

1. **Scanner / tokenizer** (`tokenizeXml`, `scanLevel`, `scanSqlSpan`, `lintMongoBrackets`,
   `refsInStatement`, `parseColumnDef`) — one loop, many character-class or keyword branches. Fix:
   one `scanX(source, i, …) → {…, next} | null` per construct, main loop dispatches. This repo
   already has the canonical version of that shape in `packages/shared/domain/sql-lex.ts`
   (`scanSqlSpan` returns `SqlLexSpan | null`); match it rather than inventing a second convention.
   **Offsets and error strings are asserted** — `XmlScanError`'s message text and every `start`/`end`
   must come out byte-identical.
2. **Accumulate-then-decide** (`parseCurl`, `resolve`, `buildRowPlan`) — a long function whose
   phases share mutable locals. Fix: name the shared state as one object and lift each phase to a
   module-level function over it. Not a closure moved sideways: the point is that the child's score
   and its nesting penalty both leave the parent (§1.1).
3. **Dispatch table** (`onKeydown`, `handleKeyDown`, `detectWrapper`, `onGrpcCall`) — a `switch` or
   an `if` ladder with one arm per key/kind/wrapper. Fix: a table, one entry per arm, and a lookup.
   Pass 2 landed exactly this for `(*Router).ForConn` (`requestHandlers map[string]requestHandler`)
   after finding every arm already forwarded somewhere — same reasoning applies here.
4. **Vue lifecycle** (`onPaste`, `mount` ×2, `searchResult`) — §4.2.

## 4.2 The Vue cases, which do not refactor like the rest

Four findings are in `.vue` SFCs and two more are Vue-reactive `.ts`. Three distinct patterns, and
picking the wrong one either breaks reactivity or just moves the score into another SFC function:

- **`<script setup>` event handler with pure logic inside** — `onPaste` (SlickGridHost.vue),
  `onKeydown` (ContextMenu.vue), `handleKeyDown` (CommitGrid.vue). Move the pure part to a sibling
  `.ts` module and pass what it needs **explicitly as parameters**, never by reaching back into SFC
  scope. Precedent: `views/grid/menu.ts` and `views/grid/pendingChanges.ts` already hold grid logic
  outside `SlickGridHost.vue`. The SFC function keeps its guard clauses and the call.
- **Fat lifecycle function in an SFC** — `mount` in `RepoFileView.vue` (200 lines). The fix is a
  **composable**, not a helper module: the body owns `watch` handles, an editor instance and three
  disposers whose lifetime is the component's. Extracting them into a plain function would strand
  cleanup. `views/repo/useDiffEditor.ts` is this repo's own example of the target shape — which is
  also why its own `mount` (33) is refactored the same way, one level in.
- **`computed()` / reactive effect** — `searchResult` (`project/state/tree.ts:521`),
  `onGrpcCall` (`views/grpcrequest/state.ts:232`). Extract a plain function and call it **from
  inside** the computed. Hoisting any reactive read out of the computed changes its dependency set
  and silently breaks invalidation. This is the one refactor here that a passing typecheck will not
  catch — §6.

## 4.3 Function by function

Grouped as the commits land (§7), worst-first across groups.

**`packages/api-core`** — `parseCurl` 92, `resolve` 36.
`parseCurl` is 455 lines holding three nested closures (`handleHeaderFlag` 7, `handleFormFlag` 21,
`handle` 11 — the last owning a ~25-arm `switch (id)`), an argv loop, and a 10-arm method/body
`else if` chain at `:430`-`:569`. Introduce a module-private accumulator (headers, raw data pieces,
form rows, `uploadFilePath`, the method flags, warnings), lift all three closures to module-level
functions over it, then extract the tail chain as `resolveMethodAndBody(acc)`. Shape 2.
`resolve` repeats the same `sanitizeUnresolved ?? span` fallback in four places across three
reference kinds; extract `resolveOne(kind, …) → string | null` and keep one fallback at the loop
tail. Regression net: `test/http-curl.spec.ts` with the `curl-cases.json` corpus, and
`test/http-dynamic-fake.spec.ts` — output must be byte-identical, not merely equivalent.

**`apps/kira-studio/frontend/src/beautify.ts`** — `tokenizeXml` 79.
One `while (i < n)` over six construct families: text run, `<!--`, `<![CDATA[`, `<?`, `<!doctype`
(with its own bracket-depth loop), and tag (with its own quote-state loop). One scanner per family,
shape 1. Watch `:43` at 29.

**`views/shared/slick/selectionEdges.ts`** — `computeSelEdgeHashes` 46.
Three `sel.kind` families (cell/range, row, column), each a `for` over rendered positions calling the
shared `mark` closure. One function per kind, `mark` passed in as a parameter. **No test covers this
file, directly or through a UI spec** — §6.

**`packages/shared/domain`** — `scanLevel` 43, `scanSqlSpan` 35.
`scanLevel` is a recursive paren-level scanner with nine character-class branches; extract
`scanNumber`/`scanIdentifier`/`scanOperator`, keep the recursion and the `{nodes, next}` contract
exactly. `scanSqlSpan` has four span kinds; one scanner each, dispatch on the first character.
Covered through `tests/unit/sql-tokens.spec.ts`, `sql-keywords.spec.ts`, `sql-hover-no-reparse.spec.ts`.

**`views/grid/SlickGridHost.vue`** — `onPaste` 42.
Guard clauses, then target resolution (three `sel.kind` ternaries), then a nested row/column loop
that branches again on new-row vs. existing-row. Extract `resolvePasteTarget(sel, page)` and
`applyPastedCells(…)` into `views/grid/paste.ts`; the SFC keeps the guards, the clipboard read and
the two calls. Shape 4, first pattern.

**`workbench/ContextMenu.vue`** — `onKeydown` 40.
Six key branches (Escape, Arrow ×4, Enter), each re-checking `activeSubIndex.value >= 0` and
clearing `submenuTimer`. A key-handler table plus one shared submenu-timer helper; `onKeydown`
becomes the Escape guard, the `open` guard and a lookup. Shape 3 + shape 4 first pattern.

**`views/console`** — `parseColumnDef` 38, `lintMongoBrackets` 37, `refsInStatement` 35.
`parseColumnDef`: the constraint-tail `for` has five keyword arms (`not null`, `primary key`,
`unique`, `references`, default); extract `applyConstraintWord(column, tail, i) → consumed`.
`lintMongoBrackets`: a scanner with comment state, string state and a bracket stack; extract
`skipLineComment` and `scanStringLiteral(text, i) → {next, closed}`, leaving the stack loop.
`refsInStatement`: extract `skipJoinCondition(toks, i, source) → next` and fold the two keyword-set
membership checks into one `classifyKeyword`. `lint.ts` has **no test** — §6 and §9.

**`packages/git-ipc/src/socketChannel.ts`** — the `'data'` handler, 36.
A framing loop with two delivery arms, each with its own `try`/`catch` mapping to a different
`socket.destroy(err)` type. Lift the body to a named `drainFrames(state, chunk, handlers)` and split
delivery into `deliverBlobFrame`/`deliverFrame`, each owning its own error mapping. The partial-frame
early `return`s must stay early `return`s — a `break` would drop buffered bytes. Covered by
`socketChannel.test.ts` and `streamChannel.test.ts`.

**`packages/git-core/src/graph/rowPlan.ts`** — `buildRowPlan` 36.
Three phases: tip ranking, per-row rank propagation into `pendingBySha`/`pendingByRow`, bucket
collapse. One function per phase (`rankTips`, `assignRowRanks`, `collapseBuckets`); `buildRowPlan`
becomes three calls plus the `RowPlanImpl` construction. Covered by `rowPlan.test.ts`.

**`packages/git-ui/src/components/CommitGrid.vue`** — `handleKeyDown` 35.
A 13-arm `switch (event.key)` where nine arms open with the same `if (length === 0) return false`.
Hoist that guard above the switch, move each arm's body into `components/gridKeyboard.ts` taking an
explicit deps object (`plan`, `focusedRowIndex`, `moveSelection`, `pageSize`), keep the switch as the
dispatch. Shape 3 + shape 4 first pattern.

**`views/repo`** — `RepoFileView.vue`'s `mount` 35, `useDiffEditor.ts`'s `mount` 33.
`RepoFileView.vue`: three phases — resolve content (two `try`/`catch` arms over rev-vs-worktree),
build the editor, wire blame + reveal + find-command. Extract content resolution into
`views/repo/fileContent.ts` and the blame wiring into a `useInlineBlame(…)` composable owning its own
`watch`/`claimBlameStatus`/disposer set. `useDiffEditor.ts`: extract `loadDiffSides()` (the two
`try`/`catch` arms plus the binary/tooLarge/missing verdicts) and `wireGoToFile()`. Shape 4, second
pattern, both.

**`views/shared/document/ejson.ts`** — `detectWrapper` 33.
Eleven flat `if` blocks, one per BSON wrapper (`$oid`, `$date`, `$numberInt`, …), each testing key
shape then returning a render. A `readonly` table of `[keys, guard, render]` and one `for` over it.
The cleanest of the 19 — pure data, no interacting state. Covered by `tests/unit/ejson.spec.ts`.

**`project/state/tree.ts`** — the `searchResult` computed, 32.
Extract `connectionRow(conn, query, …) → {row, children} | null`; the computed becomes a loop that
pushes. Every reactive read stays inside the computed's own call tree (§4.2, §6).

**`views/grpcrequest/state.ts`** — the `onGrpcCall` handler, 31.
Extract `applyGrpcEvent(rt, event)` — the whole per-tab body including the message cap and the
done/error branch — leaving the tab-lookup loop and its `break`. Smallest of the 19.

---

# 5. The knip triage

## 5.1 Two blind spots that are not blind spots

Both were checked before triaging anything, because either one would have made a whole category of
"dead" export a false positive:

- **`.vue` files.** knip prints a hint that `.vue` is not registered as a compiler. Imports resolve
  anyway: `formatShortcut` (`shortcuts/keys.ts`, consumed only by `ContextMenu.vue`),
  `useGraphVisible` (`git-ui`, consumed only by `CommitGrid.vue`) and `connColorVar`
  (`theme/connColor.ts`, consumed by 13 `.vue` files and nothing else) are all **unflagged**.
- **`apps/kira-studio/tests/**`**, which belongs to no knip workspace (`.`'s `project` is
  `scripts/**` + `packages/db-fixtures/**`; the frontend workspace's is `src/**`). knip reaches it
  anyway. Verified: `parseColorizedLine`, `BlameLineControllerDeps`, `tokenOptionsFor`,
  `countNewRows` and `PendingCredential` are each imported by exactly one unit spec and referenced
  nowhere else in `frontend/src` — and none is flagged.

So there is **no test-only-helper category** to exempt, and the sketch's expectation of one is
wrong. Do not add knip config for it.

The mirror-image trap, worth stating because it caught the first triage pass: grep is not evidence
here. `fakeGraphHost.ts`'s `FAKE_SHA` looks used by four specs — those specs import a *different*
`FAKE_SHA` from `fakeReviewHost.ts`. Several flagged names (`runSearch` ×4, `MIN_WIDTH`,
`TOOLTIP_DELAY_MS`, `GEOMETRY`) exist in two or three unrelated modules at once. **Trust knip's
finding; use reading, not grep, to decide the fix.**

## 5.2 The three fixes, and one config shortcut declined

**106 — drop the `export` keyword.** The symbol is used inside its own file and imported by nobody.
One-token edit, caught instantly by typecheck if wrong. Before dropping it, read for a doc comment
that justifies the export; where one exists and is now false, delete the comment in the same edit.

**15 — remove the name from its `export { … }` list.** All 15 sit in a re-export block, most with a
comment explaining why the block exists. The block stays; only the unimported names go:

| File | Names to drop | Keeps |
|---|---|---|
| `views/grid/slick/dataSource.ts:14,16,17,22,26` | `DisplayRowIndex`, `InsertHandle`, `KiraGridDataSource`, `dataLength`, `rowHandleAt` | `GridDataSourceState`, `RowHandle`, `createGridDataSource`, `displayPositionOf`, `isRowVisible`, `rowAtDisplayPosition` |
| `bridge/control.ts:10` | `on`, `trust`, `windowKey` | `unwrap`, and the `control` re-export |
| `packages/api-core/src/http/curl/parse.ts:16` | `CURL_WARNING_KINDS`, `CurlWarning`, `CurlWarningKind` | — delete the whole line **and its three-line comment**, which claims consumers import them from here; `packages/api-core/src/index.ts:24` publishes all three straight from `tokenize.ts` |
| `packages/git-ui/src/graph/rowSvg.ts:27` | `GEOMETRY` | — delete the line and its stale three-line comment; the local import stays (29 uses) |
| `views/grpcrequest/history.ts:30` | `loadGrpcHistory` | the other five names |
| `views/httprequest/history.ts:41` | `loadHistory` | the other five names |
| `packages/git-ui/src/components/rowMenuModel.ts:21` | `MenuItem` | `MenuSection` |

**1 — delete it.** `findVariableSetTab` (`apps/kira-studio/frontend/src/api/tabs.ts:186`) is
declared, exported, and referenced nowhere — not in its own file, not anywhere else, not by a test.

**`ignoreExportsUsedInFile` is declined.** knip has an option that would clear all 106 findings with
one config line. It is the wrong trade: an `export` nothing imports is real dead public surface, the
rule exists to find it, and switching the rule off for the whole repo to avoid 106 one-token edits
would blind every future pass to the same category permanently. The edits are mechanical and
typecheck-verified; take them.

## 5.3 By commit group

Counts are the `c4979d87` measurement. **Re-run `knip --include exports,types` after the last
complexity refactor lands and work from that list** — an extraction that introduces or removes an
export moves these numbers, and §7 orders the refactors first precisely so this list is re-derived
once, late, rather than guessed.

| Group | Findings | Files | Notes |
|---|---|---|---|
| `packages/api-core` | 8 | 4 | includes the `parse.ts:16` block deletion |
| `packages/git-ipc` + `packages/git-core` | 4 | 2 | `blobFrame.ts` ×3, `graph/colors.ts` ×1 |
| `packages/git-ui` | 22 | 9 | all local-use; `rowSvg.ts`'s `GEOMETRY` block and `rowMenuModel.ts`'s `MenuItem` are the two re-export cases |
| `apps/kira-studio-vscode` | 14 | 5 | 11 are fixture constants in `tests/interaction/support/` — local-use, not test-only reachability (§5.1) |
| frontend `views/shared` + `views/grid` | ~20 | 9 | includes the `slick/dataSource.ts` shim prune |
| frontend `views/*` (rest) | ~22 | 12 | console, documents, browse, definition, stream, httprequest, grpcrequest, repo |
| frontend `src/api` | 8 | 3 | includes the one deletion |
| frontend, everything else | 24 | 14 | bridge, editor, project, repo, shortcuts, state, theme, workbench |

---

# 6. What is genuinely risky

Five items get named checks of their own, not just a passing package test. Same bar pass 2 held
itself to.

1. **`views/console/lint.ts`'s `lintMongoBrackets` — no test at all.** A scanner with comment state,
   string state with backslash escapes, and a bracket stack: three interacting rules, squarely
   inside `CLAUDE.md`'s "a test earns its keep" list. Write a table-driven test **before** the
   refactor, in its own commit, the way pass 2 did for `StripSQLComments`. Cases: unterminated
   string, bracket inside a string, bracket inside a `//` comment, mismatched pair, unclosed at EOF.
2. **`views/shared/slick/selectionEdges.ts` — no test, direct or indirect.** Nothing in
   `tests/unit/` or `tests/ui/` names `selEdge`. The output is a hash set of CSS edge classes per
   rendered cell; a wrong extraction draws the selection border in the wrong place and no check
   fails. Verify by hand against the three `sel.kind` families, and record in the commit message
   which cases were walked.
3. **`project/state/tree.ts`'s `searchResult` and `views/grpcrequest/state.ts`'s `onGrpcCall`.**
   Reactivity, not logic, is the risk (§4.2). A reactive read hoisted out of the computed still
   typechecks and still passes the unit tests that call it directly; it fails only as a stale UI.
   Keep every read inside the computed's call tree and confirm `tests/unit/tree-state.spec.ts`,
   `view-state.spec.ts`, `grpc-schema-supersession.spec.ts` and `grpc-stream-terminal-race.spec.ts`
   pass, plus `test:ui`'s tree specs in §10.
4. **`parseCurl`'s corpus.** `curl-cases.json` asserts whole parsed request states. The accumulator
   refactor touches the order in which warnings are pushed; warning order is part of the asserted
   output. Run `packages/api-core/test/http-curl.spec.ts` after every extraction step, not once at
   the end.
5. **`socketChannel.ts`'s partial-frame `return`s.** Four early `return`s inside `for (;;)` mean
   "not enough bytes yet, keep the buffer". Converting any of them to `break` or letting an
   extraction swallow one silently drops buffered frames under chunk splitting — which the tests
   only catch if the split lands in the wrong place. Preserve them literally.

`beautify.ts:43` at 29 (§1.1) is a sixth, smaller trap: a single moved branch turns it into a new
finding, and the enable commit would then be red.

---

# 7. Order of work — 26 commits

Complexity first, then knip, then each half's gate, then docs. That order is not arbitrary: a
complexity extraction can add or remove an export, so doing it first means §5's list is re-derived
once against a settled tree instead of drifting under the knip commits.

Refactors, worst-first by the highest score in each group:

1. `refactor(api-core): split parseCurl into flag handlers over an accumulator, extract resolveOne` — 92, 36.
2. `refactor(beautify): one scanner per XML construct` — 79.
3. `refactor(slick): split computeSelEdgeHashes by selection kind` — 46. **§6 item 2.**
4. `refactor(shared): extract per-class scanners from scanLevel and scanSqlSpan` — 43, 35.
5. `refactor(grid): move paste target resolution out of SlickGridHost.vue` — 42.
6. `refactor(workbench): table-drive ContextMenu's key handling` — 40.
7. `test(console): cover lintMongoBrackets before refactoring it` — **§6 item 1**, no production change.
8. `refactor(console): extract constraint, bracket-scan and join-skip helpers` — 38, 37, 35.
9. `refactor(git-ipc): split frame draining and delivery` — 36. **§6 item 5.**
10. `refactor(git-core): split buildRowPlan into its three phases` — 36.
11. `refactor(git-ui): move CommitGrid's key handling into gridKeyboard.ts` — 35.
12. `refactor(repo): extract file content loading and an inline-blame composable` — 35, 33.
13. `refactor(document): table-drive ejson wrapper detection` — 33.
14. `refactor(project): extract connectionRow from the searchResult computed` — 32. **§6 item 3.**
15. `refactor(grpc): extract applyGrpcEvent from the onGrpcCall handler` — 31. **§6 item 3.**
16. `chore: enable Biome's noExcessiveCognitiveComplexity at 30` — §3.1's two edits, in the commit
    that makes them green. Mirrors pass 2's own final `chore: enable gocognit and gocyclo`.

knip, after re-measuring (§5.3):

17. `refactor(api-core): drop unimported exports and the redundant curl warning re-export`
18. `refactor(git): drop unimported exports from git-ipc and git-core`
19. `refactor(git-ui): drop unimported exports`
20. `refactor(vscode): drop unimported exports and fixture constants`
21. `refactor(grid): drop unimported exports and prune the slick dataSource re-export shim`
22. `refactor(views): drop unimported exports across the remaining view modules`
23. `refactor(api): drop unimported exports and delete findVariableSetTab`
24. `refactor(frontend): drop unimported exports across bridge, editor, project, repo, shortcuts,
    state, theme and workbench`
25. `chore: gate lint:dead on every knip rule` — §3.2's `knip.json` + `package.json` edits, in the
    commit that makes them green.

26. `docs(v1.8): record P94 pass 3` — §11's `SPEC.md` section, plus the `docs/ARCHITECTURE.md:42`
    correction (§0: it still lists 9 golangci-lint linters; pass 2 landed 11, and pass 3 adds
    Biome's complexity rule and knip's exports/types coverage to the same line).

Conventional Commits. Each message ends with this session's two attribution lines.

Commits 17-24 are each one mechanical sweep over one subsystem; if a subsystem's diff is unreadable,
split it further. Never the reverse — do not merge two subsystems to save a commit.

---

# 8. One subagent or several

**One sequential Sonnet subagent.** The two halves are not independent, and the reason is file-level:

- **Five files carry a finding from both halves** — `packages/api-core/src/http/curl/parse.ts`
  (the 92 *and* the `:16` re-export block), `views/grpcrequest/state.ts` (the 31 *and* two types),
  `project/state/tree.ts` (the 32 *and* two exports), `views/repo/useDiffEditor.ts` (the 33 *and*
  `DiffEditorState`), `views/shared/document/ejson.ts` (the 33 *and* `DocNodeKind`). Two agents would
  collide in all five.
- **Both halves end in the same three config files** — `biome.json`, `knip.json`, `package.json` —
  and in the same `SPEC.md` result section. Pass 1 gave exactly this reason for the same conclusion
  and pass 2 repeated it; nothing has changed.
- **The order in §7 is a dependency, not a preference.** The knip list must be re-derived after the
  refactors land. Running the halves concurrently would mean triaging against a tree that is being
  rewritten underneath.

`CLAUDE.md` allows parallel subagents only where independence is genuine. Here it is not. The one
arguably splittable seam — the eight knip sweeps, commits 17-24, which touch disjoint subsystems —
is not worth splitting either: each is a one-token-per-site edit gated on a shared `typecheck`, and
the coordination cost exceeds the work.

---

# 9. Tests

**One new test, commit 7:** a table-driven test for `lintMongoBrackets` (§6 item 1). It clears
`CLAUDE.md`'s bar on its own terms — a scanner with three interacting rules — and it lands *before*
the refactor it guards, which is the only ordering that makes it a net.

**Nothing else.** The other 18 refactors are behaviour-preserving extractions over code that already
has a test, and the 122 knip fixes are keyword removals. Neither clears the bar. No test is added
for an extracted helper whose parent is already covered.

**No existing test may be edited.** If a test goes red, the refactor was wrong. The one exception
pass 2 hit — a test that inspects code shape rather than behaviour — has no analogue here; nothing in
`tests/` asserts the structure of any of these 19 functions. If one turns up, the same rule applies:
teach the test the new shape in the same commit, never weaken the assertion.

---

# 10. Verification

**Per commit (cheap):** `bun run lint` and `bun run typecheck`, on a normal, non-bypassed commit.
From commit 16 onward `bun run lint` also enforces the complexity rule; from commit 25 onward
`bun run lint:dead` is the full knip. `--no-verify` buys time inside an investigation and never ends
one.

**Once, near the end** (`CLAUDE.md`'s "implement the whole plan first, then test once"):

- `bun run lint:all` — Biome (complexity at 30, 0 errors; the two pre-existing
  `useShorthandFunctionType`/`useImportType` findings **still expected**, pass 4 owns them),
  `golangci-lint` (0 across pass 2's 11 linters — unchanged, this pass touches no Go), `knip` (0 on
  every rule; `duplicates` still 6 at `warn`, 4 compiler hints still printed).
- `go build ./...`, `go vet ./...`, `go test ./...` — should be untouched; run them to prove it.
- `bun run build` and `bun run build:vscode`. The second one matters here: commits 20 and 21 remove
  names from re-export lists the extension bundle reads.
- `bun run test:unit` — **expect 1538 passed, 0 failed** (pass 1's and pass 2's identical count).
- `bun run test:webview` — **expect 55 passed, 0 failed** (same as passes 1 and 2).
- `bun run test:ui` — pass 2's baseline is **311 passed, 1 failed, 4 did not run** out of 316. The
  one failure is `http-request-body.spec.ts`'s 500-byte payload threshold, this chapter's named
  pre-existing flake, owned by pass 4. Anything else red is pass 3's doing and gets fixed here.
  `tree.spec.ts` (pass 1's other recorded flake, clean in pass 2) is worth watching: commit 14
  touches `project/state/tree.ts`. If it fails, re-run it isolated (`--project=ui`, 1 worker) before
  concluding anything — that is how pass 1 established it as contention, not regression.

**Checks specific to this pass's own risk:**

1. **Re-run Biome at `maxAllowedComplexity: 3` over the files commits 1-15 touched** and read the
   scores of every function created by an extraction. A helper at 29 is a trap for the next pass;
   nothing extracted should land above ~20. This is also the only way to confirm the parent actually
   dropped rather than shuffling the score into a sibling (§1.1).
2. **`beautify.ts:43` still scores under 30** after commit 2 (§1.1, §6).
3. **Re-run `knip --include exports,types` after commit 15 and before commit 17**, and diff against
   §1.2's 122. Work the real list, not this plan's (§5.3).
4. **Confirm the 7 removed entry patterns changed nothing** (§3.2): knip's finding set immediately
   before and after commit 25's `knip.json` edit must be identical apart from the `go` binary.
5. **Confirm the test override is doing exactly two things** — `gitStreamMock.ts:127` and
   `mode-switch.spec.ts:234` drop out, nothing else does. Measured: 21 findings without it, 19 with.

# 11. `SPEC.md`'s P94 result section

Append one paragraph to the existing `## P94 result` section, in the same shape as pass 1's and
pass 2's, opening `**Pass 3 — TS/Vue complexity and dead exports
(docs/v1.8/plans/P94-code-quality-tooling-iter3.md), 26 commits.**` It must state, because each is a
correction to the parent plan's §11 rather than a restatement of it:

- 21 Biome findings at 30, **19 after the new test-file override** — the sketch's "21 functions"
  counted two test files §4.2 had already exempted in prose but never in config.
- knip **73 exports + 49 types = 122**, not 71 + 46; pass 1's barrel rewrites *raised* the count,
  and why (named re-exports are individually visible where `export *` was not).
- Dropping `--include` also turned on the `binaries` rule: `go`, resolved with `ignoreBinaries`.
- The triage result: 106 keyword drops, 15 re-export-list prunes, 1 real deletion — **no test-only
  helper category and no intentional-public-API category**, both of which §11 predicted, with the
  two verifications that ruled them out (§5.1).
- The 8 configuration hints folded in, the 4 compiler hints declined with reason.
- Verification numbers as run, and pass 4's inheritance: the 500-byte flake and the two long-standing
  Biome findings still open, untouched.
- Any deviation from this plan, stated as a deviation with its reason — pass 2's own result section
  is the model for that.

# 12. Out of scope — confirmed, not forgotten

- **`errcheck` and `staticcheck`.** P95 owns them. No `.golangci.yml` change in this pass at all.
- **Any complexity threshold below 30.** Parent plan §4.2 settled the number; pass 3 enforces it and
  does not relitigate it.
- **Test-file complexity.** The two exempt findings (36 and 34) stay exempt. §3.1's override is the
  mechanism, and `CLAUDE.md`'s protection of the conformance suites is the reason.
- **Pass 4's named flakes** — `cell-editor.spec.ts`, `grpc-request.spec.ts`, `sql-schema.spec.ts`,
  `http-request-body.spec.ts`, `repo-workspace.spec.ts`, `scroll-trace.spec.ts`,
  `internal/grpcclient`'s port race, the Monaco-loading timeouts, and the two long-standing Biome
  warning/info findings. Recorded in §10's run, fixed by pass 4.
- **Biome rules pass 1 declined** — `useTopLevelRegex`, `noAwaitInLoops`, `noNamespaceImport`,
  `useMaxParams`, `noBarrelFile`. Each has a reason in the parent plan §4.3; none is revisited.
- **`knip`'s `duplicates` findings.** Pass 1 set `warn` with a per-instance reason. Pass 3 does not
  touch the six, and does not raise the level.
- **Converting `knip.json` to `knip.ts`** for a `.vue` compiler (§3.2), and any Go work whatsoever.
