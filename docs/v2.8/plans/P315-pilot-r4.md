# P315 pilot round 4: judge

Sample: 120 fresh repo units (arm A: 50 Go, 40 TS, 30 Vue) plus arm B (40 third-party comments, 10
prose notes). Sonnet, `check` off. Round-4 pipeline: generic `memory.rewrite.system` and check
prompts (worktree `d531d53`), generic pre-check (`a9c8cd0`: label shape, history word, hedge,
width), round-3 gates. Binaries carry the generic prompt text (string match), so the data tests
the committed prompt. Second pass run twice over the same 96 rewrites: with pre-check (`idem`)
and without (`np`). Rubric as rounds 1-3: unchanged is neutral or missed-trivia, never bad. Every
unit judged from before/after text. Sources read for #22, #35, #107 (plus `np` #1, #69, #94).

## Result: FAIL

| metric | bar | round 4 | round 3 |
|---|---|---|---|
| meaning-level bad (A) | <= 3/120 | 2 (#62, #94) pass | 1 |
| missed-trivia (A) | <= 12/120 | 5 pass | 9 |
| harmful second-pass changes | 0 | 1 (#35) FAIL; `np` 3 | 0 |
| second-pass churn | <= 5% | 10/96 = 10.4% FAIL | 1.1% |
| bad-style (reported) | - | 2 (#44, #56) | 0 |
| arm B meaning-level bad | - | 2 (#18, #42) + 2 gate-saved drafts | - |

Counts A: good 89, neutral 22, missed-trivia 5, bad-lost-why 2, bad-wrong 0, bad-style 2.

First pass is as good as round 3. The round fails on the second pass: one harmful change, churn
twice the bar, and the two independent second passes disagree (below).

## First pass (arm A)

- #62 bad-lost-why: move history dropped together with "this is scan.ts's own
  escapeRegExp/compilePattern verbatim", the fact that grid search and find bar share semantics.
  "Hoisted here rather than imported across" now has no origin. Lowercase lead too.
- #94 bad-lost-why: "the grid was the one view whose header carried no facts ... every sibling view
  says more" is the reason the badges exist. Dropped as history. Past tense explaining a current
  choice; the prompt says keep it.
- Borderline, judged neutral, same class (hoist/move history drop takes a current fact along):
  #53 (caller `editor.openAllChanges` lost), #96 (data-testid parity with OperationsPanel.vue and
  the `columns` prop reason lost), #112 (two-app usage and which props vary lost).
- bad-style #44, #56: tag removed mid-paragraph leaves a lowercase sentence (`one. the same`).
  The same lowercase lead appears at text start in about 25 rewrites; not graded.
- Missed-trivia 5, all keeps: #34, #64, #73, #77 (kept:width, inherited or model-made over-width
  line), #102 (kept:form). #40 kept:grew is right: the draft doubled a backslash in a backticked
  span.
- Leftover hedges or `now` in first rewrites: #15, #45, #109, #114. Second pass fixed them. Not
  graded, as round 3.
- Pre-check first pass: 14 skips, all clean. 0 false negatives this round.

## Second pass (arm A)

96 rewrites fed back. With pre-check: 51 skipped, 45 to the model, 10 changed, 1 kept:grew.

| id | class | change |
|---|---|---|
| 15 | legitimate cleanup | drops `actually` |
| 109 | legitimate cleanup | drops `actually` |
| 45 | legitimate cleanup | drops `now` in "Add now runs under the same lock" |
| 114 | legitimate cleanup | drops `now` |
| 44 | legitimate cleanup | drops ", just no longer unbounded"; bound already stated |
| 95 | legitimate cleanup | drops `command:` anchor history; keeps "since the reveal is a bridge request" |
| 107 | legitimate cleanup, borderline (flagged) | drops "`.cm-line`'s own padding used to give each row". `.cm-line` is CodeMirror; the app is on Monaco. Purpose "breathing room" stays; only the dead origin of the value goes |
| 22 | legitimate content, style loss (flagged) | drops "readTopic is read.ts's readTopic (:193-319)." No `read.ts` exists in the repo, so a dead pointer. But the Go doc comment no longer starts with `readTopic` |
| 103 | harmless churn | drops "First section expanded on mount, the rest collapsed." as restatesCode |
| 35 | HARMFUL | drops "sqlite.go ports planParsers/sqlite.ts verbatim:" as history. `frontend/src/views/console/planParsers/sqlite.ts` exists and `plan.ts` imports it: a live twin the Go parser must match. Also strips the file comment's subject |

Harmful 1. The implementer's flags miss the real one: #22 and #107 are acceptable, #35 is not.

Without pre-check (`np`): also 10 changed, but only 6 ids coincide (15, 44, 95, 103, 109, 114).
`np` adds 3 harmful drops the pre-check arm did not make:
- #1 ", which no longer re-derives it from a second git config spawn": the benefit of computing once.
- #69 "The terminator is now a property of the SOURCE ... one that did not still does not" dropped
  as restatesCode: the fix's invariant.
- #94 "(§7 forbids computing one automatically)": the reason the count is gated.
Plus #32 (SPEC quote dropped as tag; neutral).

Churn verdict: instability, not convergent late cleanup. Six of the 10 changes are first-pass
leftovers (hedges, `now`, one clause) and would recur on any rerun. The other four are sampling
noise: two runs over identical input change different units, and the harmful sets are disjoint
(`idem` #35; `np` #1, #69, #94). "A text you cleaned before comes back unchanged" does not hold
once the model sees a clean text: about 1 harmful edit per 15-45 model calls on already-clean
input.

Why worse than round 3 (0 harmful, 1.1%): exposure. Round 3's pre-check sent 12 of 92 rewrites
back to the model; round 4's generic `historyWord` (`was|were|now|before|instead|old`) sends 45 of
96. Same per-call risk, four times the calls.

## Pre-check and prompts: generic?

- `memory.rewrite.system` and `memory.rewrite.check.system`: no repo literal left (no P/D/F/G tags,
  `§` examples, plan paths or round/part strings). Label categories are described in general terms.
- `rewrite_precheck.go`: generic regexes (ID-like token, `#123`, `§`, dotted version, `.md`,
  tracking vocabulary, history words, closed hedge list). `rewrite_gate.go` directive list is
  standard tool directives and licence headers. No repo-specific pattern.
- Defect: `internal/llmprompts/registry.go` is not gofmt-clean (`gofmt -l` lists it; the
  `MemoryRewriteSystem` `Default:` line has 3 tabs). Fix before merge.
- Nit: `labelShape` doc comment breaks mid-sentence ("(.md) and" / "tracking vocabulary.").

Pre-check justified? Yes, on cost and zero false negatives: first pass 14 skips across A, 20 in B,
none hiding trivia; second-pass cost 0.63 vs 1.03 USD (-39%). It does not cut churn rate (10 vs
10 changes); it only cuts how many clean texts reach the model, and its new history words cut that
far less than round 3's tag-only check.

## Arm B (third-party code, notes)

Changed 9:
- good 7: #0, #4, #8, #20 (closed-list hedges, reflow), #26, #31, #39 (reflow only).
- #18 bad-lost-why (flagged): "See issue #64947 for more detail, but" dropped as a tag. A public
  issue pointer is a cross-reference to the full explanation, not an internal label. "The short
  answer is" now has no long answer.
- #42 bad-lost-why (flagged): "which is why it went unnoticed for months" dropped as history. It
  is a consequence of the BOM cause, the kind of past-tense chain the prompt says to keep.

Kept 3, all `width` (prose lines over 100 columns):
- #41 missed-trivia: draft dropped `really` only; fine draft, wrong gate for prose.
- #44 gate-saved near-miss: draft dropped "Yesterday: finished the retry logic for uploads." from
  a standup note. That is the note's content.
- #45 gate-saved near-miss: draft dropped "Release notes 2.4.0." and "(was 25)" from release
  notes. Version and old value are the content.

Unchanged 38: all right. Model held `old`, `previously`, rejected-alternative and quoted-`actually`
cases (#33, #40, #47, #48). Pre-check skips 20, all clean.

Arm B finding: code-comment hygiene (labels, history) is applied to prose where history and
version are the subject. Only the width gate stopped two destructive drafts, by accident.

## Recommendations (generic only)

1. Rerun and resume: never re-feed a unit already rewritten. Skip by ledger (input hash to output
   hash), so second-pass risk is zero by construction. This one change clears both failing bars
   for P318.
2. Pre-check `historyWord`: drop the common words `was|were|now|before|instead|old|earlier`; keep
   unambiguous narration (`previously`, `formerly`, `originally`, `no longer`, `used to`,
   `renamed`, `moved from`, `replaced`). A miss costs only trivia; a hit on clean text costs risk.
3. Prompt, cross-references: "X ports Y", "mirrors Y", "Y's twin/counterpart", "see issue N / PR
   N / URL" are cross-references; keep them. Drop a file or symbol reference only inside a
   moved-from or renamed-from clause.
4. Prompt, doc comments: keep the lead clause that names the documented symbol.
5. Prompt, restatesCode: drop only a sentence that restates the code below. Never drop a stated
   invariant, contract or behaviour guarantee.
6. Prompt, capitalisation: after removing a leading label, capitalise the sentence that now
   starts there. Form only; no other wording change.
7. Notes (text that is not a code comment): history, dates, versions and old values are content;
   drop only closed-list hedges. No reflow and no width rule for prose; keep its line structure.
   Apply width to code comments only.
8. Hoist/move history: when dropping a moved-from clause, keep any current fact it carries (who
   else uses it, what must stay identical).
9. Fix gofmt on `registry.go`.

## Overall

FAIL. First pass passes both meaning bars (2 bad, 5 trivia). Second pass fails: 1 harmful (#35),
churn 10.4%, and a second run picks different units, so the churn is instability. Arm B shows
the prompt is not safe on prose notes. To pass: rec 1 (ledger skip) removes the re-pass risk;
recs 3-5 and 7 address the four first-pass and arm-B losses; rerun arm B notes and a second pass
of arm A (only if rec 1 is not taken) to confirm.

## Cost

Main 1.5971 USD (0.0133 per unit), `idem` 0.6279, `np` idem 1.0295, arm B 0.3490. Round 4 total
about 3.60. Pilot spend about 15.55 of 21.00.

## Per unit (arm A)

| id | file:line | outcome | verdict | USD | reason |
|---|---|---|---|---|---|
| 0 | apps/kira-studio/internal/adapters/caps.go:52-55 | rewritten | good | 0.0150 | labels/hedges dropped; facts kept |
| 1 | apps/kira-space/internal/gitpreflight/pull.go:110-113 | rewritten | good | 0.0188 | labels/hedges dropped; facts kept |
| 2 | apps/kira-studio/internal/adapters/testsupport/kafka.go:75-81 | rewritten | good | 0.0206 | labels/hedges dropped; facts kept |
| 3 | apps/kira-studio/internal/dbmcp/render.go:58-61 | rewritten | good | 0.0173 | labels/hedges dropped; facts kept |
| 4 | apps/kira-space/internal/bridge/codeworkspace.go:253-256 | rewritten | good | 0.0124 | labels/hedges dropped; facts kept |
| 5 | apps/kira-studio/internal/adapters/testsupport/images.go:56-60 | rewritten | good | 0.0129 | labels/hedges dropped; facts kept |
| 6 | apps/kira-studio/internal/apivars/resolve.go:130-145 | rewritten | good | 0.0196 | labels/hedges dropped; facts kept |
| 7 | apps/kira-space/internal/gitsession/entry.go:256-260 | rewritten | good | 0.0164 | tags dropped; lowercase lead, odd reflow |
| 8 | apps/kira-studio/internal/adapters/mongo/errors.go:12-16 | rewritten | good | 0.0118 | labels/hedges dropped; facts kept |
| 9 | internal/embedded/embedded.go:9-13 | unchanged | neutral | 0.0000 | pre-check skip; clean |
| 10 | apps/kira-studio/internal/grpcclient/target.go:91-95 | rewritten | good | 0.0134 | labels/hedges dropped; facts kept |
| 11 | apps/kira-studio/internal/adapters/sqlite/adapter.go:216-220 | rewritten | good | 0.0117 | labels/hedges dropped; facts kept |
| 12 | internal/appstorage/window.go:35-40 | rewritten | good | 0.0153 | labels/hedges dropped; facts kept |
| 13 | internal/testx/testx.go:58-61 | unchanged | neutral | 0.0000 | pre-check skip; clean |
| 14 | apps/kira-space/internal/gitsession/ops.go:268-272 | unchanged | neutral | 0.0127 | model unchanged; clean |
| 15 | apps/kira-studio/internal/connections/service.go:487-490 | rewritten | good | 0.0120 | F8/P108 tag dropped; second pass drops `actually` (legit) |
| 16 | apps/kira-studio/internal/grpcclient/call.go:247-250 | rewritten | good | 0.0124 | replaced-defer history dropped |
| 17 | apps/kira-studio/internal/httpclient/timeline.go:223-226 | rewritten | good | 0.0112 | labels/hedges dropped; facts kept |
| 18 | apps/kira-studio/internal/adapters/mysqlfamily/read.go:37-43 | rewritten | good | 0.0136 | labels/hedges dropped; facts kept |
| 19 | apps/kira-space/internal/bridge/terminal.go:7-13 | rewritten | good | 0.0195 | labels/hedges dropped; facts kept |
| 20 | apps/kira-space/internal/gitsession/conn.go:267-271 | rewritten | good | 0.0124 | labels/hedges dropped; facts kept |
| 21 | apps/kira-studio/internal/adapters/sqltext.go:273-279 | rewritten | good | 0.0131 | labels/hedges dropped; facts kept |
| 22 | apps/kira-studio/internal/adapters/kafka/read.go:482-489 | rewritten | good | 0.0212 | tags dropped; second pass drops dead read.ts lead (legit content, loses name lead) |
| 23 | apps/kira-space/internal/ghclient/discovery.go:73-77 | rewritten | good | 0.0127 | labels/hedges dropped; facts kept |
| 24 | apps/kira-studio/internal/adapters/connset.go:99-102 | unchanged | neutral | 0.0106 | model unchanged; clean |
| 25 | apps/kira-studio/internal/postman/url.go:152-155 | rewritten | good | 0.0095 | labels/hedges dropped; facts kept |
| 26 | apps/kira-studio/internal/buildinfo/buildinfo.go:5-16 | unchanged | neutral | 0.0120 | model unchanged; clean |
| 27 | apps/kira-space/internal/gitrpc/incremental.go:12-15 | rewritten | good | 0.0144 | labels/hedges dropped; facts kept |
| 28 | apps/kira-space/internal/gitsession/walk.go:393-397 | rewritten | good | 0.0097 | labels/hedges dropped; facts kept |
| 29 | apps/kira-studio/internal/storage/repos/response_history.go:55-58 | rewritten | good | 0.0137 | labels/hedges dropped; facts kept |
| 30 | apps/kira-studio/internal/httpclient/wire.go:38-41 | rewritten | good | 0.0138 | labels/hedges dropped; facts kept |
| 31 | apps/kira-space/internal/buildinfo/buildinfo.go:1-6 | rewritten | good | 0.0122 | labels/hedges dropped; facts kept |
| 32 | apps/kira-space/internal/gitsearch/literal.go:54-62 | rewritten | good | 0.0428 | labels/hedges dropped; facts kept |
| 33 | apps/kira-studio/internal/adapters/mysqlfamily/console.go:153-157 | unchanged | neutral | 0.0000 | pre-check skip; clean |
| 34 | apps/kira-studio/internal/connections/resolve.go:92-104 | kept:width | missed-trivia | 0.0206 | kept:width; draft left a 130-col line; P21 tag left |
| 35 | apps/kira-studio/internal/queryplan/sqlite.go:11-16 | rewritten | good | 0.0136 | D14/D16 dropped; second pass HARMFUL: drops live `ports planParsers/sqlite.ts` twin ref |
| 36 | apps/kira-space/internal/gitclient/watcher_fsevents_darwin.go:91-95 | rewritten | good | 0.0131 | labels/hedges dropped; facts kept |
| 37 | apps/kira-studio/internal/datagrip/jdbc.go:258-280 | rewritten | good | 0.0265 | D9/F6 tags and before-this-fix clause dropped; bug explanation kept |
| 38 | apps/kira-studio/internal/page/scratch.go:7-10 | unchanged | neutral | 0.0000 | pre-check skip; clean |
| 39 | apps/kira-studio/internal/dbmcp/access.go:10-14 | rewritten | good | 0.0149 | labels/hedges dropped; facts kept |
| 40 | apps/kira-studio/internal/adapters/redis/catalog.go:80-83 | kept:grew | neutral | 0.0139 | kept:grew; draft doubled a backslash, gate right |
| 41 | apps/kira-studio/internal/storage/model/connection.go:79-85 | rewritten | good | 0.0187 | tags and rename history dropped; alias reason kept (borderline) |
| 42 | apps/kira-studio/internal/adapters/mongo/literal.go:568-571 | rewritten | good | 0.0185 | reflow of over-width line only |
| 43 | apps/kira-studio/internal/postman/body.go:189-197 | rewritten | good | 0.0125 | labels/hedges dropped; facts kept |
| 44 | apps/kira-studio/internal/adapterhost/router.go:255-258 | rewritten | bad-style | 0.0173 | tags dropped; mid-paragraph `. the same` lowercase; second pass drops `no longer unbounded` (legit) |
| 45 | apps/kira-studio/internal/adapters/tracker.go:20-26 | rewritten | good | 0.0131 | F3 dropped; second pass drops `now` (legit) |
| 46 | apps/kira-space/internal/gitcred/relay.go:83-86 | unchanged | neutral | 0.0000 | pre-check skip; clean |
| 47 | apps/kira-studio/internal/tree/service.go:170-173 | rewritten | good | 0.0131 | labels/hedges dropped; facts kept |
| 48 | apps/kira-space/internal/gitsession/preflight.go:410-416 | rewritten | good | 0.0155 | labels/hedges dropped; facts kept |
| 49 | apps/kira-studio/internal/adapters/s3/mutate.go:255-258 | rewritten | good | 0.0114 | labels/hedges dropped; facts kept |
| 50 | packages/git-ipc/src/contract.ts:1066-1070 | rewritten | good | 0.0163 | tags and phase-budget clause dropped |
| 51 | packages/git-ui/src/state/graphView.ts:222-228 | rewritten | good | 0.0155 | labels/hedges dropped; facts kept |
| 52 | packages/git-ui/src/state/ops.ts:981-984 | rewritten | good | 0.0150 | tag and before-this-phase clause dropped |
| 53 | apps/kira-space/frontend/src/state/repoTabs.ts:189-194 | rewritten | neutral | 0.0175 | tag dropped; caller name `editor.openAllChanges` lost with replacement history (borderline) |
| 54 | packages/api-core/src/http/raw/generate.ts:51-68 | rewritten | good | 0.0238 | labels/hedges dropped; facts kept |
| 55 | apps/kira-studio/frontend/src/views/shared/slick/rowVisibility.ts:16-22 | rewritten | good | 0.0146 | labels/hedges dropped; facts kept |
| 56 | apps/kira-space/frontend/src/repo/git/hostHandlers.ts:67-73 | rewritten | bad-style | 0.0161 | tags dropped; mid-paragraph sentence left lowercase |
| 57 | packages/shared/domain/http.ts:61-64 | rewritten | good | 0.0123 | labels/hedges dropped; facts kept |
| 58 | packages/git-ui/src/graph/rowSvg.ts:219-226 | rewritten | good | 0.0156 | labels/hedges dropped; facts kept |
| 59 | packages/git-ui/src/lib/menuModel.ts:32-37 | unchanged | neutral | 0.0000 | pre-check skip; clean |
| 60 | packages/git-ui/src/state/working.ts:67-70 | unchanged | neutral | 0.0000 | pre-check skip; clean |
| 61 | apps/kira-studio/frontend/src/views/shared/clipboardFormats.ts:124-135 | rewritten | good | 0.0186 | labels/hedges dropped; facts kept |
| 62 | apps/kira-studio/frontend/src/editor/searchPattern.ts:1-7 | rewritten | bad-lost-why | 0.0171 | move history dropped with the shared-semantics fact; `Hoisted here` now dangles |
| 63 | apps/kira-studio/frontend/src/views/grid/fakeData/generate.ts:150-153 | rewritten | good | 0.0157 | labels/hedges dropped; facts kept |
| 64 | apps/kira-studio/frontend/src/project/state/tree.ts:622-630 | kept:width | missed-trivia | 0.0152 | kept:width; inherited 101-col line; P2 R1/P99 tags left |
| 65 | packages/git-ui/src/state/liveAnnouncements.ts:143-147 | rewritten | good | 0.0170 | plan/decision labels dropped; prediction posture kept |
| 66 | apps/kira-studio/frontend/src/views/console/sqlLanguageService.ts:24-27 | rewritten | good | 0.0114 | labels/hedges dropped; facts kept |
| 67 | apps/kira-studio/frontend/src/views/console/sqlHover.ts:142-146 | rewritten | good | 0.0136 | tags and removed-CodeMirror glue note dropped |
| 68 | packages/git-ui/src/lib/refBadges.ts:248-258 | rewritten | good | 0.0204 | tags and earlier-defect history dropped |
| 69 | apps/kira-studio/frontend/src/views/console/format.ts:255-260 | rewritten | good | 0.0129 | labels/hedges dropped; facts kept |
| 70 | packages/git-ipc/src/streamChannel.ts:50-55 | unchanged | neutral | 0.0000 | pre-check skip; clean |
| 71 | packages/workbench/src/editor/monacoLanguages.ts:3-7 | rewritten | good | 0.0105 | labels/hedges dropped; facts kept |
| 72 | packages/shared/caps.ts:32-35 | rewritten | good | 0.0126 | labels/hedges dropped; facts kept |
| 73 | apps/kira-studio/frontend/src/views/shared/slick/scrollTrace.ts:210-214 | kept:width | missed-trivia | 0.0095 | kept:width; inherited 101-col line; P22 tag left |
| 74 | apps/kira-studio/frontend/src/views/browse/state.ts:127-130 | rewritten | good | 0.0122 | labels/hedges dropped; facts kept |
| 75 | apps/kira-studio/frontend/src/views/grid/slick/rowValues.ts:217-222 | rewritten | good | 0.0200 | tags dropped; C11 resolved to `the button` |
| 76 | packages/workbench/src/lib/opLog.ts:20-25 | unchanged | neutral | 0.0000 | pre-check skip; `today's` + line range, borderline |
| 77 | apps/kira-studio/frontend/src/workbench/settings/types.ts:4-14 | kept:width | missed-trivia | 0.0162 | kept:width; inherited over-width line; P103 tag left |
| 78 | apps/kira-space/frontend/src/state/coderepos.ts:36-39 | rewritten | good | 0.0170 | labels/hedges dropped; facts kept |
| 79 | apps/kira-space/frontend/src/state/repoOpenHold.ts:35-42 | unchanged | neutral | 0.0000 | pre-check skip; past tense explains the bug the hook prevents |
| 80 | packages/git-ui/src/lib/stashListModel.ts:1-7 | rewritten | good | 0.0138 | labels/hedges dropped; facts kept |
| 81 | apps/kira-studio/frontend/src/views/console/state.ts:568-572 | rewritten | good | 0.0182 | labels/hedges dropped; facts kept |
| 82 | packages/workbench/src/behaviour/formErrors.ts:17-22 | unchanged | neutral | 0.0000 | pre-check skip; clean |
| 83 | packages/git-core/src/model/operation.ts:43-46 | rewritten | good | 0.0144 | labels/hedges dropped; facts kept |
| 84 | apps/kira-studio/frontend/src/views/grid/sortTerms.ts:1-7 | rewritten | good | 0.0124 | labels/hedges dropped; facts kept |
| 85 | apps/kira-studio/frontend/src/views/shared/page/scan.ts:55-59 | rewritten | good | 0.0142 | labels/hedges dropped; facts kept |
| 86 | packages/shared/domain/uri.ts:53-56 | rewritten | good | 0.0122 | labels/hedges dropped; facts kept |
| 87 | apps/kira-studio/frontend/src/state/schemas.ts:142-146 | rewritten | good | 0.0198 | labels/hedges dropped; facts kept |
| 88 | apps/kira-studio/frontend/src/main.ts:364-367 | rewritten | good | 0.0121 | tags dropped; `moved to` made present |
| 89 | packages/shared/domain/collections.ts:102-107 | rewritten | good | 0.0120 | labels/hedges dropped; facts kept |
| 90 | apps/kira-studio/frontend/proto/grid/TooltipProxy.vue:14-17 | unchanged | neutral | 0.0000 | pre-check skip; clean |
| 91 | apps/kira-studio/frontend/src/views/shared/DateTimePicker.vue:166-169 | unchanged | neutral | 0.0000 | pre-check skip; clean |
| 92 | apps/kira-studio/frontend/src/views/httprequest/QueryParamsTable.vue:31-34 | rewritten | good | 0.0138 | labels/hedges dropped; facts kept |
| 93 | packages/git-ui/src/App.vue:1594-1600 | rewritten | good | 0.0135 | labels/hedges dropped; facts kept |
| 94 | apps/kira-studio/frontend/src/views/grid/DataView.vue:77-81 | rewritten | bad-lost-why | 0.0201 | sibling-view parity reason for the badges dropped as history; second pass kept:grew |
| 95 | packages/git-ui/src/components/review/ReviewCommitRow.vue:235-238 | rewritten | good | 0.0124 | tag dropped; second pass drops anchor history, keeps bridge-request reason (legit) |
| 96 | packages/workbench/src/components/OpLogPanel.vue:25-30 | rewritten | neutral | 0.0186 | hoist history dropped with data-testid parity and `columns` reason (borderline) |
| 97 | apps/kira-studio/frontend/src/editor/MonacoHost.vue:115-122 | rewritten | good | 0.0169 | labels/hedges dropped; facts kept |
| 98 | apps/kira-studio/frontend/src/views/shared/celleditor/TimestampPane.vue:28-33 | rewritten | good | 0.0131 | labels/hedges dropped; facts kept |
| 99 | packages/git-ui/src/components/CommitGrid.vue:152-155 | rewritten | good | 0.0097 | labels/hedges dropped; facts kept |
| 100 | apps/kira-studio/frontend/src/views/grid/SlickGridHost.vue:2423-2429 | rewritten | good | 0.0161 | tags dropped incl. `same as D16 watchers` |
| 101 | apps/kira-studio/frontend/src/views/console/ConsoleSlickGrid.vue:225-228 | unchanged | neutral | 0.0000 | pre-check skip; clean |
| 102 | packages/workbench/src/components/TabStrip.vue:333-339 | kept:form | missed-trivia | 0.0262 | kept:form; P83/P110 tags left |
| 103 | apps/kira-space/frontend/src/views/repo/RepoMultiDiffView.vue:11-26 | rewritten | good | 0.0180 | tag dropped; second pass drops a behaviour sentence as restatesCode (harmless churn) |
| 104 | packages/git-ui/src/components/dialogs/StashDialog.vue:71-74 | rewritten | good | 0.0128 | labels/hedges dropped; facts kept |
| 105 | packages/theme/src/components/AttributeTooltip.vue:121-124 | rewritten | good | 0.0132 | labels/hedges dropped; facts kept |
| 106 | apps/kira-studio/frontend/src/views/shared/fields/FieldRowsTable.vue:52-55 | rewritten | good | 0.0091 | labels/hedges dropped; facts kept |
| 107 | apps/kira-studio/frontend/src/workbench/panels/OperationsPanel.vue:225-230 | rewritten | good | 0.0132 | tag and `actually` dropped; second pass drops dead `.cm-line` provenance (legit, borderline) |
| 108 | apps/kira-studio/frontend/src/views/console/ConsoleResultGrid.vue:76-79 | rewritten | good | 0.0118 | labels/hedges dropped; facts kept |
| 109 | apps/kira-studio/frontend/src/api/VariableSetView.vue:118-126 | rewritten | good | 0.0159 | tags dropped; second pass drops `actually` (legit) |
| 110 | packages/theme/src/components/TooltipAnchorBridge.vue:2-5 | rewritten | good | 0.0112 | labels/hedges dropped; facts kept |
| 111 | apps/kira-studio/frontend/src/views/grid/DataToolbar.vue:54-62 | rewritten | good | 0.0202 | labels/hedges dropped; facts kept |
| 112 | packages/workbench/src/components/TabStripNewButton.vue:6-10 | rewritten | neutral | 0.0128 | hoist history dropped with the two-app usage fact (borderline) |
| 113 | packages/git-ui/src/components/EmptyRepositoryPanel.vue:6-13 | rewritten | good | 0.0164 | labels/hedges dropped; facts kept |
| 114 | packages/git-ui/src/components/FileTree.vue:99-102 | rewritten | good | 0.0151 | tags and deleted-file history dropped; second pass drops `now` (legit) |
| 115 | packages/git-ui/src/components/review/ReviewView.vue:410-415 | rewritten | good | 0.0111 | labels/hedges dropped; facts kept |
| 116 | packages/git-ui/src/components/AppToolbar.vue:287-290 | rewritten | good | 0.0165 | W14 and plan ref dropped; leading `(axe ...)` reads awkwardly |
| 117 | apps/kira-studio/frontend/src/views/console/ExplainResultView.vue:95-98 | unchanged | neutral | 0.0106 | model unchanged; clean |
| 118 | apps/kira-space/frontend/src/repo/RepoFileTree.vue:30-35 | rewritten | good | 0.0136 | labels/hedges dropped; facts kept |
| 119 | apps/kira-studio/frontend/src/views/httprequest/ResponsePane.vue:58-61 | rewritten | good | 0.0121 | labels/hedges dropped; facts kept |
