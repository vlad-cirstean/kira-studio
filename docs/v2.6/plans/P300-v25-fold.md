# P300 plan: v2.5 fold and tool fix

SPEC row P300 (`docs/v2.6/SPEC.md`). Base: `f6c522d2` (v2.6). Planner: Opus. Implementer: one sequential
Sonnet subagent. No split: the tool fix gates the fold, the data move gates the fold, the fold gates deletion.

Discovery: `codegraph_explore` over `skipRepoint repoint.go webviewOld parse_test.go`, `evalRepoRoot
evalPlansDir evalRunsDir roundDirOf`, `promptsizes compareTo readAllowed`, `docshistory main.go run
cmdUnits`, `loadChapter chapterCommit buildUnits`, `Parse planID planResult`. Docs, data, configs: `git grep`.
Free run: `go run ./scripts/docshistory units v2.5`. No distill call made.

## 1. Current state (verified)

- `docs/v2.5/`: 518 tracked files, 17 MB. History: `SPEC.md` (56 KB) plus 24 top-level `plans/*.md`
  (25 files). Data: `plans/P285-corpus` (6), `P285-runs` (329), `P289-runs` (3), `P291-corpus` (7),
  `P291-runs` (148, incl. `results.md`, `summarize.py`); 493 files.
- SPEC shape: one table `| Phase | Title | Status |`; first cells `P271`..`P293`, plus `P285 Part 1..4`
  and `P291` written as 2-cell rows (id and title in cell 1). Headings: `## Requirements (user's words,
  condensed)`, `## Process notes`. No `## P<n> result` sections; results sit in Status cells.
- Plans with `## Result`: `P271` (0.5 KB), `P274` (4.2 KB), `P293` (1.9 KB). Tool reads plan results only for
  `planResultChapters` (`units.go:111`, `v2.0` only), so these three are lost today.
- `P292` row says `Todo`; its work landed (commits `40facf0a`..`7c3b0a66` on `v2.0`, squashed into
  `bd0c2246`). Stale status.
- `repoint.go:91` `skipRepoint` skips `docs/v*`, `HISTORY.md`, workflows, pending-changes. Not
  `scripts/docshistory/` (P299 rewrote `parse_test.go` once). `operative()` makes `scripts/` hits
  `git show` pointers, so fixtures change shape.
- Eval data holds doc paths that must stay literal: `P285-corpus/manifest.json` lists `docs/v2.0/...`,
  `docs/v2.2/...` paths read by `git show 9ed83ae85:<path>`; `P291-runs/round-p291-*/facts.jsonl` and
  `telegraph/round-p3-holdout/plan-p155.json` hold 5 `docs/v2.5/` strings. Once data leaves `docs/v*`,
  repoint would rewrite them. Skip must cover the new data roots too.
- `--runs` default `docs/v2.6/plans/P299-runs`, `--out` default `docs/v2.6/plans/P299-verify.md`,
  `--jobs` default 3 (`main.go:42-50`). Rate-limit backoff exists (`distill.go:276`, 1 min doubling to 15).

## 2. Runtime readers of `docs/v2.5/**` (complete)

- `apps/kira-space/tests/claude/memory_eval_corpus_test.go:37` `evalCorpusDir` (P285-corpus),
  `:41` `evalCorpus291Dir`, `:44` `evalPlansDir`, `:48` `evalRunsDir` (default `P285-runs`,
  `KIRA_EVAL_RUNS_DIR`), `:54` `roundDirOf` (`<dir>/<round>` under plans). Callers:
  `memory_eval_test.go:114,122,326`, `memory_eval_judge_test.go:80,415,425`, `memory_eval_p291_test.go:24,
  188,293,329,423,592`, `memory_eval_footprint_test.go:214,268`, `memory_eval_retrieval_test.go:160,644,973,1083`.
  Doc comments: `memory_eval_test.go:30,31,39`, `memory_eval_corpus_test.go:43,46`.
- `internal/llmprompts/cmd/promptsizes/main.go:39` default `-allowed docs/v2.5/plans/P289-runs/allowed-losses.tsv`.
  A missing file reads as empty (`readAllowed`), so a wrong path fails silently.
- `biome.json:18-20` ignores `P285-corpus`, `P285-runs`, `P291-runs`.
- `site/src/content/docs/docs/reference/memory-formats.md:11-12` `sources:`; `site/scripts/docsRules.ts:269`
  fails `source not found` (pre-commit runs `check-docs.ts`). Repoint would turn them into
  `docs/HISTORY.md (v2.5 P273)`, not a file.
- Not readers: `checkprompts` skips `docs`, `testdata`, `tests` dirs (`checkprompts/main.go:36`); `package.json`
  `eval:memory` only cds into the nested module; `.githooks/*`, workflows, TS: no hit.
- Docs naming data paths: `ARCHITECTURE.md:5085,5087,5093,5327`, `DEV_ENVIRONMENT.md:488,940`, `README.md:263`.

## 3. Decisions

- D1 data home. `apps/kira-space/tests/claude/testdata/memory-eval/` gets `P285-corpus`, `P285-runs`,
  `P291-corpus`, `P291-runs`. Why: that nested module is the sole reader; `testdata/` is ignored by Go
  tooling and by `checkprompts`; root lint and test already exclude the nested module (`hook-scope.sh:48`).
  Folder names stay, so `KIRA_EVAL_RUNS_DIR=P291-runs`, round refs `P285-runs/round-p2-02` and result file
  names (`P285-runs__round-00a.json`, `compare/P285-runs_round-...`) stay valid and comparable.
- D2 `P289-runs` (allowed-losses, before snapshot, old distill log) goes to
  `internal/llmprompts/testdata/P289-runs/`, next to `budget.tsv`: `promptsizes` owns it, not the eval.
- D3 every move is `git mv` of whole folders, no content edit in the move commit, so `git log --follow`
  keeps history and bytes stay identical.
- D4 history vs data: `SPEC.md` and the 24 `plans/*.md` are history: folded, then deleted. Includes
  `P285-report.md`, `P291-report.md` (prose reports; not distilled, reached by `git show` pointer).
  Everything in §1's 5 data folders is data: moved, never deleted. `P291-runs/results.md`,
  `summarize.py` stay inside their run folder.
- D5 tool: add `v2.5` to `planResultChapters`, so P271, P274, P293 results fold. Safe: no other v2.5 plan
  has a Result heading, so no stray `P285` phase from `P285-memory-ingest-eval.md` or the reports.
- D6 tool defaults: `--runs docs/history-runs`, `--out -`, `--jobs 1`. The P299 paths go stale when v2.6
  folds; the CLAUDE.md command still passes them explicitly.
- D7 P292 status: set the cell to `Done. Two review rounds; fixes landed; round 2 open items in
  ARCHITECTURE Known open items.` Implementer confirms the open-item wording against `55a6fec3`, else
  drops that clause. Lands before the fold, so the fold's source commit carries it.

## 4. Cost

`units v2.5` (current tool): 26 phases plus 1 notes unit = 27 units, 49,147 bytes, commit `be0e8d6c0f04`.
D5 adds about 6.6 KB to 3 units: about 55.7 KB.

- Projected: 27 x 0.068 = **1.84 USD**. Size-based (v2.5 mean 2.1 KB per unit, like v2.2 at 0.04 USD
  per unit): about 1.1 to 1.4 USD.
- Worst case: tool envelope (0.06 USD plus 0.012 per 1,000 chars) = 1.62 + 0.67 = 2.29 USD; every unit
  retried once: 4.6 USD. **Under 10 USD.** Pass `--max-usd 10` as hard stop.
- Wall: 27 units at 7 to 40 s serial, about 5 to 18 min.

## 5. Steps

Group 1: tool fix (first; nothing below runs before it lands).
- `repoint.go`: `skipRepoint` adds prefixes `scripts/docshistory/`, `apps/kira-space/tests/claude/testdata/`,
  `internal/llmprompts/testdata/`. Delete `webviewOld, webviewNew`, the `refTarget` case, and the
  `rep != webviewNew` clause (`if op {`).
- `units.go:111`: `{"v2.0": true, "v2.5": true}`. `main.go`: D6 defaults; fix the usage line if it names them.
- `parse_test.go` `TestRepointText`: drop the webview ref from `in` and `want`, `n` 3 to 2. Add one
  assertion loop in the same test: `skipRepoint` true for `scripts/docshistory/parse_test.go` and
  `apps/kira-space/tests/claude/testdata/memory-eval/P285-corpus/manifest.json`, false for `src/x.go`.
  No new test function.
- `go test ./scripts/docshistory`, `go vet ./scripts/...`. Rerun `units v2.5`; record the new byte count.

Group 2: P292 status (D7). Single SPEC cell edit in `docs/v2.5/SPEC.md`.

Group 3: move data. Baseline first, before any `git mv` (all free, no `claude`):
- `go run ./internal/llmprompts/cmd/promptsizes -compare docs/v2.5/plans/P289-runs/before.json` into
  `$SCRATCH/ps-before.txt`. Today exit 1, 10 losses (P296/P297 intent). Also run with `-allowed /dev/null`
  and note the larger count: proves the file is read.
- `go run ./internal/llmprompts/cmd/checkprompts` exit 0.
- Footprint: `KIRA_EVAL_MODE=footprint KIRA_EVAL_ROUNDS=round-p297-01,round-p298-01 bun run eval:memory`.
  Copy the rewritten `footprint-v3.json` files to scratch, then `git checkout` the data dir.
- Compare: read `evalCompare` for the variant syntax, rerun one committed comparison
  (`KIRA_EVAL_RUNS_DIR=P291-runs KIRA_EVAL_ROUNDS=P285-runs/round-p2-01,P285-runs/round-p2-01b
  KIRA_EVAL_VARIANTS=full/base/fact/hybrid` or what the code needs). Copy output, `git checkout`.
- Skip `retrieval` (needs ONNX runtime and model). No paid mode.

Then move and repoint readers:
- `git mv` the 4 eval folders to `apps/kira-space/tests/claude/testdata/memory-eval/`; `P289-runs` to
  `internal/llmprompts/testdata/P289-runs`. One commit with the edits below (`refactor: move eval data
  out of docs/v2.5`); data bytes unchanged, so git records 100% renames.
- `memory_eval_corpus_test.go`: `evalPlansDir` becomes `evalDataDir()` =
  `filepath.Join(evalRepoRoot(), "apps", "kira-space", "tests", "claude", "testdata", "memory-eval")`;
  `evalCorpusDir` joins it; rename callers; fix comments at the lines in §2 ("under the eval data dir").
- `promptsizes/main.go:39` default to `internal/llmprompts/testdata/P289-runs/allowed-losses.tsv`.
- `biome.json`: replace lines 18-20 with `"!apps/kira-space/tests/claude/testdata/memory-eval"`.
- `ARCHITECTURE.md:5085,5087,5093,5327` and `DEV_ENVIRONMENT.md:488,940`: new paths for data.
- After: rerun every baseline. Pass = `promptsizes` output and exit identical (`cmp`), `checkprompts` 0,
  footprint and compare outputs `cmp`-identical to scratch copies, `git status` clean after checkout.
  `cd apps/kira-space/tests/claude && go vet ./...` (eval skips without `KIRA_MEMORY_EVAL`).
  `git grep -n "docs/v2\.5/plans/P2[89][159]-\(corpus\|runs\)"` empty outside `docs/v2.5`, `docs/v2.6`,
  `docs/HISTORY.md` and the moved data.

Group 4: fold (CLAUDE.md rollover rule). Needs logged-in `claude`; `git status -- docs/v2.5` clean.
- `go run ./scripts/docshistory fold --runs docs/history-runs --out - --jobs 1 --max-usd 10 v2.5 | tee $SCRATCH/p300-verify.md`
- Rate limit: tool waits (1 min doubling, cap 15), charges 0, keeps the try. Process killed or cap hit:
  rerun the same command; units with an `ok` record and same input sha are skipped. Fallback units:
  rerun once with `--retry-fallback`. Any unit still fallback after that: stop, report to orchestrator.
  Spend at 10 USD: stop, report; never raise the cap alone.
- Verify: read the 12-phase sample by hand. Every `[CHECK]` line gets a yes/no "decision carried". Spot
  check P271, P274, P293 (D5 results present) and P292 status.
- Commit `docs: fold v2.5 into HISTORY.md` with `docs/HISTORY.md` and `docs/history-runs/`.

Group 5: hand edits repoint cannot do, then repoint.
- `memory-formats.md` `sources:`: replace the two v2.5 lines with one `docs/HISTORY.md`.
- `README.md:263`: "distills the earlier chapters (v1 to v2.5)"; drop "v2.5 stays in `docs/`".
- `ARCHITECTURE.md` `P285-report.md` and `P291-report.md` refs: `git show <v2.5 source commit>:docs/v2.5/plans/...`
  (12-char commit from `docs/history-runs/v2.5.jsonl`). Keeps the full report reachable.
- `go run ./scripts/docshistory repoint --runs docs/history-runs --dry-run v2.5`, read `unmatched:`, then
  without `--dry-run`. Confirm `git diff --stat` touches nothing under `scripts/docshistory/` or the two
  data roots. Commit `refactor: repoint docs/v2.5 references to HISTORY.md`.

Group 6: delete. `git rm -r docs/v2.5`. With runs still present: `go run ./scripts/docshistory render
--runs docs/history-runs v2.5`, then `git diff --exit-code docs/HISTORY.md`. Then `git rm -r docs/history-runs`.
Commit `docs: remove v2.5 chapter folder`.

Group 7: drop `docs/WEBVIEW-SCROLL-MEMORY.md`. Pointer: `git show 7d8a72ab4a5e:docs/WEBVIEW-SCROLL-MEMORY.md`.
- `wkhost.swift:3`: pointer ("Appendix A harness of `git show ...`"). `:16`: drop "(the doc's §2.1)".
- `perfProbe.ts:6-7`: read footprint with `apps/kira-studio/frontend/proto/grid/mac/wkhost.swift`, drop the doc.
- `columns.ts:203`: drop "(WEBVIEW-SCROLL-MEMORY.md §6)".
- `budgets.spec.ts:315`: "a fling peak, and the v1.1 P22 memory study's top rung (456)"; drop "so the two
  documents' axes line up".
- `internal/shell/closeflush.go:91`: drop the parenthetical. `window.go:123-124`: "Its effect on the
  WKWebView scroll-memory plateau is real but small and unmeasured"; drop the doc names.
- `ARCHITECTURE.md:5397`: pointer with §7. `DEV_ENVIRONMENT.md:866`: read footprint with `wkhost.swift`.
- `PERF.md:368,374,415,419`: each doc path becomes the pointer (sections kept; prose there cites them).
  `:415` "both are now recorded there directly" becomes "both are recorded in that document".
- Untouched: `docs/HISTORY.md:821` (rendered, never hand-edited; v1.1 path is the true source path),
  `docs/v2.6/**` (history records).
- `git rm docs/WEBVIEW-SCROLL-MEMORY.md`. Commit `docs: drop WEBVIEW-SCROLL-MEMORY.md`.

Group 8: process docs. `docs(claude): fold rule and eval data home`.
- CLAUDE.md rollover bullet: add `--jobs 1 --max-usd <cap>` to the command. Add one sentence: "Data a test or
  script reads at runtime never lives under `docs/v*/`; it goes in its reader's `testdata/`." Replace "Skip a
  chapter whose files a test or script reads at runtime (move them first, own phase)" with that rule
  plus "move any found first, own phase".
- `DEV_ENVIRONMENT.md:474` (docshistory): defaults now `docs/history-runs`, stdout, 1 job; repoint skips
  `scripts/docshistory/` and both `testdata/` roots; v2.5 cost from Result. `:488`, `:940`: eval data under
  `apps/kira-space/tests/claude/testdata/memory-eval/`; new rounds land there, commit them as before.

Group 9: `docs(v2.6): P300 result`: fill `## Result`, set the SPEC row `Done.` plus one line.

Final checks (before Group 9): `go test ./scripts/docshistory`, `go vet ./scripts/...`, `bun run lint:go`,
`bun site/scripts/check-docs.ts`, nested-module `go vet`, `promptsizes` and `checkprompts` as above.
Greps: `git grep -n "docs/v2\.5"` hits only `docs/HISTORY.md`, `docs/v2.6/**`, `git show` pointers and the
5 pinned strings in moved eval data. `git grep -n WEBVIEW-SCROLL-MEMORY` hits only `docs/HISTORY.md`,
`docs/v2.6/**` and `git show 7d8a72ab4a5e:` pointers. Hooks pass on every commit, no `--no-verify`.
Do not touch `.github/workflows/`. Do not push. Real-`claude` suites: not run (no Claude integration code
changes; eval harness change is paths only, checked by free modes).

## 6. Report the implementer gives

One table plus deviations:

| Item | Value |
|---|---|
| Commits (group: hash subject) | 1..9 |
| Units: total / ok / fallback / retried | |
| Spend: ledger ok `costUsd` sum / charged sum / cap | vs 1.84 projected |
| `units v2.5` bytes before / after D5 | 49,147 / |
| `HISTORY.md` bytes, lines before / after | 913,049, 6,106 / |
| Verify: sampled, `[CHECK]` lines, decisions lost | |
| Repoint: refs / files / unmatched; hand edits | |
| Moved: files per folder, `git mv` renames 100% | 493 |
| Deleted: `docs/v2.5` files, `history-runs` files | 25 history + |
| Free checks: promptsizes cmp, checkprompts, footprint cmp, compare cmp | |
| WEBVIEW refs: each file, pointer or dropped | |
| Greps (§5 final) | empty / listed |
| Hooks, lint, tests | |

## Result

Done. All groups landed, hooks passed normally on every commit, nothing pushed.

| Item | Value |
|---|---|
| Commits | 1 `bc147350` tool fix; 2 `b811de65` P292 status; 3 `1cff86ba` move eval data; A `bf16cad8` fix(memory) verify turns; 4 `ba04a3f2` fold; 5 `93ae0ff7` repoint; 6 `b58b6da3` rm v2.5; 7 `4e1868e6` rm WEBVIEW doc; 8 `9ff81340` CLAUDE.md, DEV_ENVIRONMENT; 9 this commit |
| Units: total / ok / fallback / retried | 27 / 27 / 0 / 1 (`v2.5-p271`, fixed by Step A, ok on first try after) |
| Spend (ledger, 34 try rows, 7 failed) | ok `costUsd` sum 1.448 USD; charged sum 3.198 USD (failed tries charge a 0.25 USD estimate, real cost recorded 0); cap 10; projected 1.84 |
| `units v2.5` bytes before / after D5 | 49,147 / 80,165 (17 plans carry numbered `## N. Result` headings, not 3) |
| `HISTORY.md` bytes, lines before / after | 913,049, 6,106 / 962,950, 6,474 |
| Verify: sampled, `[CHECK]` lines, decisions lost | 12 of 26 phases; 12 `[CHECK]`; 0 lost. 11 `[CHECK]` lines are other phases' SPEC rows naming the sampled phase (their content sits in their own units); 1 is the chapter note "Prompts go first rather than last", carried in the chapter header. P271, P274, P293 result text present; P292 reads Done with two review rounds and open items in ARCHITECTURE. |
| Repoint | 4 refs in 2 files (1 jsonl line for `P285-report.md`, rendered into HISTORY.md; ARCHITECTURE line by hand); unmatched 4, all `docs/v2.5/plans/P285-corpus` prose inside runs. Hand edits: `memory-formats.md` sources, `README.md:263`, ARCHITECTURE `P285-report.md` pointer `git show b811de651f56:...`. `render` after `git rm docs/v2.5` identical to HISTORY.md. |
| Moved | 493 files, 100% renames (group 3) |
| Deleted | `docs/v2.5` 25 files, `docs/history-runs` 2 files, `docs/WEBVIEW-SCROLL-MEMORY.md` |
| Free checks | `promptsizes` output and exit (10 losses, exit 1) identical to pre-move; `checkprompts` 0; footprint and compare identical (group 3) |
| WEBVIEW refs | pointer: `wkhost.swift`, `ARCHITECTURE.md`, `PERF.md` (4); dropped: `columns.ts`, `budgets.spec.ts` (now names the v1.1 P22 study), `closeflush.go`, `window.go`; repointed to `wkhost.swift`: `perfProbe.ts`, `DEV_ENVIRONMENT.md` |
| Greps | `docs/v2.5`: only the 3 pinned strings in moved eval data (plus HISTORY.md, v2.6). `WEBVIEW-SCROLL-MEMORY`: only `git show 7d8a72ab4a5e:` pointers (plus HISTORY.md, v2.6) |
| Checks | `go test ./scripts/docshistory`, `go vet ./scripts/...`, `bun run lint:go` 0 issues, `check-docs` 0 violations, nested `go vet` ok |

Step A, verify fix. Cause: `verifyBaseTurns` was 3. A 2-fact batch (not a big one) hit `terminal_reason: max_turns` in 7 of 8 replays at 3 turns, 0 of 14 at 5 or 6. Batch size was not the cause. Fix in `internal/memory/importer/verify.go`: base 6 (scaling `+facts/4`, cap 20 kept). Also `error_max_turns` now maps to `memory.ErrClaudeMaxTurns` ("Claude Code call hit its turn limit.", retryable, passed through `memoryErr`) instead of `Claude Code failed: exit 1`; one row in `TestCLIRunnerErrorMapping`. Rerun after fix: `v2.5-p271` ok first try (11 lines, 0.049 USD). Free checks: build, vet, `lint:go`, `internal/memory/...`, bridge, memoryflow tests pass. Real `claude` rows (`-count=1`): `TestMemoryGate`, `TestMemoryImport` (0.149 USD), `TestMemoryIngestThroughClaude` (0.114), `TestMemoryDistill`, `TestMemoryDistillBridge`, `TestMemoryDistillTrivia` all PASS. Step A real spend about 0.85 USD (repro runs and 22 replays about 0.45, rows about 0.4 by printed costs; gate not printed separately), under the 2 USD limit.

Deviations: Step A added the fix(memory) commit inside this phase (fix-on-the-spot rule). `HISTORY.md` P285 Part 1 line now reads "docs/HISTORY.md (v2.5 P285)" where the source said `P285-report.md` (repoint's output, not hand-edited); the report stays reachable by `git show b811de651f56:docs/v2.5/plans/P285-report.md`. P291-report had no live reference to repoint.
