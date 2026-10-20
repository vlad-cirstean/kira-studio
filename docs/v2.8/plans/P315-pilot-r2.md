# P315 pilot round 2: judge

Sample: 120 fresh units (50 Go, 40 TS, 30 Vue), seed 317, Sonnet. Default arm (`check` off) and
a separate check-on run with its own drafts. Rubric as round 1 (`haiku-exp/sonnet1/judge.md` plus
plan amendments: unchanged is neutral or missed-trivia, never bad; shorter earns nothing; width
over 100 on a rewrite is bad-style, inherited or not, as round 1 #56). Sources read for #23, #61,
#85, #112.

## Result

| metric | bar | default arm | check-on arm |
|---|---|---|---|
| meaning-level bad | <= 3 | 2 (#61, #112) pass | 1 (#19) pass |
| missed-trivia | <= 12 | 3 pass | about 13 FAIL |
| idempotence rate | >= 95% | 84/103 = 81.6% FAIL | not run |
| every idem change good/neutral | all | no: 10 of 19 harmful FAIL | - |
| improved (reported) | - | 96 | about 90 |

Default arm counts: good 96, neutral 17, missed-trivia 3, bad-wrong 1, bad-lost-why 1,
bad-style 2. Literal plan bars: FAIL (idempotence only). Recommended bars below: FAIL.

Round 1 vs round 2, default arm: meaning-level bad 4 to 2, missed-trivia 9 to 3, improved 89 to
96, idempotence 67% to 81.6%. Harmful re-pass changes rose: round 1 had 3 bad among 29 default-arm
second-pass changes; round 2 has 10 among 19.

## First pass, default arm

- #61 bad-wrong: "empty at P8" cut to "empty". `PullRoute` is `'stashAndCarry'` now, and the next
  clause says `buildPullPreflight` offers it. Dropping a tag left a false present claim.
- #112 bad-lost-why: history drop removed `commitPending`'s rejection kinds and "telling the user
  why". The try/catch below is left unexplained.
- #31, #74 bad-style: an untouched input line of 101 cols kept. Width gate tolerates inherited
  width. Check-arm run reflowed #74, so the model can.
- missed-trivia: #60 kept:tokens (right reject: draft lost backticks on `App.vue` and one real
  fact), #81 kept:tokens (false reject: only `§5.3's first decision:` dropped; quoted span holding
  backticks), #110 (`section 1.2's own` plan ref left).
- Neutral but worth noting: #23 (dropped `loaders is registry.ts's successor`; registry.ts is
  gone, but the Go doc comment loses its subject), #17 (`just` meaning "merely" dropped), #85
  (doomed-call why thinner, judged acceptable).
- Unchanged 15: all neutral. #10 and #117 claim "every line fits" with a 101-col line.
- Gates: tokens 2 rejections (1 right, 1 false). No other gate fired in the default arm. Check-arm
  run: form 1 (#42, trailing newline, right).

## Check-on arm

104 check calls, 9 rejections. True catch 5: #112 (same draft as default), #61 (right outcome,
wrong reason: flagged the plan ref, not the false "empty"), #53, #95, #98 (the check arm's own
drafts dropped a why the default drafts kept). False alarm 4: #23, #60, #69 (plan or spec
cross-refs), #85 (borderline). Precision 5/9 = 56% (round 1: 21%). False pass: #19 (own draft
removed the spawned `rev-list` processes, so "this situation" has no referent).

Arm outcome: meaning-level bad 1 (#19); missed-trivia about 13 (9 check keeps, #42 form, #81
tokens, #110, #83 kept move narration). Cost 0.0205 against 0.0162 USD per unit (+0.0043, +27%).

Keep `check` off. The default arm already passes the meaning bar. Check trades 2 caught default
errors for 4 lost cleanups, 1 false pass, a missed-trivia fail and +27% cost.

## Idempotence

103 rewritten units fed back: unchanged 84, changed 19, kept 0.

| id | class | what the second pass did |
|---|---|---|
| 4 | b | drops `actually` (closed list) |
| 20 | b | drops `actually` |
| 26 | b | drops `actually` |
| 31 | b | reflows the 101-col line; fixes first-pass bad-style |
| 74 | b | reflows the 101-col line; fixes first-pass bad-style |
| 42 | b | drops dangling "are unchanged"; "path-byte rule applies" |
| 29 | b (borderline) | drops "the actual vulnerability this replaces"; expansion hazard still stated |
| 48 | b (borderline) | drops `CONTRACT_VERSION 15 -> 16` changelog line |
| 50 | b (borderline) | drops "Trimming to 90% left it at 9,000"; test-asserts-exact-count why kept |
| 5 | a | drops "verified independently for modernc.org/sqlite", a verification fact |
| 35 | a | drops "inert, a no-op, on a DB opened before" as restatesCode; real fact |
| 53 | a | drops SQL_INT_RANGES cause chain; why strip on signed ints gone |
| 54 | a | drops "taking page/column order/tabId as plain parameters"; first clause loses its verb |
| 56 | a | drops the rejected "prefer whatever's cached" alternative and why it failed |
| 83 | a | drops "source-file split, not a binding-surface change"; "unchanged" claims dangle |
| 95 | a | drops why the listener lives in App.vue (search row conditionally mounted) |
| 113 | a | drops "exactly as safe as the copy was" and "instead of O(matches)" |
| 105 | a (minor) | drops where `.blame` rules now live; comment loses its subject |
| 110 | a (minor) | drops leftover plan ref together with "var-based z-index allowlist entry" |

a harmful 10, b convergence 9, c cosmetic churn 0.

Cause of every a: the first pass keeps a rationale in past tense ("returned", "made", "was
missing", "moved up from"), as round 2's history rule allows. The second pass reads past tense as
history and drops it whole, as the same rule also allows. Round 2's "drop it whole or keep it in
past tense" gives no stable answer, so each pass can flip it. 9 of 10 drops are labeled history;
#35 restatesCode, #110 tag.

## Is 95% the right metric?

No. The rate counts convergence (b) and damage (a) the same. Here 9 of 19 changes are fine: three
closed-list `actually` and two width reflows fix real first-pass misses. A model that ignores those
would score better while being worse. The user's concern is damage, so gate damage directly.

Recommended bars, idempotence arm:

- harmful re-pass changes (a): 0. A re-pass must not break an already cleaned comment.
- cosmetic churn (c): at most 5% of units fed back. Round 1 saw about 8 restyles in 88 (9%) before
  the "words you keep stay as written" rule; round 2 has 0, so 5% is reachable and still flags a
  regression to rewording.
- convergence (b): reported, not gated. It is first-pass misses getting fixed.

Under these bars round 2 FAILS: a = 10. Under the literal bars it also FAILS: 81.6% < 95%, and 10
idempotence changes are not good or neutral.

Simulation on round-2 data: a deterministic pre-check that skips the model when the input has no
tag-shaped token (`[A-Z]{1,2}\d+`, `§`, `docs/plans/`, `round N`, `finding`), no closed-list
filler word and no line over 100 would skip 91 of 103 re-pass inputs. It removes 13 of 19 changes,
9 of the 10 harmful ones (only #56 still reaches the model, via "actually"), and keeps all 5 clean
b fixes. On fresh first-pass inputs it would skip only #17, #23, #73 (2 neutral, 1 small good). Rate
would be about 97% and harmful 1.

## Round 3 fixes

Budget: round 2 5.83 USD, total 10.21 of 21.00. Round 3 at about 5.8 ends near 16.0.

1. Rewrite prompt, history rule: replace "drop it whole or keep it in past tense" with "Past-tense
   text that explains current code (a rejected alternative, the bug a guard prevents, a
   verification, a consequence chain) is a current why: keep it as written. Drop only narration
   that explains nothing about current code: who or which phase changed it, moved-from notes,
   `used to` with no consequence." Fixes #112 and all 10 harmful re-pass drops.
2. Rewrite prompt, tag rule: "If removing a tag leaves a claim false or dangling (`empty at P8`),
   keep the clause's truth: drop the whole clause or say what holds now." Fixes #61.
3. Rewrite prompt: "Equivalence, safety and cost comparisons (as safe as X, O(1) instead of
   O(n), not a binding change) are facts" (extends round 2 rule 5). Fixes #113, #83.
4. Pipeline: deterministic pre-check before the rewrite call, using the tokens gate's own tag
   patterns, the closed filler list and width. No hit: return unchanged, no model call, no cost.
   Report how many fresh units it skips and judge them for missed-trivia.
5. Tokens gate: a double-quoted span that contains backticks is still matched as one token (#81).
   Compare quoted spans after stripping backticks inside them.
6. Width: rewrites keep inherited over-width lines (#31, #74). Prompt already asks to reflow; add
   to the width gate a reject when a changed draft keeps any line over 100, and measure the
   kept-count cost.
7. Adopt the recommended idempotence bars (a = 0, c <= 5%, b reported) only if the user agrees;
   until then the literal 95% bar stands.

## Per unit

Default verdict judges the draft gates 1-6 accepted; check arm column is the separate check-on run's outcome and check verdict.

| id | file:line | outcome | default | check arm | USD main | USD check | reason |
|---|---|---|---|---|---|---|---|
| 0 | apps/kira-space/internal/gitclient/runner.go:433 | rewritten | good | rewritten | 0.0085 | 0.0144 | (D4) dropped |
| 1 | internal/rpcstream/session.go:1 | unchanged | neutral | unchanged | 0.0181 | 0.0101 | unchanged; nothing to drop |
| 2 | apps/kira-studio/internal/localauth/evaluate_darwin.go:3 | rewritten | good | rewritten | 0.0224 | 0.0304 | P14 D4, D8, P7 §1.4, v1.1 P14 dropped; clang error kept |
| 3 | apps/kira-studio/internal/mcpauth/token.go:173 | unchanged | neutral | unchanged | 0.0153 | 0.0086 | unchanged; nothing to drop |
| 4 | apps/kira-studio/internal/storage/repos/history.go:11 | rewritten | good | rewritten | 0.0146 | 0.0205 | T2-14, D6/D11 dropped |
| 5 | apps/kira-studio/internal/adapters/sqlite/console.go:31 | rewritten | good | rewritten | 0.0140 | 0.0185 | F5, MY-1 dropped |
| 6 | apps/kira-studio/internal/adapters/redis/errors.go:15 | rewritten | good | rewritten | 0.0112 | 0.0219 | C13 x2 dropped |
| 7 | internal/shell/registry.go:144 | rewritten | good | rewritten | 0.0084 | 0.0201 | P129 ref dropped |
| 8 | apps/kira-studio/internal/httpclient/wire.go:122 | rewritten | good | rewritten | 0.0124 | 0.0189 | F20, D4 dropped; "the cap" loses a little |
| 9 | apps/kira-studio/internal/connections/input.go:177 | rewritten | good | rewritten | 0.0221 | 0.0236 | review tag and old no-cap narration dropped; Validate why kept |
| 10 | apps/kira-studio/internal/adapters/mongo/read.go:388 | unchanged | neutral | unchanged | 0.0108 | 0.0083 | unchanged; nothing to drop; inherited 101-col line left |
| 11 | apps/kira-studio/internal/adapters/testsupport/mysql.go:88 | rewritten | good | rewritten | 0.0161 | 0.0219 | §6d, P34 D28 dropped |
| 12 | apps/kira-studio/internal/adapters/connset.go:42 | rewritten | good | rewritten | 0.0104 | 0.0152 | D14 dropped |
| 13 | apps/kira-studio/internal/page/builder.go:283 | rewritten | good | rewritten | 0.0127 | 0.0174 | finding #3, M7 dropped |
| 14 | apps/kira-studio/internal/storage/model/variables.go:15 | rewritten | good | rewritten | 0.0181 | 0.0202 | P5/P17/P18 D-tags, F10 dropped |
| 15 | apps/kira-space/internal/gitsession/ops.go:856 | rewritten | good | rewritten | 0.0153 | 0.0187 | D9/F9, F12 dropped |
| 16 | apps/kira-studio/internal/connections/service.go:643 | rewritten | good | rewritten | 0.0208 | 0.0260 | P28, M1-M3 dropped |
| 17 | apps/kira-studio/internal/page/scratch.go:54 | rewritten | neutral | rewritten | 0.0134 | 0.0182 | only "just" (= merely) dropped; closed list says keep |
| 18 | apps/kira-studio/internal/ipcfixture/frozen.go:469 | unchanged | neutral | unchanged | 0.0139 | 0.0070 | unchanged; nothing to drop |
| 19 | apps/kira-space/internal/gitsession/stack.go:87 | rewritten | good | rewritten - false pass (own draft lost the spawned processes) | 0.0309 | 0.0320 | G31 finding tag and serial-spawn narration dropped; 64-process cost kept |
| 20 | internal/metrics/ticker.go:93 | rewritten | good | rewritten | 0.0114 | 0.0169 | F4 dropped |
| 21 | apps/kira-space/internal/gitsession/cache.go:55 | rewritten | good | rewritten | 0.0160 | 0.0205 | P113 G9, G4 D7, D10/F16 dropped |
| 22 | apps/kira-studio/internal/adapters/postgres/query.go:84 | rewritten | good | rewritten | 0.0095 | 0.0157 | P2 R1 dropped |
| 23 | apps/kira-studio/internal/adapters/registry.go:6 | rewritten | neutral | kept:check - false alarm (dead registry.ts link) | 0.0162 | 0.0234 | "loaders is registry.ts's successor" dropped: registry.ts gone, but doc comment loses its subject and "the TypeScript" its referent |
| 24 | apps/kira-studio/internal/adapters/postgres/client.go:250 | unchanged | neutral | unchanged | 0.0115 | 0.0075 | unchanged; nothing to drop |
| 25 | internal/keepawake/keepawake.go:58 | rewritten | good | rewritten | 0.0102 | 0.0171 | §1.4 dropped |
| 26 | internal/mcpinstall/install.go:124 | rewritten | good | rewritten | 0.0192 | 0.0253 | F2/F3/F10 and old --header form dropped |
| 27 | apps/kira-studio/internal/bridge/grpc.go:451 | unchanged | neutral | unchanged | 0.0132 | 0.0080 | unchanged; nothing to drop |
| 28 | apps/kira-studio/main.go:163 | unchanged | neutral | unchanged | 0.0115 | 0.0191 | unchanged; nothing to drop |
| 29 | apps/kira-space/internal/gitaskpass/broker.go:122 | rewritten | good | rewritten | 0.0144 | 0.0178 | F13 dropped |
| 30 | apps/kira-studio/internal/adapters/live.go:38 | rewritten | good | rewritten | 0.0163 | 0.0215 | F2 (P108) dropped |
| 31 | apps/kira-space/internal/ade/facts.go:28 | rewritten | bad-style | rewritten | 0.0167 | 0.0241 | untouched input line 101 cols kept; prompt says reflow over-width lines |
| 32 | apps/kira-space/internal/gitsession/registry.go:78 | rewritten | good | rewritten | 0.0162 | 0.0203 | G24 D1, F13, "actually" dropped |
| 33 | apps/kira-studio/internal/adapters/awscfg/config.go:34 | unchanged | neutral | unchanged | 0.0125 | 0.0069 | unchanged; nothing to drop |
| 34 | apps/kira-studio/internal/apivars/resolve.go:437 | rewritten | good | rewritten | 0.0165 | 0.0195 | "actually", D9/D10/§5 dropped |
| 35 | apps/kira-studio/internal/storage/repos/maintenance.go:23 | rewritten | good | rewritten | 0.0140 | 0.0201 | D5(b) dropped; "before this phase" left (borderline) |
| 36 | apps/kira-studio/internal/storage/model/window.go:38 | unchanged | neutral | unchanged | 0.0103 | 0.0070 | unchanged; nothing to drop |
| 37 | apps/kira-space/internal/gitclient/porcelain/diff.go:29 | rewritten | good | rewritten | 0.0144 | 0.0192 | D4/D8, Probe P6 dropped |
| 38 | apps/kira-space/internal/gitsession/review.go:12 | rewritten | good | rewritten | 0.0151 | 0.0216 | D9, F4 dropped |
| 39 | apps/kira-space/internal/gitclient/watcher_fsnotify.go:23 | rewritten | good | rewritten | 0.0129 | 0.0183 | G2 F9, G9 D6/D10 dropped |
| 40 | apps/kira-studio/internal/bridge/responsehistory.go:9 | rewritten | good | rewritten | 0.0200 | 0.0287 | D8, P4 D11, D2 dropped |
| 41 | apps/kira-studio/internal/adapters/redis/console.go:324 | rewritten | good | rewritten | 0.0127 | 0.0165 | F1 dropped |
| 42 | apps/kira-space/internal/codeworkspace/enumerate.go:11 | rewritten | good | kept:form | 0.0198 | 0.0150 | §6, C5 §7.1, P97 move narration dropped; "are unchanged" dangles slightly |
| 43 | apps/kira-studio/internal/adapters/mysqlfamily/console.go:37 | rewritten | good | rewritten | 0.0134 | 0.0179 | B4 dropped |
| 44 | apps/kira-studio/internal/adapters/mysqlfamily/client.go:205 | rewritten | good | rewritten | 0.0238 | 0.0262 | P21 finding dropped; old split bug kept in past tense as the why |
| 45 | apps/kira-space/internal/gitsession/gh.go:35 | rewritten | good | rewritten | 0.0158 | 0.0237 | D7/D4 tags and plan-commit aside dropped |
| 46 | internal/metrics/sampler.go:135 | rewritten | good | rewritten | 0.0169 | 0.0202 | D7, F3 dropped |
| 47 | apps/kira-studio/internal/appwire/wire.go:161 | rewritten | good | rewritten | 0.0144 | 0.0183 | P92, P128 dropped |
| 48 | apps/kira-space/internal/gitrpc/wire.go:370 | rewritten | good | rewritten | 0.0186 | 0.0312 | G7, D2, D5 precedent dropped |
| 49 | apps/kira-space/internal/gitsearch/scan.go:205 | unchanged | neutral | unchanged | 0.0096 | 0.0055 | unchanged; nothing to drop |
| 50 | apps/kira-studio/frontend/src/views/grpcrequest/state.ts:26 | rewritten | good | rewritten | 0.0229 | 0.0279 | P21 finding, D15/D17, revert narration dropped; 90% test fact kept |
| 51 | packages/shared/caps.ts:59 | unchanged | neutral | unchanged | 0.0136 | 0.0092 | unchanged; nothing to drop |
| 52 | apps/kira-space/frontend/src/state/settingsDomain.ts:37 | rewritten | good | rewritten | 0.0164 | 0.0210 | G18 D15 and dead-wiring narration dropped |
| 53 | apps/kira-studio/frontend/src/views/grid/fakeData/typeBounds.ts:115 | rewritten | good | kept:check - true catch (own draft dropped cause chain) | 0.0228 | 0.0287 | F10, F6/P21, "used to" dropped; cause chain kept in past tense |
| 54 | apps/kira-studio/frontend/src/views/grid/slick/rowValues.ts:13 | rewritten | good | rewritten | 0.0230 | 0.0286 | P22/C7/C11/§1 tags dropped |
| 55 | apps/kira-studio/frontend/src/views/console/state.ts:585 | rewritten | good | rewritten | 0.0159 | 0.0238 | P12 finding and "before" narration dropped |
| 56 | apps/kira-studio/frontend/src/state/schemas.ts:26 | rewritten | good | rewritten | 0.0176 | 0.0227 | F1, P12 finding dropped; rejected-alternative why kept |
| 57 | apps/kira-studio/frontend/src/state/schemaColumns.ts:78 | rewritten | good | rewritten | 0.0131 | 0.0190 | P22c F1, P4 dropped |
| 58 | apps/kira-studio/frontend/src/theme/cellClass.ts:16 | rewritten | good | rewritten | 0.0121 | 0.0167 | P42 D21, F15 dropped |
| 59 | packages/shared/domain/mask.ts:43 | unchanged | neutral | unchanged | 0.0120 | 0.0076 | unchanged; nothing to drop |
| 60 | packages/git-ui/src/state/selection.ts:4 | kept:tokens | missed-trivia | kept:check - false alarm (plan-sketch ref) | 0.0284 | 0.0305 | kept:tokens, right reject: draft lost backticks on `App.vue` and the "neither state class references the other" fact; original keeps §3.1/P3/P4 W5/W11 |
| 61 | packages/git-core/src/preflight/types.ts:96 | rewritten | bad-wrong | kept:check - true catch (flagged plan ref, draft also says "empty") | 0.0162 | 0.0226 | "empty at P8" cut to "empty": PullRoute is 'stashAndCarry' now, and next clause says it is offered |
| 62 | apps/kira-studio/frontend/src/api/state/variables.ts:267 | rewritten | good | rewritten | 0.0142 | 0.0195 | D3/D11/P28 and dialog-gone narration dropped |
| 63 | packages/git-ui/src/main.ts:15 | rewritten | good | rewritten | 0.0143 | 0.0202 | P79 review tag dropped |
| 64 | apps/kira-studio/frontend/src/views/shared/mongoVocabulary.ts:27 | rewritten | good | rewritten | 0.0158 | 0.0199 | P27 D15/D17 dropped |
| 65 | packages/shared/domain/sqlLex.ts:33 | rewritten | good | rewritten | 0.0115 | 0.0161 | F4 dropped |
| 66 | scripts/codegraph-duplicates.ts:2 | rewritten | good | rewritten | 0.0158 | 0.0216 | P107/P113 provenance dropped |
| 67 | apps/kira-space/frontend/src/workbench/tabViews.ts:10 | rewritten | good | rewritten | 0.0196 | 0.0235 | P100, P128, "now", deleted-file note dropped |
| 68 | apps/kira-studio/frontend/src/project/state/tree.ts:180 | rewritten | good | rewritten | 0.0134 | 0.0175 | P43 D23, P41 D5 dropped |
| 69 | packages/git-ui/src/state/ops.ts:97 | rewritten | good | kept:check - false alarm (§7.4 ref) | 0.0168 | 0.0228 | §7.4, D48, D52 dropped |
| 70 | packages/workbench/src/testing/ui/mockRuntime.ts:272 | unchanged | neutral | unchanged | 0.0107 | 0.0065 | unchanged; nothing to drop |
| 71 | apps/kira-studio/frontend/src/views/shared/viewOp.ts:232 | rewritten | good | rewritten | 0.0135 | 0.0174 | P107 T2-16, D18 dropped |
| 72 | apps/kira-studio/frontend/src/views/grid/pendingChanges.ts:10 | rewritten | good | rewritten | 0.0096 | 0.0153 | D3 dropped |
| 73 | packages/git-core/src/graph/lanes.ts:202 | rewritten | good | rewritten | 0.0190 | 0.0263 | "this fixes" dropped; earlier-version warning kept |
| 74 | packages/git-ui/src/lib/searchHighlight.ts:1 | rewritten | bad-style | rewritten | 0.0187 | 0.0269 | untouched input line 101 cols kept (check arm reflowed it) |
| 75 | packages/git-ui/src/lib/columns.ts:315 | rewritten | good | rewritten | 0.0184 | 0.0253 | P92, §2 dropped |
| 76 | apps/kira-studio/frontend/src/views/shared/slick/gridHostShared.ts:48 | rewritten | good | rewritten | 0.0129 | 0.0170 | D4/D2 dropped |
| 77 | apps/kira-studio/frontend/src/api/state/collections.ts:525 | rewritten | good | rewritten | 0.0203 | 0.0245 | D14, finding 4, P112 dropped |
| 78 | packages/git-ui/src/state/search.ts:194 | rewritten | good | rewritten | 0.0146 | 0.0198 | §7.8 dropped |
| 79 | apps/kira-space/frontend/src/repo/state/repoHeads.ts:25 | unchanged | neutral | unchanged | 0.0183 | 0.0078 | unchanged; nothing to drop |
| 80 | apps/kira-studio/frontend/src/bridge/port.ts:80 | rewritten | good | rewritten | 0.0242 | 0.0272 | P11, P2 R2, F6, "now" dropped |
| 81 | packages/git-ui/src/graph/rowSvg.ts:158 | kept:tokens | missed-trivia | kept:tokens | 0.0133 | 0.0090 | kept:tokens false reject: draft only drops "§5.3's first decision:"; quote span holding backticks likely misparsed |
| 82 | packages/workbench/src/editor/paintSpans.ts:3 | rewritten | good | rewritten | 0.0136 | 0.0203 | P60a, §5 OQ-2 dropped |
| 83 | apps/kira-studio/frontend/src/bridge/apiControl.ts:41 | rewritten | good | rewritten | 0.0229 | 0.0326 | P12 D11, F13, finding-19 move narration dropped |
| 84 | packages/git-ipc/src/codec.ts:52 | rewritten | good | rewritten | 0.0135 | 0.0173 | G32 finding dropped |
| 85 | apps/kira-studio/frontend/src/views/shared/useConnectionGate.ts:77 | rewritten | good | kept:check - false alarm, borderline (doomed-call why) | 0.0122 | 0.0203 | P46 tag and old-reload narration dropped; doomed-call why thinner (borderline) |
| 86 | packages/shared/protocol/page.ts:466 | rewritten | good | rewritten | 0.0126 | 0.0161 | P17 dropped |
| 87 | packages/shared/domain/tabs.ts:6 | rewritten | good | rewritten | 0.0241 | 0.0294 | P103 tag and old 16-member schema narration dropped |
| 88 | apps/kira-studio/frontend/src/views/console/planParsers/sqlite.ts:5 | rewritten | good | rewritten | 0.0251 | 0.0272 | P18 D13-D16, F14 dropped |
| 89 | apps/kira-studio/frontend/src/views/console/sqlLanguageService.ts:8 | rewritten | good | rewritten | 0.0265 | 0.0287 | P18 D1, P60a, P58f, "actually" dropped |
| 90 | apps/kira-studio/frontend/src/api/VariableSetView.vue:432 | rewritten | good | rewritten | 0.0141 | 0.0204 | R11, D16 dropped |
| 91 | packages/git-ui/src/components/BranchPicker.vue:338 | rewritten | good | rewritten | 0.0113 | 0.0167 | G10/P77 dropped |
| 92 | apps/kira-studio/frontend/src/views/httprequest/RequestSettingsPane.vue:22 | rewritten | good | rewritten | 0.0138 | 0.0185 | P90 §2.6 dropped |
| 93 | apps/kira-studio/frontend/src/views/grid/SlickGridHost.vue:1782 | rewritten | good | rewritten | 0.0215 | 0.0300 | reported-bug narration, D3/D8 dropped; never-specified why kept |
| 94 | packages/git-ui/src/components/CommitGrid.vue:202 | rewritten | good | rewritten | 0.0200 | 0.0222 | W8 dropped |
| 95 | packages/git-ui/src/App.vue:1507 | rewritten | good | kept:check - true catch (own draft lost SearchBox move why) | 0.0199 | 0.0284 | G-UX D9 dropped, "used to own" to "owned" |
| 96 | apps/kira-studio/frontend/src/views/grpcrequest/ResponsePane.vue:81 | rewritten | good | rewritten | 0.0139 | 0.0215 | P108 F18 and old-drop narration dropped |
| 97 | apps/kira-studio/frontend/src/views/shared/fields/FieldRowsTable.vue:42 | rewritten | good | rewritten | 0.0144 | 0.0227 | P15b D4 dropped |
| 98 | apps/kira-studio/frontend/src/views/shared/celleditor/CellEditorView.vue:118 | rewritten | good | kept:check - true catch (own draft lost "is my json broken" why) | 0.0226 | 0.0282 | "actually", history, item-1 tag, duplicate last line dropped |
| 99 | packages/theme/src/components/EmptyState.vue:14 | rewritten | good | rewritten | 0.0114 | 0.0155 | P16 dropped |
| 100 | apps/kira-studio/frontend/src/views/console/ConsoleResultGrid.vue:197 | rewritten | good | rewritten | 0.0118 | 0.0165 | P46 task tag dropped |
| 101 | apps/kira-studio/frontend/src/workbench/UploadObjectDialog.vue:56 | rewritten | good | rewritten | 0.0160 | 0.0229 | P43 F1/D1, old pathTail bug dropped |
| 102 | packages/git-ui/src/components/AppToolbar.vue:265 | rewritten | good | rewritten | 0.0115 | 0.0167 | G10 D17/F15 dropped |
| 103 | apps/kira-studio/frontend/src/api/EditRawRequestDialog.vue:24 | rewritten | good | rewritten | 0.0140 | 0.0190 | P9 D8/D9, F17 dropped |
| 104 | packages/git-ui/src/components/dialogs/RevertDialog.vue:5 | rewritten | good | rewritten | 0.0161 | 0.0227 | P6 W15, §7.10, P131, "now/still" dropped |
| 105 | apps/kira-space/frontend/src/workbench/StatusBar.vue:83 | rewritten | good | rewritten | 0.0189 | 0.0232 | P110 tag, measurement record dropped |
| 106 | packages/workbench/src/components/OpLogPanel.vue:117 | rewritten | good | rewritten | 0.0151 | 0.0183 | P104 §3.4 recipe narration dropped |
| 107 | apps/kira-studio/frontend/src/views/grid/DataToolbar.vue:246 | rewritten | good | rewritten | 0.0184 | 0.0244 | §4b/§4d and old hand-rolled switch narration dropped |
| 108 | packages/git-ui/src/components/dialogs/WorktreeDialog.vue:161 | rewritten | good | rewritten | 0.0185 | 0.0243 | G28 D7, G25 §9, D6 dropped |
| 109 | apps/kira-studio/frontend/src/workbench/GenerateDataDialog.vue:136 | rewritten | good | rewritten | 0.0130 | 0.0185 | P12 finding dropped |
| 110 | packages/workbench/src/prompt/TextPromptDialog.vue:43 | rewritten | missed-trivia | rewritten | 0.0204 | 0.0252 | P28/P110 tags dropped; "section 1.2's own" plan ref kept |
| 111 | packages/workbench/src/components/SettingsShell.vue:85 | rewritten | good | rewritten | 0.0105 | 0.0151 | P17 D1 dropped |
| 112 | apps/kira-studio/frontend/src/views/grid/DataView.vue:112 | rewritten | bad-lost-why | kept:check - true catch | 0.0152 | 0.0197 | history drop took commitPending rejection kinds and "tell the user why": try/catch below left unexplained |
| 113 | apps/kira-studio/frontend/src/views/shared/page/SearchToolbar.vue:120 | rewritten | good | rewritten | 0.0396 | 0.0471 | P21 finding and old copy narration dropped; O(1) vs O(matches) kept |
| 114 | packages/git-ui/src/components/dialogs/ResetDialog.vue:2 | rewritten | good | rewritten | 0.0271 | 0.0370 | P10 W11, §7.7, OQ11, P131, restated shadcn parts dropped |
| 115 | packages/git-ui/src/components/GlobalStashList.vue:2 | rewritten | good | rewritten | 0.0205 | 0.0292 | G28 D12/D13, P77, I2-21 dropped |
| 116 | apps/kira-studio/frontend/src/views/shared/celleditor/CellEditorDock.vue:13 | rewritten | good | rewritten | 0.0095 | 0.0140 | P26 D1, P40 D11 dropped |
| 117 | apps/kira-space/frontend/src/repo/GitPanel.vue:237 | unchanged | neutral | rewritten | 0.0118 | 0.0275 | unchanged; nothing to drop; inherited 101-col line left |
| 118 | packages/git-ui/src/components/CommitMeta.vue:120 | rewritten | good | rewritten | 0.0117 | 0.0169 | §6.4 dropped |
| 119 | packages/git-ui/src/components/StashDetailPane.vue:12 | rewritten | good | rewritten | 0.0283 | 0.0347 | P9 W14, G21 D12, F12, "now" dropped |

Cost: main 1.9427 USD (0.0162/unit), idempotence 1.4314 (0.0139/unit), check-on arm 2.4564 (0.0205/unit), round 5.8304. Judge outside cap.
