# P298 plan: extract and merge drop run trivia

SPEC row P298 (`docs/v2.6/SPEC.md`). Base: `da95cca3` (v2.6). Planner: Opus. Implementer: one sequential Sonnet
subagent. No split: one prompt change feeds every measurement, and each measurement step reads the one before.

Discovery: `codegraph_explore` over `memory.import.extract.system memory.merge.system memory.merge.rules
memory.kinds`, `validate.go checkprompts budget`, `RunIngest Distiller Distill`; reads of
`internal/llmprompts/registry.go` (hygiene, kinds, extract, merge, finalize), `cmd/checkprompts/style.go`,
`cmd/promptsizes`, `testdata/budget.tsv`, `docs/v2.5/plans/P289-terse-prompts.md` §3 and §5, the P297 plan,
`P299-pilot/*`, P285 corpus manifest and `golden.jsonl`, `round-p297-01/scores.json`, `memoryflow/{import,
distill,ingest,llmprompts}_test.go` prompt matchers, `docs/DEV_ENVIRONMENT.md` real `claude` and eval rows.

## 1. Current state (verified)

- Distill and import share `memory.import.extract.system` (per chunk) and `memory.merge.rules` (steps 1 to 3,
  included by `memory.merge.system` for distill and `memory.import.finalize.system` for import). Gate and verify
  are not on the trivia path.
- Extract skip list already names `process chatter (who ran what, commit and phase lists, run results, spend)`.
  Merge step 3 drops `trivia` with no definition. Neither names pushes, branch handling, sandbox limits, flaky
  tests, harness gaps, checks left to the user.
- Pilot (`P299-pilot/units.jsonl`, tree `08394d55`; no code change since): 110 lines over 10 units. Manual read
  (section 4): 11 trivia lines (P212 Part 1: 1, P90: 1, P98: 1, P131 Part 2: 8), 8 decision-marker lines,
  3 guard lines (incident lessons that hold beyond the run).
- Pilot inputs: the planner's scratch builder wrote byte-identical unit texts; all 10 match `inputSha256`. Copied to
  `docs/v2.6/plans/P298-pilot/inputs/<slug>.md` in the plan commit. Rebuild check: `sha256sum` of each equals
  `units.jsonl` `inputSha256`. P299's `units` subcommand must reproduce the same bytes (P299 D3 shape).
- Eval corpus has `doc-devenv-claude` (holdout, `docs/DEV_ENVIRONMENT.md` section "Real `claude` tests", 5.5 KB,
  36 essential facts): a document whose subject is the environment. `plan-p257` essential g-fact "Contract fixtures
  ... regenerated via `KIRA_CONTRACT=write`" is a change the phase makes, worded like run mechanics.
- Flow fakes match system prompts by substring: `extract facts and rules`, `merge the facts extracted from one
  input`, `cross-check facts extracted`. Opening lines stay unchanged.

## 2. Decisions

### D1. One new fragment, included by extract and both merge prompts

New `memory.runTrivia` (KindFragment, `NoVars`, title/purpose/usedBy keys like `memory.kinds`). Included after
`{{template "memory.kinds"}}` in `memory.import.extract.system`, `memory.merge.system`,
`memory.import.finalize.system`; each lists it in `RequiredFragments`. Default (implementer may tighten words, not
meaning; checkprompts style rules apply):

```
Run trivia is never a memory: a note on how one run of the work went, not on what the system is or what was decided.
- Drop: who ran what; commit, push and branch mechanics, a refused or conflicting push included; a sandbox or container limit met during the run; a flaky, timed-out or rerun test; a fixture or harness gap named only to explain a skipped check; a check left for the user; spend.
- Keep: what the work built or changed, tests and fixtures included; a decision with its reason; a constraint; a design choice and its consequence; how the system works.
- Test: still true and useful once this run is forgotten? Keep. True only of this run? Drop.
- A lesson from an incident that holds for later work is a rule: "Commit with an explicit pathspec in a shared checkout, because another session's staged files land in a bare commit."
- When the document's subject is the environment, tooling or a process (a runbook, a setup or test guide), its limits and procedures are the content: keep them.
```

Per prompt:
- Extract skip bullet: `time-bound chatter, process chatter (who ran what, commit and phase lists, run results,
  spend)` becomes `time-bound chatter, run trivia (see above), commit and phase lists`. One term per concept: "run
  trivia" replaces "process chatter" (CLAUDE.md); who ran what and spend move into the fragment; run results stay
  covered by the kinds table bullet.
- `memory.merge.rules` step 3: `Drop a fact that is not a memory (see above), trivia, time-bound or navigation`
  becomes `Drop a fact that is not a memory or is run trivia (see above), other trivia, time-bound or navigation`.
- Verify, gate, reconcile: unchanged.

Why both extract and merge: extract is the cheap first filter (fewer facts into verify and merge, smaller merge
input), but it reads one chunk; merge reads every fact of the document with its section and document title, the
best view of the document's subject (D3), and is the last step before output in both modes. One fragment keeps one
definition; rejected: two hand-written copies (drift), merge only (trivia still costs verify and merge tokens and
competes in the merge's line budget), extract only (no whole-document view).

Why not the gate (`memory.kinds` is shared with it): the SPEC row names extract and merge; a gate item comes from
an agent that chose to store it, and a gate change needs its own measured round. Not in scope; a follow-up SPEC row
only on the user's ask.

### D2. Guard against over-dropping

- Standing test, stated in the fragment: trivia describes how one run was executed; everything that says what the
  system is, what was decided and why, or what the work changed stays. The `Test:` line makes that a yes/no check.
- Incident lessons: the fragment says a lesson that holds for later work is a rule, with the pathspec example (the
  pilot's own guard line, P131 Part 2 line 12). The merge then returns it with kind `rule` (P297 kinds).
- "Fixtures included" in the Keep line protects a phase's own test or fixture changes (`plan-p257` g-fact).

### D3. Documents whose subject is the environment

The last fragment line keeps limits and procedures when the document's subject is the environment, tooling or a
process. The model judges subject from what both prompts already receive: `document` path and title, `section` /
`headingPath`. A phase result (`# v2.0 P131 Part 2`) is about the work, so a sandbox limit there is trivia; a
`DEV_ENVIRONMENT.md` section is about the environment, so the same limit is content. Rejected: a caller flag or a
path list (import and distill callers do not know a document's subject); dropping environment facts everywhere (loses runbooks, contradicts D2). Measured by the holdout round (section 3).

### D4. Budget, check tools, coupled tests

- `testdata/budget.tsv`: add `memory.runTrivia`; raise `memory.import.extract.system`, `memory.merge.system`,
  `memory.import.finalize.system`, `memory.merge.rules` to their new rendered sizes (`go run
  ./internal/llmprompts/cmd/promptsizes -prefix memory.`), a visible ratchet. Never pad.
- `go run ./internal/llmprompts/cmd/checkprompts` clean (filler words, budget). `promptsizes -compare` against a
  snapshot taken before the edit: no protected-token loss except `process chatter` (state it in the commit body).
- i18n `llmPrompts.entry.memoryRunTrivia.{title,description,usedBy.body}` (title `Run trivia`); `memoryKinds` and
  `memoryMergeRules` copy unchanged unless it names the drop list (check). Catalog `--unused` clean.
- Contract `apps/kira-space/tests/contract/llm-prompts.json`: rewrite with `KIRA_CONTRACT=write`; UI spec
  `settings-llm-prompts` reruns. `go test ./internal/llmprompts -run TestGolden` (no golden covers these ids).
- Flow fakes: opening lines unchanged, so `memoryflow` passes as is; run the package. Eval graders
  (`P285-corpus/judge-*.md`, `golden.jsonl`): unchanged. The golden already excludes process chatter; a regraded
  golden would break every baseline comparison.
- Unit tests: none (prompt text; CLAUDE.md test bar). No IPC change, so no flow or UI spec pair.
- Real `claude` (proves the wording steers; opt-in): new `TestMemoryDistillTrivia` in
  `apps/kira-space/tests/claude/memory_test.go`, two bridge distill calls. (a) A phase-result text (H1 `# P900
  result`) with a design decision plus reason, a refused non-fast-forward push and re-branch, a flaky spec rerun, a
  check left for the user, and the pathspec lesson: assert no line matches `(?i)non-fast-forward|flak|left (to|for)
  the user`, one line holds `pathspec`, the decision's identifier is in a line. (b) An environment text (H1 `#
  Sandbox setup`): `The sandbox has no display, so run GUI checks through the Playwright ui project.` plus one
  more limit: assert a line holds `display`. Add the name to the "Memory import and ingest" and prompt-registry
  rows' `-run` lists in `docs/DEV_ENVIRONMENT.md`.

## 3. Measurement (spend cap 6.00 USD, stop rule at the end)

(a) Pilot re-run, `docs/v2.6/plans/P298-pilot/`:
- Binary: `go build -tags server -o <scratch>/kira-space ./apps/kira-space` at the prompt commit.
- Driver (scratch Bun script, not committed; same as the pilot's): per unit spawn `<bin> memory-mcp` with fresh temp
  `KIRA_MEMORY_HOME` and `KIRA_SPACE_HOME` (default prompts), newline JSON-RPC over stdio: `initialize`,
  `notifications/initialized`, `tools/call` `ingest_files` `{distill: true, text: <inputs/slug.md>}`; read
  `structuredContent.lines[].text`, `costUsd`, `unresolved`. Append one line per call to `runs.jsonl` (`slug, run,
  try, ok, error, costUsd, wallMs, lines`); skip a `(slug, run)` already `ok` (resume). A failed call retries once
  after 30 s.
- Runs: `after` on all 10 units; `after2` on the 3 largest (`v2.0-p131-part-2`, `v1.9-p98`, `v1.8-p90`, where
  trivia sits) for variance. Before = the stored pilot outputs (same prompts, same inputs by hash); no rerun.
- Estimate 1.10 USD (pilot 0.69 for 10, 0.41 for the 3 largest).

(b) Eval, P289 subset harness (`bun run eval:memory`, test binary built with `go test -c` before each round so a tree
edit cannot change a round; ledger `spend-p298.jsonl`; `KIRA_EVAL_CAP_USD=2 KIRA_EVAL_PHASE_CAP_USD=6`: the harness
reserves 2 USD, so the phase cap is planned ledger spend plus 2, as P297 needed):
- `round-p298-00h`: `KIRA_EVAL_SET=holdout KIRA_EVAL_ONLY=doc-devenv-claude`, run before the prompt commit
  (current prompts). About 0.4 USD.
- `round-p298-01`: `KIRA_EVAL_ONLY=plan-p257,spec-chunk-go,doc-arch-prompts,cmt-runner-go,json-ade-errors`. About
  1.5 USD. `round-p298-01h`: holdout source as 00h, new prompts. About 0.4 USD.
- `C_store`, `C_fact`: `KIRA_EVAL_MODE=footprint KIRA_EVAL_ROUNDS=round-p289-00a,round-p289-00b,round-p297-01,
  round-p298-01` (free).
- References: P289 mean (`R_ess` 0.871, `R_all` 0.712, `P` 0.635, unsupported 0.006, `C_fact` 0.443) and
  `round-p297-01` (0.899, 0.721, 0.521, 0.014, 0.444; `C_store` 0.654). Bands from P289 §5.
- Pass: `R_ess` ≥ 0.879 (p297 − 0.020) and ≥ 0.851; `R_all` ≥ 0.701 and ≥ 0.692; `P` ≥ 0.456 (p297 − 0.065,
  report against the P289 floor 0.570 too); unsupported ≤ 0.024; `C_store` reported (expect ≤ p297, fewer stored
  facts). Watch item: `plan-p257` "Contract fixtures ... regenerated" stays covered (round grades).
- Holdout guard: `R_ess(01h)` ≥ `R_ess(00h)` − 0.03 (about 1 of 36 facts). Worse: read its missed essential list;
  an environment fact missed at extract means D3 over-drops.
- Out of band: one confirmation rerun (`01b` or `01hb`); the mean decides.

(c) Real `claude` rows (`docs/DEV_ENVIRONMENT.md`, append `-count=1`): the prompt-registry row (covers gate,
memory MCP, import, ingest, distill, ADE, smart scripts) with `TestMemoryDistillTrivia` added, plus `bun run
test:claude:studio`. About 0.35 USD.

Failure handling: a lost marker or guard line, a failed eval band (confirmed) or the holdout guard failing goes back
to the D1 wording, same phase: one reword iteration, then rerun only the affected measurement. Still failing after
it: stop and report to the orchestrator with stage evidence (`MissEssExtract` vs `MissEssFinalize`, lost lines).

Spend: planned 3.75 USD, worst case with one reword and one confirmation 5.9. Cap 6.00 USD real reported spend
(pilot `runs.jsonl` `costUsd`, eval ledger, row meters), a failed call with no reported cost counted 0.25. Stop rule:
before each paid step, if spent plus the step's estimate exceeds 6.00, do not start it; commit what landed and
report.

## 4. Counting trivia lines

- Flag regex (case-insensitive, word-bounded), recorded per row as `flag`: `push(ed)?|non-fast-forward|
  cherry-pick\w*|rebas\w*|branch\w*|sandbox|container|display|proxy|flak\w*|intermittent\w*|time(d)? ?outs?|
  re-?run\w*|retr(y|ied)|fixture\w*|harness|left (to|for) the user|live-check\w*|not (live-)?checked|not verified|
  regenerat\w*|baselines?|pathspec|no-verify|workers?=1|worker contention|git (add|stash|commit)`.
- The regex only makes the read reproducible (it flags false hits like `request timeout 0`). Every line of every
  run is read by hand and classed: `trivia` (D1 Drop list, fails the D1 test), `guard` (incident lesson or durable
  environment rule), `marker` (matches the P299 D3 marker list: decision, decided, user override, declined,
  rejected, instead of, rather than, supersed*, reverted, renumbered), `keep`. Unsure counts as `trivia` (against
  the change).
- `P298-pilot/lines.tsv` (committed with this plan) holds the planner's `before` classes: trivia
  `v2.2-p212-part-1` 7; `v1.8-p90` 12; `v1.9-p98` 13; `v2.0-p131-part-2` 18, 19, 21, 24, 25, 28, 30, 31. Guard:
  `v2.0-p131-part-2` 12 (pathspec), 29 (scratch specs inside test trees), `v1.9-p98` 14 (never unset HTTPS_PROXY).
- The implementer appends `after` and `after2` rows (same columns plus `flag`) and fills a `match` column on every
  `before` marker and guard row: the after line index carrying it (reworded or merged is fine) or `lost`.
- Pass: 0 lost marker or guard lines in `after` (a loss in `after` only, recovered in `after2` or a single unit rerun,
  is variance: record it); trivia in `after` ≤ 1 over all 10 units (target 0). Report `keep` lines with no
  counterpart as a count (variance, flagged above 10 %).

## 5. Commit groups (Conventional Commits, in order; fast checks per commit, hook clean, never `--no-verify`)

1. `test(memory): P298 holdout eval baseline`: `round-p298-00h` outputs, `spend-p298.jsonl`.
2. `feat(memory): extract and merge drop run trivia`: D1 fragment and includes, extract and merge rules text,
   i18n, `budget.tsv`, contract rewrite. Checks: `go build ./...`, `go test ./internal/llmprompts/...
   ./internal/memory/...`, `CGO_ENABLED=1 go test ./apps/kira-space/internal/flows/memoryflow/
   ./apps/kira-space/internal/flows/llmpromptsflow/`, `bun run lint`, `bun run typecheck`, UI spec
   `settings-llm-prompts`.
3. `test(memory): real claude distill drops run trivia`: `TestMemoryDistillTrivia`, DEV_ENVIRONMENT row lists.
   `bun run lint:claude`.
4. `test(memory): P298 pilot re-run`: `P298-pilot/runs.jsonl`, `lines.tsv` after rows and matches.
5. `test(memory): P298 eval rounds`: `round-p298-01`, `01h` (and any confirmation), ledger.
6. Any reword: `fix(memory): run trivia wording keeps <what>`, then the rerun outputs as their own commit.
7. Real `claude` rows run here (no commit unless a fix is needed).
8. `docs: memory drops run trivia`: `docs/ARCHITECTURE.md` kinds bullet (~4938) names `memory.runTrivia` and its
   includers plus the environment-subject rule; eval line gains the P298 rounds; `docs/DEV_ENVIRONMENT.md` spend
   line (rows, rounds, ledger); site `space/memory.mdx` distill paragraph only if it lists what distill drops.
9. `docs(v2.6): P298 result`: result section here, SPEC row status `Done`.

## 6. Out of scope

Gate, verify and reconcile prompts; a caller flag for document subject; regrading the eval golden; a post-filter;
running P299's full pass; changing stored memories.

## 7. Report (result section and the handback to the orchestrator, for the user before P299)

Table per pilot unit: trivia before / after / after2, marker and guard lines before, lost (must be 0), lines before
/ after, USD. Eval table: `R_ess`, `R_all`, `P`, unsupported, `C_fact`, `C_store` for P289 mean, `round-p297-01`,
`round-p298-01` (and confirmation), verdict per band; holdout `00h` vs `01h` `R_ess` and missed facts. Real rows:
pass or fail per test. Spend: pilot, eval, rows, total against 6.00. Prompt sizes before/after per changed id.

## Result

Status: not Done. Pass line "trivia in `after` at most 1" fails after the one reword. SPEC row stays Todo. Groups 8 (docs) skipped: they describe a shipped feature.

Commits: `14c4a7e2` holdout baseline, `77a52c86` feat (first wording), `1b9cf695` real claude test, pilot run 1, `2714f51d` reword, pilot run 2, `be0e8d6c` eval rounds. Wording in tree is the reworded fragment.

Deviation: eval rounds ran once, on the reworded prompts only. Reason: first pilot already failed; rerunning eval for both wordings would pass the 6.00 USD cap. `llmpromptsflow` `TestList` count was stale (113 real, test said 115, pre-existing); set to 114.

### Pilot (`P298-pilot/lines.tsv`, `runs.jsonl`). Runs: `after`/`after2` first wording, `rw-after`/`rw-after2` reworded.

Trivia lines over 10 units: before 11, after 7, rw-after 4. Over the 3 rerun units: after2 7, rw-after2 6.

| unit | trivia before / after / after2 / rw-after / rw-after2 | marker+guard before | lines before / after / rw-after | USD after / rw-after |
|---|---|---|---|---|
| v1-p16 | 0 / 0 / - / 0 / - | 1 | 5 / 5 / 7 | 0.021 / 0.037 |
| v1.1-p16 | 0 / 0 / - / 0 / - | 0 | 3 / 4 / 4 | 0.020 / 0.029 |
| v1.2-p15 | 0 / 0 / - / 0 / - | 2 | 12 / 12 / 13 | 0.062 / 0.066 |
| v1.3-g5 | 0 / 0 / - / 0 / - | 0 | 1 / 1 / 1 | 0.012 / 0.012 |
| v1.7-m1 | 0 / 0 / - / 0 / - | 0 | 11 / 9 / 11 | 0.052 / 0.058 |
| v1.8-p90 | 1 / 1 / 2 / 1 / 1 | 1 | 13 / 12 / 14 | 0.057 / 0.071 |
| v1.9-p98 | 1 / 1 / 2 / 0 / 1 | 3 | 17 / 18 / 16 | 0.118 / 0.080 |
| v2.0-p131-part-2 | 8 / 3 / 3 / 3 / 4 | 3 | 32 / 28 / 27 | 0.188 / 0.207 |
| v2.0-p181 | 0 / 0 / - / 0 / - | 1 | 6 / 7 / 8 | 0.053 / 0.045 |
| v2.2-p212-part-1 | 1 / 2 / - / 0 / - | 0 | 10 / 10 / 8 | 0.055 / 0.044 |

Markers and guards (11 before rows): lost in `after` 0 (one partial: P181 line 5 lost its ARCHITECTURE.md pointer, kept the plan pointer). Lost in `rw-after` 2: P131 Part 2 pathspec guard, and the P98 "instead of" reason (partial at line 3); both back in `rw-after2`. Variance by the plan's rule, but the strict pass line (0 lost in `after`) fails for the reword.

Trivia still left, reworded run: P90 "container has no display" (1); P131 Part 2 `fakeGraphHost.ts` token, `capabilities.write` and `graphStreamFixture.ts` fixture gaps (3). The model keeps harness and fixture facts as test knowledge even with "what a fixture, mock or harness does not cover" in Drop; the planner classes them trivia, unsure counts trivia. The reword removed the push, flake, live-check, baseline, real-phone and install lines.

### Eval (ledger `spend-p298.jsonl`, reworded prompts)

| round | R_ess | R_all | P | unsupported | C_fact | C_store |
|---|---|---|---|---|---|---|
| P289 mean (00a, 00b) | 0.871 | 0.712 | 0.635 | 0.006 | 0.443 | 0.658 / 0.702 |
| p297-01 | 0.899 | 0.721 | 0.521 | 0.014 | 0.444 | 0.654 |
| p298-01 | 0.903 | 0.769 | 0.562 | 0.000 | 0.446 | 0.651 |

Bands: R_ess pass (0.903 >= 0.879), R_all pass (0.769 >= 0.701), unsupported pass, P pass (0.562 >= 0.456). P vs p297: up 0.041. P vs P289 mean: down 0.073; under the P289 floor 0.570 by 0.008. `plan-p257` g53 (contract fixtures regenerated) not covered in both p297-01 and p298-01 (extracted, lost at finalize): not a new loss. Stage misses p298-01: MissEssExtract 3, MissEssFinalize 4 (p297-01: 4, 2). No confirmation round.

Holdout `doc-devenv-claude`: 00h R_ess 0.958 (P 0.769, 26 stored), 01h R_ess 0.958 (P 0.778, 27 stored). Guard holds, no environment fact lost.

### Real `claude` rows

Prompt-registry row with `TestMemoryDistillTrivia` (`-count=1`): all pass (gate, MCP, import, ingest, distill, bridge, trivia, ADE, smart scripts, sandbox). `test:claude:studio`: pass. Meter 0.0775 USD (`claude -p` only).

### Prompt sizes (chars, rendered)

| id | before | after |
|---|---|---|
| memory.runTrivia | - | 1194 |
| memory.import.extract.system | 2852 | 4020 |
| memory.merge.system | 2605 | 3824 |
| memory.import.finalize.system | 3622 | 4841 |
| memory.merge.rules | 743 | 766 |

### Spend (cap 6.00 USD)

Eval ledger 2.649 (00h 0.532, 01 1.592, 01h 0.525); pilot 1.937 (first 0.936, reword 1.000); `TestMemoryDistillTrivia` first run 0.036; real rows about 0.15 (meter 0.0775 plus nested calls, estimated). Total about 4.8 USD.

### Open for the orchestrator

Pass line fails on trivia (4 over 10 units after one reword, target at most 1). All 4 are test-harness or sandbox-limit lines. Options, user's call: accept harness/fixture facts as keepable and re-class them; a stronger Drop wording (risks the pathspec guard, lost once already); a post-filter (out of scope here).
