# P305 plan: close chapter v2.6

SPEC row P305 (`docs/v2.6/SPEC.md`). Base: `0e33d63e0` (v2.6). Planner: Opus. Implementer: one sequential
Sonnet subagent. No split: restore and tool fix gate the fold, the fold pins a commit every later step cites,
deletion waits on all of it.

Discovery: `codegraph_explore` over `scripts/docshistory` (`loadChapter planResultChapters buildUnits
skipRepoint checkChapter`, `planID planResult cmdUnits cmdVerify`, `distillChapter loadRecords renderChapter
cmdRender`). Docs, configs, data: `git grep`, `grep`. Free run: `units v2.6` in a throwaway worktree with the
D2 patch. No pilot, no spend: v2.6 has the v2.5 shape (P300 folded 27 units with it), and the one real
unknown (D1) surfaced free.

## 1. Current state (verified)

- `docs/v2.6/`: 47 tracked files, 2,188,125 bytes.
  - History md (17 files, 303,530 B): `SPEC.md` (17,844 B) and 12 top-level `plans/*.md`
    (P294 to P304 minus P301, plus `P299-verify.md`, `P303-verify.md`); this plan makes 13.
  - Pilot md (12 files, 56,443 B): `P298-pilot/inputs/*.md` (10), `P299-pilot/pilot.md`, `P303-pilot/pilot.md`.
  - Non-md data (22 files, 1,828,152 B): `P298-pilot/lines.tsv` 86,949 and `runs.jsonl` 58,869;
    `P299-pilot/{spend,units}.jsonl` 21,531; `P299-runs/*.jsonl` (14) 1,184 KB; `P303-pilot/units.jsonl`
    45,346; `P303-runs/{ARCHITECTURE,PACKAGING,spend}.jsonl` 482,026.
- Runtime readers of `docs/v2.6/**`: one, `scripts/docshistory/standing.go:543` (`doc` subcommand default
  `--runs docs/v2.6/plans/P303-runs`). `biome.json:19` excludes `P299-runs` (config, not a reader). No test,
  fixture, eval harness or hook reads any of it: docshistory tests use inline strings; eval data already sits
  in `apps/kira-space/tests/claude/testdata/memory-eval/` (P300). `docs/history-runs/` does not exist now.
- SPEC shape: one `| Phase | Title | Status |` table, rows P294 to P305, long decision prose in cell 2, results
  in Status cells (P300, P301) or in plan Result sections (P294 to P304 except P301, which has no plan).
  `## Process notes` holds no marker line, so no notes unit. Parser handles the table as is.
- Tool blocks v2.6 twice: `checkChapter` refuses `v2.6` (`units.go:63`); `planResultChapters` is
  `{v2.0, v2.5}` (`units.go:111`), so every v2.6 plan result would be dropped.
- D1 defect: result commits truncated two plans. `79f473ba7` cut P299 from 260 to 78 lines, `ec393a963` cut
  P300 from 215 to 41: each replaced everything after the first inline backticked "Result" heading text in
  prose (P299 line 53, P300 line 19) with the result. Effect on the fold: no line starts with the Result
  heading, so `planResult` finds nothing and both phases lose their results (`units`: P299 1,070 chars,
  P300 1,566). Same defect P303 already fixed in `0e33d63e0`. Other plans: current length equals max length
  in history (P295 307 vs 310 is a deliberate edit).
- References to `docs/v2.6` outside the folder (`git grep`): `README.md:262`, `biome.json:19`,
  `docs/PERF.md:1069`, `scripts/docshistory/standing.go:543`,
  `site/src/content/docs/docs/reference/memory-formats.md:12` (front-matter `sources`; check-docs fails on a
  missing path). Plus the `v2.6` guard string in `units.go:63-64`. None in `CLAUDE.md`,
  `DEV_ENVIRONMENT.md`, `ARCHITECTURE.md`, `PACKAGING.md`, `HISTORY.md`, tests, `.githooks/`,
  `docs/pending-*`, `.claude/`.

## 2. Decisions

D1. **Restore P299 and P300 plan bodies before the fold.** Body from the last good commit up to and including
its Result heading line, then the current result text:
`{ git show 79f473ba7^:F | sed -n '1,258p'; sed -n '54,$p' F; }` for F = `P299-docs-history.md`;
`{ git show 1180bb530:G | sed -n '1,205p'; sed -n '20,$p' G; }` for G = `P300-v25-fold.md` (line 205 is
the heading; drop the older "stopped at fold" result after it). Check: line counts 283 and 227 or close,
exactly one Result heading line per file, `units` P299 about 3,100 chars, P300 about 5,500. Also
keeps `git show <pin>:` pointers to these plans whole.

D2. **Tool change, minimal.** Delete the `v2.6` guard in `checkChapter` (regex check stays; the rollover rule
names the chapter, and no chapter folder stays open after its close). Replace the `planResultChapters` map
with a rule: v2.0, and every chapter from v2.5 on (`ch == "v2.0" || !chapterLess(ch, "v2.5")`), so the next
chapter needs no tool edit. `standing.go` `doc` default `--runs` becomes `docs/history-runs` (same scratch dir
as a chapter fold, created per use, deleted after). No new test: a one-line version compare is below the bar.
Free check with the patch (throwaway worktree, base plus D1): 12 phases, 47,134 bytes, no notes unit.

D3. **All non-md data is deleted with the folder, nothing moves.** No runtime reader besides the D2 default.
Ledgers and pilots stay reachable at the pin commit (`git show <pin>:docs/v2.6/plans/P299-runs/spend.jsonl`).

D4. **P305's own row.** The pin commit (last commit touching `docs/v2.6/` before the fold, which the tool
pins every record to) sets the P305 Status cell to `Done. v2.6 folded into HISTORY.md, chapter files
deleted.` and fills this plan's Result with the outcome known before the fold: D1 to D7 as done, unit count,
tool changes, CLAUDE.md wording. The fold distills that, so HISTORY.md carries a closed P305 entry. Measured
numbers (spend, verify, repoint counts) come after the pin: they go into this plan's Result in a later commit
(reachable at the deletion commit's parent), into the `DEV_ENVIRONMENT.md` docshistory bullet (where P300's
cost already sits) and into the final report. HISTORY.md is never hand-edited; a re-pin to get numbers into
the entry would mean a second full fold, rejected.

D5. **Repoint.** Run the tool, then hand-edit what it cannot do right:
- `docs/PERF.md:1069`: `git show <pin12>:docs/v2.6/plans/P294-test-ci-speed.md` (method text, not distilled).
- `memory-formats.md:12`: delete the line (`docs/HISTORY.md` already listed; a HISTORY.md parenthetical breaks
  check-docs).
- `biome.json:19`: delete the `P299-runs` line; keep `!docs/history-runs`.
- `standing.go`, `units.go`: done in D2 (repoint skips `scripts/docshistory/`).
- `README.md:262-263` (normal prose): HISTORY.md distills every finished chapter, v1 to v2.6; an open chapter's
  spec and plans live in `docs/v<n>/`. Drop the `docs/v2.6/` link.
Expect the tool to touch at most PERF and memory-formats; with hand edits done first it reports 0. Either way,
after: `git grep -n 'docs/v2\.6'` empty.

D6. **CLAUDE.md wording** (lean, replace in place, no new section):
- Highest-P rule (lines 151-155): read the highest `P` in `docs/HISTORY.md` and in an open chapter's
  `SPEC.md`, if one exists; drop "every `docs/v*/SPEC.md` still on disk". Add `v2.5 at P271, v2.6 at P294` to
  the start list.
- Rollover rule (156-160) becomes "Closing a chapter folds it": the chapter's last phase runs
  `fold --runs docs/history-runs --out - --jobs 1 --max-usd <cap> <ch>`, reads the verify report, runs
  `repoint`, commits, then `git rm -r docs/<ch>/ docs/history-runs/`. That phase marks its own row Done and
  writes its Result in the commit before the fold, so its entry folds closed. Between chapters no `docs/v*/`
  exists. Opening the next: create `docs/v<new>/SPEC.md` (intro: first `P` is the highest plus one, branch
  name) and `plans/`. Data and never-hand-edit sentences stay.
- "current chapter's `plans/`" phrases (49-50, 105, 127, 134, 256): unchanged; work only runs inside an open
  chapter.

## 3. Cost

Units: 12 phases (P294 to P305), about 49 KB after D1 and P305's result; no notes unit. Rates: P299 mean
0.068 USD per unit (0.018 at 146 chars, 0.249 at 25 KB); P300 1.448 USD real for 27 units (80 KB, 0.054
mean). v2.6 units are larger (mean 4 KB). Expected 0.9 to 1.1 USD real, about 15 min serial. Charged can run
higher: a failed try charges 0.25 (P300: 7 of 34 tries failed, charged 3.20). Worst case: every unit at the
envelope (`estimate`: 0.06 + 0.012 per 1,000 chars, 1.31 USD) plus one failed try per unit (3.00 charged): 4.3
USD. Cap `--max-usd 5`; reaching it stops new units and resume continues.

## 4. Steps and commit groups (one sequential implementer; hooks normal, never `--no-verify`)

Fast checks per commit: `go test ./scripts/docshistory`, `go vet ./scripts/...`. Never edit
`.github/workflows/`. Never push. Never hand-edit `docs/HISTORY.md`. Edit any Result section by replacing the
placeholder line only, then confirm `wc -l` grew (D1's truncation came from a whole-tail replace).

1. `docs(v2.6): restore P299 and P300 plan bodies`: D1 recipe and checks.
2. `feat(docshistory): fold v2.6 and later chapters`: D2. Then `go run ./scripts/docshistory units v2.6`:
   expect 12 phases, P299 and P300 sizes per D1.
3. `docs: closing a chapter folds it`: D6 in `CLAUDE.md`; `DEV_ENVIRONMENT.md` docshistory bullet: `doc`
   defaults to `--runs docs/history-runs`.
4. `docs(v2.6): P305 close` (the pin): D4 Status cell and this plan's Result (pre-fold part). Then
   `git status --porcelain docs/v2.6` empty, `units v2.6` prints this commit.
5. Fold: `go run ./scripts/docshistory fold --runs docs/history-runs --out docs/history-runs/v2.6-verify.md
   --jobs 1 --max-usd 5 --sample 12 v2.6`. Sample 12 covers all 12 phases. Rate limits back off inside the tool
   (charge 0, no try spent). Interrupted or capped: rerun the same command (resumes by input sha). Any
   fallback: rerun with `--retry-fallback`; two fallbacks on one unit, or repeated `Claude Code failed: exit 1`,
   stop and report (P300 Step A precedent), never accept a fallback. Read every `[CHECK]` line by hand.
   Commit `docs: fold v2.6 into HISTORY.md`: `HISTORY.md` plus `docs/history-runs/` (records, ledger,
   verify report).
6. `refactor: repoint docs/v2.6 references`: D5 hand edits, then `repoint --runs docs/history-runs --dry-run
   v2.6`, then without `--dry-run`; review unmatched lines; `render --runs docs/history-runs v2.6` and
   `git diff --exit-code docs/HISTORY.md`.
7. `docs(v2.6): P305 result`: section 6 table into this plan's Result; `DEV_ENVIRONMENT.md` docshistory bullet
   gains `v2.6 (P305): <units> units, <real> USD real, <charged> charged`.
8. `docs: remove v2.6 chapter files`: `git rm -r docs/v2.6 docs/history-runs`. Then section 5.

## 5. Final verification (after group 8; fix anything red in a follow-up commit, same phase)

- Coverage, scripted, must print nothing:
  `for n in $(seq 294 305); do grep -q "^### v2.6 P$n " docs/HISTORY.md || echo "missing P$n"; done`
  and `awk '/<!-- chapter v2.6 -->/,/<!-- \/chapter v2.6 -->/' docs/HISTORY.md | grep -E 'not distilled|Not distilled yet'`.
  Each P294 to P305 block has at least 3 lines (`awk` count per `###` heading).
- Decisions: the verify report (at commit 5) has 0 fallback, 0 pending; every `[CHECK]` resolved by hand, 0
  decisions lost. Spot-read in HISTORY.md one decision per row: P294 CI job graph, P295 publish not draft,
  P296 no comment markers, P297 `kind` fact or rule, P298 trivia dropped, P299 zero-model-free fold replaced by
  distill, P300 repoint skips own files, P301 7 findings fixed, P302 split at IPC, P303 ARCHITECTURE -23.5%,
  P304 PERF trim, P305 closing folds.
- Render idempotent: `render --runs <tmp copy of runs from commit 5> v2.6` twice after deletion, then
  `git diff --exit-code docs/HISTORY.md` (restore runs with `git show <commit5>:docs/history-runs/...` into
  the scratchpad, never into the tree).
- Greps empty: `git grep -n 'docs/v2\.6'`, `git grep -n '"v2\.6"' scripts`; `test ! -e docs/v2.6 -a ! -e
  docs/history-runs`; `units v2.6` still works from the pin (reads git, not the tree).
- Checks: `go test ./scripts/docshistory`, `go vet ./scripts/...`, `go build ./...`, `bun run lint` (biome,
  rules, check-docs), `bun run lint:go` 0 issues, `bun site/scripts/check-docs.ts` 0 violations; hooks passed
  on every commit.

## 6. Final report (implementer fills in the Result section and returns it in its handback)

| Item | Value |
|---|---|
| Commits | one sha per group 1 to 8, plus any fix commits |
| D1 restore | P299 and P300 lines before / after; `units` chars before / after |
| Units: total / ok / fallback / retried | |
| Spend | real (sum ok `costUsd`), charged (ledger), cap 5, projected 1.0 / worst 4.3 |
| HISTORY.md bytes, lines before / after | |
| Verify | sampled, `[CHECK]` lines, decisions lost, coverage script output |
| Repoint | tool refs and files, unmatched, hand edits per D5 |
| Deleted | tracked files under `docs/v2.6` and `docs/history-runs` |
| Render | idempotent yes/no |
| Greps, checks, hooks | per section 5 |
| Deviations | |

## Result

Done. Restored P299 and P300 plan bodies (283 and 227 lines; `units` P299 3,096 chars, P300 5,498).
`docshistory`: `v2.6` guard removed from `checkChapter`; `planResultChapter` rule (v2.0, v2.5 and later) replaces
the map; `doc` default `--runs` is `docs/history-runs`. `units v2.6`: 12 phases, 47,160 bytes, no notes unit.
CLAUDE.md: highest-P rule reads open chapter `SPEC.md` only, start list gains v2.5 and v2.6, rollover rule now
"Closing a chapter folds it". Measured after the pin:
- Fold: 12 units ok, 0 fallback, 0 pending. 13 tries: P301 reran once after its first record dropped "7 findings fixed".
- Spend: 0.776 USD real, 0.776 USD charged (no failed tries), cap 5.
- HISTORY.md: 962,950 B / 6,474 lines before, 985,781 B / 6,641 lines after repoint render.
- Repoint: 9 references in 3 files, unmatched only under `docs/history-runs/`. Hand edits: README, biome.json,
  memory-formats.md, PERF.md. Tool rewrote the PERF line wrongly; reverted by hand.
- Render idempotent. Commits: c98c6128f, f2ae2a5d9, 61719dd82, ca2fa17c1 (pin), a6f3c2de4 (fold), 6ce85f428 (repoint).
- Deviation: `git grep docs/v2.6` keeps HISTORY.md tool-generated lines and the PERF `git show` pointer.
