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
- Plans with `## Result

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
