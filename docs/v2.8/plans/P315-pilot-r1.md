# P315 pilot round 1: judge

Sample: 120 units (50 Go, 40 TS, 30 Vue), seed 316, Sonnet, `check: true` on every call. Judged
from `before-after.md`, `results.jsonl`, `idem.jsonl`, `summary.txt`, rubric
`haiku-exp/sonnet1/judge.md` plus plan amendments (unchanged: neutral or missed-trivia, never bad;
shorter earns nothing). Sources read where a fact needed confirming (#22, #45, #52, #100).

Arms from one run:

- default (check off): verdict on the draft gates 1-6 accepted (`text`, or `draft` when only
  `check` rejected it).
- with-check: verdict on final `text`. A check-kept unit returns the original; it scores
  missed-trivia when the original holds trivia (all 14 do), even where the keep was right.

## Result: FAIL

| metric | bar | default arm | with-check arm |
|---|---|---|---|
| meaning-level bad | <= 3 | 4 (#45, #74, #93, #100) FAIL | 1 (#100) pass |
| missed-trivia | <= 12 | 9 pass | 23 FAIL |
| idempotence rate | >= 95% | 59/88 = 67% FAIL | 70/88 = 79.5% FAIL |
| every idem change good/neutral | all | no: 3 bad among 11 extra changes | yes: 18/18 |
| improved (reported, not gated) | - | 89 | 82 |

Counts, default arm: good 89, neutral 16, missed-trivia 9, bad-lost-why 2, bad-wrong 2,
bad-style 2. With-check arm: good 82, neutral 12, missed-trivia 23, bad-wrong 1, bad-style 2.

Outcomes (summary.txt): rewritten 88, unchanged 12, kept 20 (check 14, tokens 4, width 1, grew 1).
No unusable output, no errors. Final text over 100 cols: #56 (inherited from input, 104), #85
(kept original).

## Meaning-level errors

- #74 bad-wrong: "used to gate only the toolbar button" (fixed bug) became present "gates only":
  claims the menu Delete item is enabled now. Check caught it.
- #100 bad-wrong: "The old grid template stayed four rows" became current "Spacing keeps four
  rows". Current shell is flex; `mt-1` reproduces old spacing. Check passed it (false pass).
- #45 bad-lost-why: "ApplyBulk phase 2" dropped as a tag; it is the function's own Phase 2
  (`variables.go:767`). "rules 1/3" left with no referent. Check caught it.
- #93 bad-lost-why: equivalence claim "provably unchanged for every name short enough to matter"
  dropped as history. Check caught it.

Two causes cover all 4: (a) history rule "keep the current fact" makes the model move past-tense
bug or old-design narration into present tense, inverting it (#74, #100); (b) a real name or
number of a code part read as a plan tag or narration (#45 "phase 2", #93 equivalence; idem #17
"stage 2", #34 "step 1").

## Gates

- tokens: 4/4 main rejections false (#3, #20, #86, #108), 1/1 idem (#119). Causes: path regex
  joins tag and identifier (`D4/porcelain.LeftRightCountArgs`, `dbmcp.ApprovalBroker/gitcred.Relay`)
  so dropping the tag kills the whole token; double-quote regex pairs quotes across spans
  (`" into "`, a span running through backticks); reflow splits `Escape/outside-click` across a
  line break. Each false reject left a tagged original: 4 of 9 default-arm missed-trivia.
- width: 1 rejection (#84), correct (draft 102 cols); cost one missed-trivia.
- grew: #85 main and #56 idem both blocked a good reflow of an over-width input (known cost).
- form, indent, directive: no rejections, no misses found. Gap: #102 output adds a trailing
  newline the input lacks; no gate checks it.

## Check arm

Main: 102 check calls, 14 rejections: 3 true catches (#45, #74, #93), 11 false alarms (#6, #26,
#42, #52, #64, #71, #78, #82, #96, #107, #112). 1 false pass (#100). Precision 3/14 = 21%.
Idem: 11 rejections: 3 true (#17, #77, #98), 8 false. Combined precision 6/25 = 24%.

False alarms flag dropped intensifiers ("purely", "always", "today", "silently", "correctly"),
tag-labeled framing (#6 "P8 D2's rule"), extraction/motivation history (#52, #78, #107), and a
`restatesCode` drop (#112). The check prompt allows tags, history and restated code but not
filler, so every filler drop reads as "lost". It never flags a tense shift as wrong (#100).

Cost: rewrite-only units average 0.0126 (idem, n 59) to 0.0162 (main, n 18) USD; units with a
check call 0.0251 (main, n 102). Check adds about 0.010 USD per unit (+65%). Main arm 0.0238 per
unit with check against an estimated 0.014 to 0.016 without.

Check on or off: neither arm passes. Check on buys 3 caught errors in 120 for 11 lost cleanups
(missed-trivia 9 to 23) and about +0.010 USD per unit, and still misses #100. Keep the default off
(plan default; UI has a human reader). All 4 default-arm errors share the two prompt causes above,
fixable in the rewrite prompt. Re-measure both arms in round 2 with the check prompt fixed; P319
picks `check` from round 2 numbers, not these.

## Idempotence

88 rewritten units fed back. Unchanged 57, changed 18, kept 13 (check 11, grew 1, tokens 1).
Implementer rate 70/88 = 79.5% counts check-kept as unchanged; with check off those 11 drafts
land, so the default-arm rate is 59/88 = 67%.

All 18 accepted changes judged good (1, #116 drops a leftover tag) or neutral (17). Of the 11
check-rejected second drafts, 3 are meaning-level bad (#17 drops real "stage 2", #77 hardens
"no trace has ever seen" to "no trace can see", #98 drops the "by user request" why); default arm
would ship them.

What keeps changing: 31 second drafts. 20 drop filler (33 spans): "own" (x7 in #21, #43, #36),
"already", "just", "deliberately", "genuinely", "exactly", "currently", "get to", "recorded",
"semantically", "there is". 9 drop "history" that is real content or framing ("rebuilt", "the
existing", "by user request", node:sqlite contrast). 4 "tag" (2 real: "step 1", "stage 2"; 2
real leftovers: G24, "the plan's own"). 3 "restatesCode". About 8 also restyle kept text: dash to
colon, sentence split, clause reorder, reflow.

Prompt cause:

- Drop list's filler entry is open-ended ("Filler, hedges (...), pleasantries, and articles where
  meaning stays clear"). Pass 1 spends its edits on tags and narration and leaves most filler; pass
  2, with no tags left, applies the open rule to whatever remains. Nothing marks a stopping point.
- Form's "Terse: fragments fine, active voice, present tense, short word over long phrase" is a
  style mandate, not a drop rule. It licenses rewording kept text on every pass, and its "present
  tense" feeds the #74/#100 tense flips.
- "Already clean" is defined against that subjective Drop list, so it is never reliably met.
- "own" is a house idiom (repo-wide "X's own"); the model drops it in some passes, keeps it in
  others.

## Round 2 fixes

Rewrite prompt (`memory.rewrite.system`):

1. Replace the filler line with a closed list: "really", "basically", "actually", "simply", and
   "just" only as a hedge. Keep every other word, intensifiers and intent words included
   ("own", "already", "deliberately", "exactly", "purely", "currently"). "just" meaning "only" or
   "recently" stays. Drop "articles".
2. Delete the "Terse: ... present tense ..." line. Add: "Words you keep stay as written: no
   rewording, no sentence split or merge, no punctuation change. Reflow only lines a drop touched,
   or lines over the width."
3. History: "Narration of a removed bug or an old design (used to, was, stayed, the old X) is not
   a current fact. Drop it whole or keep it in past tense; never restate it in present tense."
4. Tags: "A name or number for a part of this code or this text (phase 2, step 1, stage 2, rule
   1/3, level 2) is not a tag. A path to a plan doc (`docs/plans/P9.md`) and a leftover reference
   to a dropped tag ("the plan's own", "every G24 surface") are tags."
5. "An equivalence or guarantee (provably unchanged, byte-identical, same as X) is a fact, not
   history."
6. Clean definition: "Clean means no tag, no history narration, no restated code, no word from
   the filler list, every line within width. Style is never a reason to change text."

Check prompt (`memory.rewrite.check.system`): allow the filler list and intensifier drops and
extraction or motivation history. Flag as "wrong" any past-tense narration restated in present
tense.

Gates (accept or reject only):

- tokens: match against input and draft with comment markers and line breaks joined; split path
  tokens on `/` and require each component, not the joined string; take double-quoted spans only
  outside backtick spans.
- form: reject when draft and input differ in trailing newline (#102).
- grew: consider an allowance of (added lines x (indent + marker + 1)) runes when the input's
  widest line is over 100 and the draft's is at most 100 (#85, #56).

Round 2 sample also needs fresh units, as the plan says; these 120 now count as tuned against.

## Per unit (main arm)

Columns: outcome, default-arm verdict, with-check verdict, cost USD (both calls).

| id | file:line | outcome | default | with-check | USD | reason |
|---|---|---|---|---|---|---|
| 0 | apps/kira-studio/internal/enginecache/cache.go:28 | rewritten | good | good | 0.0238 | §4.7 note tag dropped; since-link kept |
| 1 | apps/kira-space/internal/gitsession/ops.go:1363 | unchanged | missed-trivia | missed-trivia | 0.0159 | unchanged; `§7.12's` spec attribution left on quoted rationale |
| 2 | apps/kira-studio/internal/bridge/events.go:66 | rewritten | good | good | 0.0339 | P87/P116/P127 tags and hoist history dropped; Emit/EmitTo why, appevent location kept |
| 3 | apps/kira-space/internal/gitpreflight/stack.go:324 | kept:tokens | missed-trivia | missed-trivia | 0.0139 | kept:tokens false reject (regex joined `D4/porcelain.X`); draft good; original keeps D3/D4 |
| 4 | apps/kira-studio/internal/ipcfixture/harness.go:190 | unchanged | neutral | neutral | 0.0116 | unchanged; nothing to drop |
| 5 | apps/kira-studio/internal/adapters/clickhouse/errors.go:49 | rewritten | good | good | 0.0228 | B12, P36 D26 dropped; dispatch-on-code rule kept |
| 6 | apps/kira-studio/internal/bridge/grpc.go:320 | kept:check | good | missed-trivia | 0.0362 | draft: P8 D2, P21, D11, D8 dropped; all facts kept. Check false alarm (shared-rule label) |
| 7 | apps/kira-studio/internal/dbmcp/tools.go:362 | rewritten | good | good | 0.0219 | M7 finding dropped |
| 8 | apps/kira-studio/internal/adapters/sqlite/query.go:126 | rewritten | good | good | 0.0264 | F9/D9/SQ-1/§8.14 dropped; driver contrast and why kept |
| 9 | apps/kira-space/internal/gitclient/logsession/session.go:215 | rewritten | good | good | 0.0239 | F3, "now" dropped |
| 10 | internal/toolexec/exec.go:95 | rewritten | good | good | 0.0298 | G30/G31 finding tags dropped; past bug narration moved to hypothetical present, correct |
| 11 | apps/kira-studio/internal/adapters/redis/console.go:168 | rewritten | good | good | 0.0221 | P9 D11 dropped |
| 12 | apps/kira-space/internal/gitclient/porcelain/records.go:32 | rewritten | good | good | 0.0231 | F3 dropped |
| 13 | apps/kira-space/internal/bridge/codeworkspace.go:21 | rewritten | good | good | 0.0243 | C5 §3.3, §11 label dropped; read-only guarantee stated directly |
| 14 | apps/kira-studio/internal/adapters/sqltext.go:414 | rewritten | good | good | 0.0220 | P113 G1, F2 dropped |
| 15 | apps/kira-studio/internal/adapters/testsupport/prewarm.go:5 | unchanged | neutral | neutral | 0.0130 | unchanged; nothing to drop |
| 16 | apps/kira-studio/internal/storage/model/cursor.go:8 | unchanged | neutral | neutral | 0.0128 | unchanged; nothing to drop |
| 17 | apps/kira-studio/internal/apivars/resolve.go:449 | rewritten | good | good | 0.0339 | 9 tags and reimplementation history dropped; stage 1/2, masking why kept |
| 18 | apps/kira-space/internal/gitsession/walk.go:69 | rewritten | good | good | 0.0186 | F8/P108 tag dropped |
| 19 | internal/metrics/responsible_nocgo_darwin.go:5 | rewritten | good | good | 0.0210 | P7 plan refs dropped; cgo/vet why kept |
| 20 | internal/notify/ordered.go:20 | kept:tokens | missed-trivia | missed-trivia | 0.0354 | kept:tokens false reject (`dbmcp.ApprovalBroker/gitcred.Relay` split into two tokens); draft good |
| 21 | apps/kira-space/internal/gitrpc/gh.go:11 | rewritten | good | good | 0.0280 | D9/D1 dropped; quoted rule kept |
| 22 | apps/kira-studio/internal/adapters/testsupport/images.go:21 | rewritten | good | good | 0.0182 | dead pointer `docs/HISTORY.md (v1.1 P16)` dropped; HISTORY has no parsing rule |
| 23 | apps/kira-space/internal/gitops/conflict.go:132 | unchanged | neutral | neutral | 0.0127 | unchanged; nothing to drop |
| 24 | apps/kira-space/internal/gitclient/porcelain/worktree.go:9 | rewritten | good | good | 0.0243 | probe P2/P3, D1 dropped; git 2.36/2.38 and error string kept |
| 25 | internal/sqlitex/reindex.go:8 | rewritten | good | good | 0.0192 | dedup history + P107 tag dropped; contract kept |
| 26 | internal/metrics/ticker.go:11 | kept:check | neutral | missed-trivia | 0.0273 | draft: "no Node child needle any more" dropped, implied by kept in-process clause. Check false alarm (borderline) |
| 27 | apps/kira-space/internal/gitreview/db.go:69 | rewritten | good | good | 0.0181 | "simply" only |
| 28 | apps/kira-space/internal/gitclient/discovery.go:58 | rewritten | good | good | 0.0259 | D3 dropped |
| 29 | apps/kira-studio/internal/storage/repos/history.go:206 | rewritten | good | good | 0.0256 | P107 tag, "always did" dropped |
| 30 | apps/kira-studio/internal/dbmcp/render.go:183 | rewritten | good | good | 0.0183 | M7 tag, "before this field existed" dropped |
| 31 | apps/kira-studio/internal/mask/mask.go:227 | rewritten | good | good | 0.0298 | filler dropped; cause link kept as "So" |
| 32 | apps/kira-studio/internal/adapters/s3/read.go:152 | rewritten | good | good | 0.0184 | P58d D12 dropped |
| 33 | internal/memory/applydoc.go:40 | unchanged | neutral | neutral | 0.0110 | unchanged; nothing to drop |
| 34 | apps/kira-space/internal/gitops/fetch.go:17 | rewritten | good | good | 0.0145 | D12/D18, F14 dropped |
| 35 | apps/kira-studio/internal/grpcclient/call.go:28 | unchanged | neutral | neutral | 0.0150 | unchanged; nothing to drop |
| 36 | apps/kira-studio/internal/adapters/kafka/errors.go:13 | rewritten | good | good | 0.0188 | P58e E4 dropped |
| 37 | apps/kira-space/internal/ade/reviewstep.go:21 | rewritten | good | good | 0.0164 | P286 dropped |
| 38 | apps/kira-space/internal/gitclient/watcher.go:153 | rewritten | good | good | 0.0189 | F9, D7 dropped |
| 39 | apps/kira-space/internal/appshell/menu.go:16 | rewritten | good | good | 0.0302 | P116/P103 growth history dropped; current menu contents kept |
| 40 | apps/kira-space/internal/gitsession/stack.go:383 | rewritten | good | good | 0.0173 | D10, D2 dropped |
| 41 | apps/kira-studio/internal/datagrip/errors.go:10 | rewritten | good | good | 0.0215 | D11, D12 dropped |
| 42 | internal/appstorage/tabs.go:107 | kept:check | good | missed-trivia | 0.0277 | draft: tags + "purely" dropped. Check false alarm |
| 43 | apps/kira-space/internal/gitsession/stash.go:183 | rewritten | good | good | 0.0266 | D3/F9, G28 D12 dropped |
| 44 | internal/metrics/probe_other.go:5 | rewritten | good | good | 0.0171 | D5, D3 dropped |
| 45 | apps/kira-studio/internal/storage/repos/variables.go:832 | kept:check | bad-lost-why | missed-trivia | 0.0296 | draft drops "phase 2" as a tag; it is ApplyBulk's own Phase 2 (code `:767`); "rules 1/3" left dangling. Check true catch |
| 46 | apps/kira-studio/internal/connections/service.go:47 | rewritten | good | good | 0.0184 | P28 §5.5 dropped |
| 47 | apps/kira-studio/internal/storage/repos/windows.go:68 | rewritten | good | good | 0.0329 | D2, C4, C7 dropped; race why kept |
| 48 | apps/kira-studio/internal/adapters/errors.go:510 | rewritten | good | good | 0.0376 | P2 R2 dropped |
| 49 | apps/kira-space/internal/gitpreflight/worktree.go:176 | rewritten | good | good | 0.0316 | D8, probe M5, phase principle dropped; fail-safe rule kept |
| 50 | apps/kira-studio/frontend/src/api/state/variableCompletion.ts:84 | rewritten | good | good | 0.0334 | "remaining" history + filler dropped |
| 51 | packages/git-ui/src/state/graphView.ts:524 | rewritten | good | good | 0.0291 | W15 dropped |
| 52 | packages/shared/protocol/page.ts:55 | kept:check | good | missed-trivia | 0.0191 | draft: P48 F23, dedup history, `pageSize` restatement dropped. Check false alarm |
| 53 | packages/git-ui/src/state/ops.ts:1136 | rewritten | good | good | 0.0212 | G25 dropped; banner kept |
| 54 | packages/shared/domain/sqlLex.ts:137 | rewritten | good | good | 0.0166 | F4 dropped |
| 55 | apps/kira-studio/frontend/src/views/console/planModel.ts:3 | rewritten | good | good | 0.0253 | P18 D16, F14 dropped; SQLite-format why restated as cause |
| 56 | packages/workbench/src/editor/monacoTheme.ts:40 | rewritten | bad-style | bad-style | 0.0277 | D6/P67c dropped; content good; keeps input's 104-col lines (width gate tolerates inherited width) |
| 57 | apps/kira-studio/frontend/src/views/grid/focusRequest.ts:1 | rewritten | good | good | 0.0243 | P67 §5.2 dropped |
| 58 | packages/workbench/src/testing/ui/mockRuntime.ts:125 | unchanged | neutral | neutral | 0.0135 | unchanged; nothing to drop |
| 59 | packages/workbench/src/editor/monaco.ts:87 | unchanged | neutral | neutral | 0.0118 | unchanged; nothing to drop |
| 60 | apps/kira-studio/frontend/src/state/viewCommands.ts:76 | unchanged | neutral | neutral | 0.0122 | unchanged; "prior" call-site ref borderline, kept as cross-reference |
| 61 | apps/kira-studio/frontend/src/views/shared/slick/kiraSlickGrid.ts:79 | rewritten | good | good | 0.0294 | P22 step tags dropped; Pure/testable why kept |
| 62 | packages/git-core/src/model/reviewRanges.ts:58 | rewritten | good | good | 0.0394 | G31 tag + perf history dropped; current skip-normalize why kept |
| 63 | packages/api-core/src/http/dynamic/catalog.ts:93 | rewritten | good | good | 0.0245 | P17 D12, F5, P6 D9 dropped |
| 64 | packages/git-ui/src/state/search.ts:110 | kept:check | neutral | missed-trivia | 0.0299 | draft: tag, "silently", "(correctly)" dropped; minor emphasis loss. Check false alarm |
| 65 | packages/git-ui/src/lib/columns.ts:266 | unchanged | neutral | neutral | 0.0155 | unchanged; nothing to drop |
| 66 | apps/kira-space/frontend/src/views/repo/blameLine.ts:105 | rewritten | good | good | 0.0265 | §4.2, P69 review, "moved to" dropped; layering why kept |
| 67 | apps/kira-studio/frontend/src/views/stream/state.ts:33 | rewritten | good | good | 0.0239 | D10/D12 dropped |
| 68 | packages/theme/src/lib/utils.ts:4 | rewritten | good | good | 0.0155 | P110 B1 dropped |
| 69 | packages/git-ui/src/lib/stackListModel.ts:65 | rewritten | good | good | 0.0226 | D3 dropped |
| 70 | apps/kira-studio/frontend/src/api/state/curl.ts:268 | rewritten | good | good | 0.0178 | D10 step tags, "simply" dropped |
| 71 | apps/kira-studio/frontend/src/state/schemas.ts:170 | kept:check | good | missed-trivia | 0.0346 | draft: F1, P12 finding, "always ran" to present. Check false alarm |
| 72 | apps/kira-studio/frontend/src/theme/icons.ts:97 | rewritten | good | good | 0.0431 | "second reported gap" history dropped |
| 73 | packages/git-ui/src/graph/layoutStore.ts:251 | rewritten | good | good | 0.0350 | G21 D3 dropped |
| 74 | apps/kira-studio/frontend/src/views/documents/menu.ts:64 | kept:check | bad-wrong | missed-trivia | 0.0186 | draft turns fixed bug "used to gate only the toolbar button" into present "gates only": claims menu Delete is always enabled now. Check true catch |
| 75 | apps/kira-studio/frontend/src/bridge/port.ts:27 | rewritten | good | good | 0.0243 | P52/P56 dropped |
| 76 | packages/git-ui/src/lib/fileTreeModel.ts:123 | unchanged | neutral | neutral | 0.0114 | unchanged; nothing to drop |
| 77 | apps/kira-studio/frontend/src/views/shared/slick/scrollTrace.ts:85 | rewritten | good | good | 0.0325 | P22 iter2-onset tags dropped |
| 78 | apps/kira-studio/frontend/src/views/shared/celleditor/generate.ts:35 | kept:check | neutral | missed-trivia | 0.0190 | draft drops ULID popularity aside and byte-identical-to-old-toCrockford history; pad fact kept. Check false alarm (borderline) |
| 79 | packages/shared/domain/http.ts:5 | rewritten | good | good | 0.0227 | P2 D5 dropped |
| 80 | apps/kira-studio/frontend/src/api/state/variables.ts:671 | rewritten | good | good | 0.0244 | P12 D13, R10, hand-copy history dropped; onError why kept |
| 81 | apps/kira-studio/frontend/src/state/tabKinds.ts:245 | rewritten | good | good | 0.0315 | D2, P3 F10, P4 D14, F13 dropped |
| 82 | packages/workbench/src/bridge/createCoreControl.ts:147 | kept:check | good | missed-trivia | 0.0363 | draft: tags, "today", filler dropped. Check false alarm |
| 83 | apps/kira-studio/frontend/src/views/shared/sqlIdent.ts:72 | rewritten | good | good | 0.0342 | F10/P21, "used to run" history dropped; MySQL failure why kept |
| 84 | apps/kira-space/frontend/src/repo/git/hostHandlers.ts:320 | kept:width | missed-trivia | missed-trivia | 0.0161 | kept:width correct (draft line 102 cols); original keeps C11/C7/P92 tags |
| 85 | packages/workbench/src/state/queryClient.ts:3 | kept:grew | neutral | neutral | 0.0196 | kept:grew; nothing to drop; reflow of 101-col line blocked (known grew cost) |
| 86 | packages/git-ui/src/bridge/client.ts:16 | kept:tokens | missed-trivia | missed-trivia | 0.0186 | kept:tokens false reject (quote regex paired across spans: `" into "`); draft good |
| 87 | packages/git-core/src/preflight/tag.ts:10 | rewritten | good | good | 0.0230 | probe P3 dropped |
| 88 | packages/shared/domain/sqlSplit.ts:68 | rewritten | good | good | 0.0188 | P108 Part 11 F3 dropped |
| 89 | packages/api-core/src/http/curl/flags.ts:168 | rewritten | good | good | 0.0213 | D6 dropped; quoted rules kept |
| 90 | apps/kira-studio/frontend/src/workbench/DbMcpApprovalDialog.vue:74 | rewritten | good | good | 0.0176 | P108 Part 12 F2 dropped |
| 91 | apps/kira-studio/frontend/src/api/DynamicValuesDialog.vue:27 | rewritten | good | good | 0.0237 | P6 D11 dropped |
| 92 | packages/git-ui/src/components/review/ReviewView.vue:317 | rewritten | good | good | 0.0200 | D16 dropped |
| 93 | apps/kira-studio/frontend/src/views/console/ConsoleSlickGrid.vue:207 | kept:check | bad-lost-why | missed-trivia | 0.0254 | draft drops "provably unchanged for every name short enough to matter" (equivalence claim, mislabeled history). Check true catch |
| 94 | apps/kira-studio/frontend/src/views/grid/SlickGridHost.vue:2604 | rewritten | good | good | 0.0273 | D2(c)/D3 dropped |
| 95 | packages/git-ui/src/components/CommitGrid.vue:450 | rewritten | good | good | 0.0213 | P93 §4.2 dropped |
| 96 | apps/kira-studio/frontend/src/api/VariablesOverviewPanel.vue:24 | kept:check | neutral | missed-trivia | 0.0342 | draft: tags dropped; P14-findings clause reduced to "would grow the surface count" (weaker). Check false alarm |
| 97 | apps/kira-studio/frontend/src/editor/MonacoHost.vue:132 | rewritten | good | good | 0.0280 | §4.7/OQ-1 dropped |
| 98 | apps/kira-studio/frontend/src/api/CollectionsPanel.vue:191 | rewritten | good | good | 0.0239 | P28/P22b tags + removal history dropped; user-request why and route kept |
| 99 | apps/kira-studio/frontend/src/views/console/ConsoleResultGrid.vue:107 | rewritten | good | good | 0.0167 | P104 §3.4 dropped |
| 100 | packages/workbench/src/components/WorkbenchShell.vue:127 | rewritten | bad-wrong | bad-wrong | 0.0183 | "The old grid template stayed four rows" rewritten as current "Spacing keeps four rows"; current shell is flex, mt-1 reproduces old spacing. Check false pass |
| 101 | packages/git-ui/src/App.vue:155 | rewritten | missed-trivia | missed-trivia | 0.0250 | W10/W14 dropped but dead path `docs/plans/P11.md` kept |
| 102 | apps/kira-studio/frontend/src/workbench/settings/DatabaseMcpPane.vue:136 | rewritten | bad-style | bad-style | 0.0193 | F9/F8 + history dropped, content good; output adds trailing newline (blank line on splice); no gate checks it |
| 103 | apps/kira-studio/frontend/src/views/httprequest/ResponseDiffDialog.vue:150 | rewritten | good | good | 0.0215 | D12, P60a dropped |
| 104 | packages/git-ui/src/components/review/ReviewCommitRow.vue:137 | rewritten | good | good | 0.0257 | P108 F10 dropped |
| 105 | apps/kira-studio/frontend/src/views/grid/ColumnsMenu.vue:113 | rewritten | good | good | 0.0199 | history aside + filler dropped |
| 106 | apps/kira-studio/frontend/src/views/shared/fields/FieldRowsTable.vue:21 | rewritten | good | good | 0.0313 | tags + merged-files history dropped |
| 107 | apps/kira-studio/frontend/src/views/httprequest/RequestBodyPane.vue:35 | kept:check | good | missed-trivia | 0.0268 | draft: tags + extraction history dropped. Check false alarm |
| 108 | packages/git-ui/src/components/dialogs/CheckoutDialog.vue:2 | kept:tokens | missed-trivia | missed-trivia | 0.0310 | kept:tokens false reject (quote regex spans; `Escape/outside` split by reflow); draft good |
| 109 | apps/kira-studio/frontend/src/views/grid/FilterToolbar.vue:122 | rewritten | good | good | 0.0178 | filler dropped |
| 110 | packages/git-ui/src/components/dialogs/PreflightPrediction.vue:2 | rewritten | good | good | 0.0186 | P113 F9, P131 + move history dropped |
| 111 | apps/kira-studio/frontend/src/workbench/WorkbenchShell.vue:14 | rewritten | good | good | 0.0311 | P103/P128 tags + move history dropped |
| 112 | packages/git-ui/src/components/StackList.vue:2 | kept:check | good | missed-trivia | 0.0374 | draft: tags + `stack`-prop history dropped. Check false alarm |
| 113 | apps/kira-studio/frontend/src/project/SchemaDialog.vue:58 | rewritten | good | good | 0.0307 | P12 finding dropped; 128-col input line reflowed |
| 114 | packages/git-ui/src/components/dialogs/PullDialog.vue:2 | rewritten | missed-trivia | missed-trivia | 0.0285 | OQ10/W10, P131 dropped but dead path `docs/plans/P9.md` kept |
| 115 | packages/git-ui/src/components/BranchPicker.vue:349 | rewritten | good | good | 0.0213 | P77 §7.2 dropped |
| 116 | packages/git-ui/src/components/CommitMeta.vue:283 | rewritten | missed-trivia | missed-trivia | 0.0173 | P74 §4.3 dropped; "G24 surface" tag kept |
| 117 | packages/workbench/src/prompt/TextPromptDialog.vue:12 | rewritten | good | good | 0.0415 | P107 T2-19, P104 dropped; portal constraint kept |
| 118 | packages/workbench/src/components/TabStrip.vue:210 | rewritten | good | good | 0.0225 | P72 §7, §6.1 dropped |
| 119 | apps/kira-space/frontend/src/workbench/SettingsDialog.vue:19 | rewritten | good | good | 0.0289 | P100/P103 tags + extraction history dropped |

## Idempotence (second pass vs first rewrite)

| id | second pass | verdict | check | reason |
|---|---|---|---|---|
| 14 | changed | neutral | ok | "each hand-rolled this identically apart from" to "differ only in"; dedup fact still implied |
| 21 | changed | neutral | ok | drops "own" twice |
| 29 | changed | neutral | ok | drops "and", "stated", "own"; "the doc's" keeps source |
| 32 | changed | neutral | ok | drops "recorded"; dash to colon, reflow |
| 34 | changed | neutral | ok | "step 1" (pull's first step, real) labeled tag, "fetch" substituted; minor |
| 36 | changed | neutral | ok | "is X's mapError, ported" to "ports X's mapError"; sentence split |
| 40 | changed | neutral | ok | drops "already" |
| 43 | changed | neutral | ok | drops "own" x4, "already", "exact", "at all" |
| 46 | changed | neutral | ok | drops "currently" |
| 49 | changed | neutral | ok | drops "get to" |
| 63 | changed | neutral | ok | "This is not a new vocabulary invented for this app" to "Not a new vocabulary"; reflow |
| 70 | changed | neutral | ok | drops "the existing" x3 (reuse emphasis) |
| 73 | changed | neutral | ok | drops temporal "just" x2 (resolved in this chunk); context still says so |
| 97 | changed | neutral | ok | drops "genuinely", "plain", "to speak of", "entirely"; reflow |
| 99 | changed | neutral | ok | drops "rebuilt" |
| 105 | changed | neutral | ok | clause reorder only |
| 114 | changed | neutral | ok | "there is", "just" dropped; dead `docs/plans/P9.md` still kept |
| 116 | changed | good | ok | drops leftover "G24" tag (first-pass miss) |
| 8 | kept:check | neutral | false alarm | drops node:sqlite contrast (history); why stays |
| 17 | kept:check | bad-lost-why | true catch | drops "stage 2" (real, stage 1 still named) and Resolver location |
| 28 | kept:check | neutral | false alarm | drops "deliberately" |
| 61 | kept:check | neutral | false alarm | drops "Pure function" as restatesCode; minor |
| 72 | kept:check | neutral | false alarm | drops "deliberately", "real", "outright" |
| 77 | kept:check | bad-wrong | true catch | "no trace in this investigation's history has ever been able to see" to "no trace can see" (stronger claim) |
| 81 | kept:check | neutral | false alarm | drops "binaryFile is copied as a fresh object" as restatesCode |
| 98 | kept:check | bad-lost-why | true catch | drops "by user request (...)" why as history |
| 103 | kept:check | neutral | false alarm | drops "semantically", "exactly" |
| 115 | kept:check | neutral | false alarm | drops "just" (= only); minor |
| 117 | kept:check | neutral | false alarm | drops "(real requirement)"; minor |
| 56 | kept:grew | good draft | - | reflow of inherited 104-col lines to 100; grew gate blocked a good fix |
| 119 | kept:tokens | good draft | - | drops leftover "the plan's own"; false reject (quoted `"small rewrite"` lost its quotes) |

Cost: main 2.8534 USD (0.0238/unit), idem 1.5218 (0.0173/unit), round 4.3752. Judge outside cap.
