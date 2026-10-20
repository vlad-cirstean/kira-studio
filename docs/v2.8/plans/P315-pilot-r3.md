# P315 pilot round 3: judge

Sample: 120 fresh units (50 Go, 40 TS, 30 Vue), Sonnet, `check` off (main arm per ledger). Round-3
pipeline: rewrite prompt fixes 1-3, deterministic pre-check (no tag shape, filler word or line over
100: return input, no model call), tokens gate quoted-span fix, width gate rejects a changed draft
keeping any line over 100. Rubric as rounds 1-2: unchanged is neutral or missed-trivia, never bad;
shorter earns nothing. All 120 units judged against originals. Sources read for #5, #72, #104.

## Result: PASS

| metric | round-3 bar | round 3 | round 2 | round 1 |
|---|---|---|---|---|
| meaning-level bad | <= 3 | 1 (#92) pass | 2 | 4 |
| missed-trivia | <= 12 | 9 pass | 3 | 9 |
| harmful re-pass changes | 0 | 0 pass | 10 | 3 |
| cosmetic churn | <= 5% | 1/92 = 1.1% pass (#96) | 0 | about 9% |
| re-pass cleanup (reported) | - | 4 (#31, #66, #70, #114) | 9 | - |
| idempotence rate (literal plan bar 95%) | reported | 87/92 = 94.6% | 81.6% | 67% |
| improved (reported) | - | 85 | 96 | 89 |
| bad-style | - | 0 | 2 | - |

Counts: good 85, neutral 25, missed-trivia 9, bad-lost-why 1, bad-wrong 0, bad-style 0.
Literal plan idempotence bar (>= 95%) misses by one unit; the one non-cleanup change (#96) is
harmless, so under the round-3 bars that replace it the round passes.

Improved fell 96 to 85: this sample is cleaner (25 unchanged vs 15), plus 3 keeps and 2 rewrites
that left a § ref. Not a regression in the rewriter.

## First pass

- #92 bad-lost-why: revert/commit history dropped together with the only reason for "Deliberately
  not applied to DocumentView.vue" (its pager was never touched and its placement never reported).
  Past-tense text that explains a current choice; round-3 history rule says keep it. Minor.
- Borderline, judged neutral: #5 (no-recorded-base case dropped with "before this phase"; code
  still handles it, "otherwise" covers it), #72 (count "eleven-plus" dropped as a tag; example list
  now reads exhaustive), #81 (verbless fragment after "split from" drop, fact kept), #95 (removed
  styling-prop history plus "no byte-identity guarantee left" dropped; one-anatomy fact kept).
- Missed-trivia in rewrites: #66 (`§7.4` left), #70 (`§6.4` left). Second pass fixed both.
- Round-2 failure modes gone: no false present claim from a tag drop (#61 class), no inherited
  over-width line in a rewrite (#31/#74 class; #13, #26, #94 reflowed), no tokens false reject.
- Leftover `actually` in four first rewrites (#31, #49, #90, #114); not trivia enough to grade.

## Kept units

- #41 kept:width, right per gate. Draft only dropped `F7's own fallback:` and was clean, but kept a
  line of 101 columns. The line is 95 chars raw with two leading tabs; the gate expands tabs to 4.
  The model likely counts a tab as one column. missed-trivia.
- #63 kept:width, right per gate. Draft dropped `(P247)` but kept two 104-col lines
  unreflowed. missed-trivia.
- #68 kept:tokens, right reject: draft rewrote `` `RemoteOpKind`s `` as `` `RemoteOpKinds` ``
  (backticked identifier changed). D51/G7/D52 left. missed-trivia.
- #116 not a keep: pre-check sent it to the model for its 101-col line; the model returned it
  unchanged, claiming every line fits. The width gate checks changed drafts only, so an unchanged
  result passes through with the inherited line. Neutral (never bad for not changing), same as
  round 2 #10/#117.

Width keeps cost 2 missed-trivia. Accepting those drafts instead would be 2 bad-style. Fix if
wanted (not gated): tell the model widths count a tab as 4 columns.

## Pre-check

22 first-pass skips (cost 0) and 3 model calls that came back unchanged.

- Model unchanged (3): #25, #98 (`just` = only, right), #116 (above). All neutral.
- Skips judged neutral: 18. Clean: #3, #9, #18, #28, #46, #52, #65, #78, #82, #83, #85, #100, #106,
  #119. Borderline provenance, judged neutral: #17 ("as its non-generic predecessor did"), #88
  ("the Electron build made implicitly"), #89 ("tried (and failed)" is the bug resolveId prevents),
  #102 (`fix:` prefix, pre-extraction note explains current call sites).
- False negatives: 4 of 22 (18%), 4 of the 9 missed-trivia.
  - Tag shapes the patterns miss, 3: #8 `MY-1` (hyphen), #1 `probe 4` (lowercase word plus digit),
    #87 `(7d, ...)` (digit then letter).
  - History narration with no tag or filler, 2: #7 "Folds what used to be each app's own
    storage/migrate.go", #87 "moved from `blameAnnotation.ts`".
- So yes, history narration without a tag or filler word is missed. Low rate: 2 of 22 skips here.
  Patterns that would catch all 4 (optional, not gated): `[A-Z]{1,3}-\d+`, `\bprobe \d+`,
  `\(\d+[a-z]\b`, `used to`, `moved (from|to|out|here)`, `no longer`.

## Second pass

92 rewritten units fed back. Pre-check skipped 80; 12 reached the model: unchanged 6, changed 5,
kept 1.

| id | class | change |
|---|---|---|
| 31 | legitimate cleanup | drops `actually` (closed list) |
| 66 | legitimate cleanup | drops leftover `§7.4 puts`, "Plain `--force` sits behind" |
| 70 | legitimate cleanup | drops leftover `§6.4` |
| 114 | legitimate cleanup | drops `actually` |
| 96 | cosmetic churn | drops `just` in "this just clears" (= only; closed list keeps that sense). No fact lost |
| 90 | kept:width, no change | draft dropped the "Real-interaction fix (user report quotes):" lead as history. That quote is the requirement the branch serves: would have been borderline harmful. Width gate rejected it (re-joined first line is 101 cols). No damage shipped, by luck of the gate |

Harmful 0. Round 2's past-tense flip-flop (10 harmful) is gone: the new history rule held on every
past-tense why the first pass kept, and the pre-check kept 80 of 92 away from the model.

## Cost

Main 1.5606 USD: 0.0130 per unit over 120, 0.0159 per model-called unit (98). Round 2: 0.0162.
Idempotence 0.1812 (0.0020 per fed-back unit). Round 3 total 1.7418. Pilot spend about 11.95 of
21.00. Mean wall 8.5 s per main call.

## Shipping risk for P318 (about 5k long comments)

- Meaning-level bad: 1/120 = 0.8% (95% upper bound about 4.6%). Expect about 40 damaged comments
  of 5k; plausible range 10 to 100, worst case near 230. Damage is minor so far (a lost secondary
  why), not false claims: bad-wrong 0 this round.
- Every meaning-level bad in rounds 2-3 (r2 #112, r2 #61, r3 #92) and the r3 #90 near-miss came from
  a `history` or tag-adjacent drop. A cheap review filter: flag rewrites whose `dropped` list holds a
  `history` item. In round 3 that is 28 of 92 rewrites and covers the one bad. Recommend P318
  lands as a reviewable diff with that subset skimmed.
- Missed-trivia 7.5%: about 375 comments keep some trivia. Harmless; extend pre-check patterns to
  cut it.
- Re-run risk: a second P318 pass is safe (0 harmful, 1% churn), so resume or rerun is fine.
- Safe defaults: `check` off (round 2: +27% cost, false alarms, missed-trivia fail), pre-check on,
  tokens gate on, width gate on (reject changed draft with any line over 100, tabs as 4), round-3
  rewrite prompt. Optional, not gating: extra pre-check patterns, tab-width note in the prompt.

## Per unit

| id | file:line | outcome | verdict | USD | reason |
|---|---|---|---|---|---|
| 0 | apps/kira-space/internal/gitsession/incremental.go:246 | rewritten | good | 0.0230 | G31 finding, F5, pre-fix comparison dropped |
| 1 | apps/kira-space/internal/gitclient/porcelain/reset.go:21 | unchanged (pre-check) | missed-trivia | 0.0000 | pre-check skip; `(probe 4)` tag left (lowercase word + digit) |
| 2 | apps/kira-space/internal/gitclient/porcelain/stash.go:282 | rewritten | good | 0.0092 | probe P12/P13 dropped |
| 3 | apps/kira-space/internal/gitclient/runner.go:243 | unchanged (pre-check) | neutral | 0.0000 | pre-check skip; clean |
| 4 | apps/kira-studio/internal/adapters/postgres/errors.go:1 | rewritten | good | 0.0144 | P58 D20, A20 dropped |
| 5 | apps/kira-space/internal/gitsession/stack.go:218 | rewritten | neutral | 0.0173 | tags dropped; no-recorded-base case dropped with "before this phase" (code still handles it, "otherwise" covers it) |
| 6 | apps/kira-studio/internal/dbmcp/render.go:798 | rewritten | good | 0.0168 | finding #12 M6, M7 finding #17 dropped; cost why kept |
| 7 | internal/appstorage/appstorage.go:16 | unchanged (pre-check) | missed-trivia | 0.0000 | pre-check skip; "Folds what used to be each app's own storage/migrate.go" history left |
| 8 | apps/kira-studio/internal/adapters/mysqlfamily/console.go:57 | unchanged (pre-check) | missed-trivia | 0.0000 | pre-check skip; `MY-1` tag left (hyphenated) |
| 9 | apps/kira-studio/internal/adapters/redis/adapter.go:226 | unchanged (pre-check) | neutral | 0.0000 | pre-check skip; clean |
| 10 | apps/kira-space/internal/gitsession/conn.go:276 | rewritten | good | 0.0089 | D13 dropped |
| 11 | internal/terminal/session.go:91 | rewritten | good | 0.0150 | §2.3, P85 §2.1 dropped |
| 12 | apps/kira-space/internal/gitops/errors.go:124 | rewritten | good | 0.0136 | G25 D15/probe M4 dropped |
| 13 | apps/kira-space/internal/gitrpc/remote.go:23 | rewritten | good | 0.0167 | D19/G5 D8 dropped; 113-col line reflowed |
| 14 | apps/kira-space/internal/gitpreflight/stack.go:135 | rewritten | good | 0.0243 | D1/probe P3, P1, P4 dropped; facts kept |
| 15 | apps/kira-studio/internal/ipcfixture/types.go:5 | rewritten | good | 0.0121 | D5 dropped |
| 16 | apps/kira-studio/internal/mcpauth/helperscript.go:11 | rewritten | good | 0.0134 | P108 Part 7 F2 dropped |
| 17 | internal/embedded/embedded.go:90 | unchanged (pre-check) | neutral | 0.0000 | pre-check skip; "as its non-generic predecessor did" provenance, borderline |
| 18 | apps/kira-space/internal/gitreview/store.go:325 | unchanged (pre-check) | neutral | 0.0000 | pre-check skip; clean |
| 19 | apps/kira-space/internal/gitsession/remote.go:146 | rewritten | good | 0.0165 | D11, D6 dropped; "this chapter's already-shipped code" left (borderline) |
| 20 | apps/kira-studio/internal/dbmcp/tools.go:163 | rewritten | good | 0.0249 | § tags and (unchanged)/(new)/(reordered) markers dropped; gate order and reasons kept |
| 21 | apps/kira-space/internal/gitsession/entry.go:18 | rewritten | good | 0.0134 | F2/F3, D14 dropped |
| 22 | apps/kira-studio/internal/adapters/sqlite/read.go:25 | rewritten | good | 0.0137 | F21/D21 dropped |
| 23 | apps/kira-space/internal/gitsession/refs.go:158 | rewritten | good | 0.0108 | F10 dropped |
| 24 | apps/kira-studio/internal/adapters/tracker.go:8 | rewritten | good | 0.0147 | P13 D3 and carried-verbatim history dropped |
| 25 | apps/kira-studio/internal/adapters/postgres/client.go:270 | unchanged | neutral | 0.0107 | model call ("just"); unchanged, "just" = only, right |
| 26 | internal/flowtest/fakeagent/fakeagent.go:1 | rewritten | good | 0.0339 | reflow only of 4 over-width lines; words kept |
| 27 | apps/kira-studio/internal/adapters/awscfg/config.go:25 | rewritten | good | 0.0134 | P58d D7 dropped |
| 28 | internal/sqlitex/reindex.go:41 | unchanged (pre-check) | neutral | 0.0000 | pre-check skip; clean |
| 29 | apps/kira-space/internal/gitclient/repo.go:60 | rewritten | good | 0.0109 | F17 dropped |
| 30 | apps/kira-studio/internal/adapters/kafka/client.go:22 | rewritten | good | 0.0371 | P58e/P21 tags and round-1 miss narration dropped; escape-hatch why kept |
| 31 | apps/kira-studio/internal/storage/repos/maskrules.go:157 | rewritten | good | 0.0199 | finding #6, F8 (P108 Part 3), "now" dropped; race why kept in past tense |
| 32 | internal/metrics/processlist_darwin.go:20 | rewritten | good | 0.0142 | F8 dropped; cost comparison kept |
| 33 | apps/kira-studio/internal/storage/repos/variables.go:1070 | rewritten | good | 0.0166 | D2, D5, D10, "simply" dropped |
| 34 | apps/kira-studio/internal/secrets/cipher.go:30 | rewritten | good | 0.0100 | P52 §6.5 dropped |
| 35 | apps/kira-studio/internal/adapters/postgres/catalog.go:435 | rewritten | good | 0.0125 | D17 dropped |
| 36 | apps/kira-studio/internal/adapterhost/session.go:40 | rewritten | good | 0.0155 | P2 R1 and two "just" dropped |
| 37 | apps/kira-space/internal/gitsession/preflight.go:18 | rewritten | good | 0.0139 | F1 (P108 Part 16 review) dropped; security why kept |
| 38 | apps/kira-studio/main.go:254 | rewritten | good | 0.0247 | P103/P107/P22 tags, "now" dropped |
| 39 | apps/kira-studio/internal/adapters/testsupport/scenarios.go:172 | rewritten | good | 0.0128 | "phase's", §1.4, "in the plan" dropped |
| 40 | apps/kira-studio/internal/adapters/testsupport/matrix.go:93 | rewritten | good | 0.0170 | P25 §2.4 row 6 dropped |
| 41 | apps/kira-studio/internal/adapters/mongo/read.go:266 | kept:width | missed-trivia | 0.0148 | kept:width, right per gate: draft dropped only `F7's own fallback:` but kept a 101-col line (tab-expanded; 95 chars raw) |
| 42 | apps/kira-studio/internal/bridge/layout.go:23 | rewritten | good | 0.0144 | P8 D3, F7, "actually" dropped; bug why kept |
| 43 | apps/kira-studio/internal/postman/body.go:1 | rewritten | good | 0.0123 | P4 D7 dropped |
| 44 | apps/kira-studio/internal/dbmcp/explain.go:21 | rewritten | good | 0.0129 | "actually" dropped |
| 45 | apps/kira-space/internal/gitsearch/dialect.go:24 | rewritten | good | 0.0169 | D4, F15 dropped |
| 46 | apps/kira-studio/internal/adapters/redis/consolebound.go:15 | unchanged (pre-check) | neutral | 0.0000 | pre-check skip; clean |
| 47 | apps/kira-studio/internal/adapterhost/host.go:44 | rewritten | good | 0.0237 | F5, F3, "now", "actually" dropped; rejected-alternative why kept |
| 48 | internal/rpcstream/frame.go:48 | rewritten | good | 0.0166 | G1/G2, D4 dropped |
| 49 | apps/kira-studio/internal/adapters/mysqlfamily/mutate.go:11 | rewritten | good | 0.0156 | P2 R1 dropped |
| 50 | packages/git-ui/src/state/detailActions.ts:66 | rewritten | good | 0.0127 | P75 §2.3, P74 §3.3 dropped |
| 51 | packages/workbench/src/state/contextMenu.ts:118 | rewritten | good | 0.0084 | P21 D5 dropped |
| 52 | packages/git-ui/src/lib/rowAccessibility.ts:13 | unchanged (pre-check) | neutral | 0.0000 | pre-check skip; clean |
| 53 | apps/kira-studio/frontend/src/views/grid/pendingChanges.ts:254 | rewritten | good | 0.0158 | "in this phase (P6+ nicety)" dropped; not-built fact kept |
| 54 | packages/api-core/src/http/dotenv.ts:66 | rewritten | good | 0.0121 | D22 dropped |
| 55 | apps/kira-studio/frontend/src/views/console/format.ts:182 | rewritten | good | 0.0207 | P19 D13/P13 §3 reopening note, D12 dropped |
| 56 | packages/workbench/src/editor/monacoTheme.ts:119 | rewritten | good | 0.0155 | D1/D4 dropped; "no longer share" to present tense |
| 57 | packages/shared/domain/dbmcp.ts:44 | rewritten | good | 0.0155 | M2/M3 § tags dropped |
| 58 | apps/kira-space/frontend/src/repo/state/repoHeads.ts:19 | rewritten | good | 0.0117 | P83 plan §12.3 dropped |
| 59 | apps/kira-studio/frontend/src/api/state/variableCompletion.ts:74 | rewritten | good | 0.0136 | D4 dropped; rejected-alternative why kept |
| 60 | packages/git-ui/src/graph/rowSvg.ts:26 | rewritten | good | 0.0157 | W3, W5 dropped |
| 61 | packages/api-core/src/http/curl/tokenize.ts:47 | rewritten | good | 0.0209 | D3, D5, D4, "simply" dropped |
| 62 | apps/kira-studio/frontend/src/views/shared/viewOp.ts:159 | rewritten | good | 0.0137 | P113 F4, D10/D12 dropped |
| 63 | apps/kira-space/frontend/src/ade/v2/board/workflowGraph.ts:6 | kept:width | missed-trivia | 0.0091 | kept:width, right per gate: draft dropped `(P247)` but kept two 104-col lines |
| 64 | apps/kira-space/frontend/src/main.ts:72 | rewritten | good | 0.0150 | P129 Part 3 §2.8 dropped |
| 65 | apps/kira-space/frontend/src/state/tabs.ts:100 | unchanged (pre-check) | neutral | 0.0000 | pre-check skip; clean |
| 66 | packages/git-core/src/model/remote.ts:71 | rewritten | missed-trivia | 0.0144 | D48 dropped; `§7.4 puts` left (second pass fixed it) |
| 67 | apps/kira-studio/frontend/src/api/state/collections.ts:54 | rewritten | good | 0.0122 | "why P1 factored TreeHost out" history dropped; "rows do not" keeps the why |
| 68 | packages/git-ipc/src/contract.ts:801 | kept:tokens | missed-trivia | 0.0180 | kept:tokens, right reject: draft changed `RemoteOpKind`s to `RemoteOpKinds`; D51/G7/D52 left |
| 69 | apps/kira-space/frontend/src/views/repo/markdownReading.ts:1 | rewritten | good | 0.0138 | P67c D10/D13 dropped |
| 70 | packages/git-ui/src/state/liveAnnouncements.ts:1 | rewritten | missed-trivia | 0.0285 | plan paths, W14/W12 dropped; `§6.4` left (second pass fixed it) |
| 71 | packages/git-ui/src/state/search.ts:296 | rewritten | good | 0.0177 | OQ1, "actually" dropped |
| 72 | packages/api-core/src/index.ts:1 | rewritten | neutral | 0.0184 | P12 D7, F22 dropped; "eleven-plus" count dropped as tag, list now reads exhaustive (borderline) |
| 73 | packages/workbench/src/editor/monarch/redis.ts:3 | rewritten | good | 0.0102 | P60a §4.2 dropped |
| 74 | apps/kira-space/frontend/src/views/repo/editors.ts:121 | rewritten | good | 0.0104 | P92 item 5 dropped |
| 75 | apps/kira-space/frontend/src/state/workspace.ts:134 | rewritten | good | 0.0100 | P128 §2.6 dropped |
| 76 | apps/kira-space/frontend/src/repo/git/transport.ts:81 | rewritten | good | 0.0132 | §7.6, S9 dropped; "repaint table" loses its article |
| 77 | apps/kira-studio/frontend/src/project/state/tree.ts:641 | rewritten | good | 0.0219 | P94 tag and moved-out narration dropped; sync-call constraint kept |
| 78 | apps/kira-space/frontend/src/views/repo/useDiffEditor.ts:129 | unchanged (pre-check) | neutral | 0.0000 | pre-check skip; clean |
| 79 | apps/kira-studio/frontend/src/views/grid/menu.ts:279 | rewritten | good | 0.0132 | F6 and FK-button history dropped; masked-compare bug why kept |
| 80 | packages/shared/domain/repo.ts:78 | rewritten | good | 0.0143 | C7 §3.1/D6, §3.5 dropped |
| 81 | apps/kira-space/frontend/src/repo/state/search.ts:10 | rewritten | neutral | 0.0172 | tags dropped; "split from" removal leaves a verbless fragment, fact kept |
| 82 | apps/kira-studio/frontend/src/editor/findRanges.ts:101 | unchanged (pre-check) | neutral | 0.0000 | pre-check skip; clean |
| 83 | packages/shared/domain/grpc.ts:83 | unchanged (pre-check) | neutral | 0.0000 | pre-check skip; clean |
| 84 | apps/kira-studio/frontend/src/api/state/variables.ts:46 | rewritten | good | 0.0126 | P108 F10 dropped; uncaught-throw why kept |
| 85 | packages/workbench/src/behaviour/clipboard.ts:90 | unchanged (pre-check) | neutral | 0.0000 | pre-check skip; clean |
| 86 | apps/kira-studio/frontend/src/views/console/explain.ts:28 | rewritten | good | 0.0144 | M3 §9.1 dropped; `SPEC §11` kept with its rule (borderline) |
| 87 | apps/kira-space/frontend/src/views/repo/blameLine.ts:110 | unchanged (pre-check) | missed-trivia | 0.0000 | pre-check skip; `(7d, moved from blameAnnotation.ts ...)` tag and move narration left |
| 88 | apps/kira-studio/frontend/src/bridge/index.ts:308 | unchanged (pre-check) | neutral | 0.0000 | pre-check skip; "the Electron build made implicitly" provenance, borderline |
| 89 | packages/workbench/src/viteAppConfig.ts:40 | unchanged (pre-check) | neutral | 0.0000 | pre-check skip; "tried (and failed)" is the bug resolveId prevents: current why |
| 90 | apps/kira-studio/frontend/src/views/grid/SlickGridHost.vue:1726 | rewritten | good | 0.0178 | §4a/§4d dropped; user-report and before-fix bug kept as why |
| 91 | apps/kira-studio/frontend/src/api/VariablesOverviewPanel.vue:127 | rewritten | good | 0.0226 | P22b/F13/B36c tags, plan-allowlist and relocation notes dropped |
| 92 | apps/kira-studio/frontend/src/views/grid/DataToolbar.vue:281 | rewritten | bad-lost-why | 0.0222 | revert/commit history dropped with the only why for "Deliberately not applied to DocumentView.vue" (its placement was never touched or reported) |
| 93 | apps/kira-studio/frontend/src/views/definition/DefinitionView.vue:359 | rewritten | good | 0.0114 | Item 4 and old gate history dropped; current rule kept |
| 94 | apps/kira-studio/frontend/src/views/shared/fields/FieldRowsTable.vue:203 | rewritten | good | 0.0231 | reflow only of one 103-col line |
| 95 | packages/git-ui/src/components/FileTree.vue:3 | rewritten | neutral | 0.0265 | plan tags dropped; removed-prop history and "no byte-identity guarantee left" why for one anatomy dropped (borderline) |
| 96 | apps/kira-studio/frontend/src/views/console/ConsoleSlickGrid.vue:848 | rewritten | good | 0.0121 | P19 D8 dropped |
| 97 | packages/git-ui/src/components/CommitGrid.vue:72 | rewritten | good | 0.0226 | P11 W13, W14 plan step dropped |
| 98 | packages/workbench/src/components/ConfirmDialog.vue:24 | unchanged | neutral | 0.0116 | model call ("just"); unchanged, "just" = only, right |
| 99 | apps/kira-space/frontend/src/views/repo/RepoFileView.vue:66 | rewritten | good | 0.0152 | D11, D12, §2.3, "before this phase" dropped; "byte-identical" dangles slightly |
| 100 | packages/git-ui/src/App.vue:187 | unchanged (pre-check) | neutral | 0.0000 | pre-check skip; clean |
| 101 | apps/kira-studio/frontend/src/workbench/panels/ProjectPanel.vue:51 | rewritten | good | 0.0150 | P28 D18, "moved to" dropped |
| 102 | packages/theme/src/components/TooltipIconButton.vue:54 | unchanged (pre-check) | neutral | 0.0000 | pre-check skip; `fix:` prefix and pre-extraction note explain current call sites (borderline) |
| 103 | apps/kira-studio/frontend/src/project/ProjectTree.vue:80 | rewritten | good | 0.0182 | F3 (P108 Part 12) and move narration dropped; current wiring and why kept |
| 104 | apps/kira-studio/frontend/src/api/ImportReportStrip.vue:10 | rewritten | good | 0.0170 | P4 D12, "in P4", P104 §9 dropped; "not undoable" still true (no import undo in source) |
| 105 | apps/kira-studio/frontend/src/views/console/ConsoleResultGrid.vue:275 | rewritten | good | 0.0167 | P46-4, P42 D11, "no longer" dropped |
| 106 | apps/kira-studio/frontend/src/views/shared/DateTimePicker.vue:223 | unchanged (pre-check) | neutral | 0.0000 | pre-check skip; clean |
| 107 | apps/kira-space/frontend/src/workbench/settings/DateFormatField.vue:10 | rewritten | good | 0.0149 | I2-18, P120, former-shared-type history dropped |
| 108 | packages/git-ui/src/components/BranchPicker.vue:366 | rewritten | good | 0.0120 | W20 dropped |
| 109 | packages/git-ui/src/components/review/BaseSelector.vue:4 | rewritten | good | 0.0194 | plan path, §6.8, W14 dropped |
| 110 | packages/git-ui/src/components/SearchBox.vue:102 | rewritten | good | 0.0103 | OQ5 dropped |
| 111 | apps/kira-studio/frontend/src/views/httprequest/ResponseDiffDialog.vue:127 | rewritten | good | 0.0115 | D12, P2 F13 dropped |
| 112 | apps/kira-studio/frontend/src/views/grid/DataView.vue:93 | rewritten | good | 0.0157 | P48 step 14, P22 D4, move narration dropped; slot constraint kept |
| 113 | apps/kira-studio/frontend/src/views/httprequest/RawExchangePane.vue:44 | rewritten | good | 0.0215 | P18 D8, P9 D7, old empty-Raw narration, "actually" dropped; double-snapshot objection kept |
| 114 | apps/kira-studio/frontend/src/views/shared/celleditor/CellEditorView.vue:223 | rewritten | good | 0.0195 | deleted-DataGrid history and duplicate last line dropped |
| 115 | packages/git-ui/src/components/dialogs/PostCheckoutPullDialog.vue:2 | rewritten | good | 0.0152 | G-UX, P131 Part 1 §6.1, "now" dropped |
| 116 | apps/kira-studio/frontend/src/project/credentialPaste/CredentialPastePanel.vue:23 | unchanged | neutral | 0.0091 | model call (101-col line); unchanged; model claimed every line fits; unchanged output bypasses width gate |
| 117 | apps/kira-studio/frontend/src/views/documents/DocumentView.vue:415 | rewritten | good | 0.0137 | Item 4, old gate history, "now", "actually" dropped |
| 118 | apps/kira-studio/frontend/src/views/shared/page/SearchToolbar.vue:177 | rewritten | good | 0.0162 | P31 D22/D23/F23, D23 dropped |
| 119 | apps/kira-studio/frontend/src/views/grid/ColumnsMenu.vue:39 | unchanged (pre-check) | neutral | 0.0000 | pre-check skip; clean |
