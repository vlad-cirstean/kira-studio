# P289 plan: terse LLM prompts

Ask (SPEC row P289): rewrite every llmprompts registry default (system prompts, messages, suffixes,
fragments, MCP instructions, tool and arg descriptions, tool results) in `CLAUDE.md` Communication style:
fragments, no filler, imperative, one idea per sentence, same meaning. Keep untouched: template variables,
schema names and fields, error strings, negations, numbers, tool and field names. Measure per prompt:
size before/after (runes/3) and behaviour parity (real `claude` rows, P285 eval on a subset, cap 15 USD).
A prompt that regresses is reverted and listed. Guards stay green; defaults only, overrides untouched.
Use `distill` (P285 Part 2) to condense. Process: this plan, one sequential Sonnet implementer, serial
test-and-fix with real `claude` rows, close-out.

Base: `v2.0` at `7eec31df7`. Discovery through `codegraph_explore` (root index; `apps/kira-space` nested
index): `Entry`/`entry`/`define`/`arg`, `Bound.List`/`Preview`, `Store.Validate`/`texts`, every
`Ade*`/`Headless*`/`RunResumeLine`/`Dbmcp*`/`Memory*` registry var, `checkprompts` (`phrases`, `copies`,
`goProblems`), `fakeagent` (`PromptRule`, `startHeadless`, `answerPrompt`), `llmpromptsflow.TestList`,
`importer.Distiller`/`Distill`/`distillCall`/`DistillRequest`/`distillMode`, `mcpserver.addDistillTool`,
memory bridge. Targeted reads (not indexed or not code): P285 Part 2 plan, P285 report Parts 2 and 3,
P286 plan §6, `golden_test.go`, `promptsizes`, eval harness env knobs (`tests/claude/memory_eval_test.go`),
corpus manifest, `spend-p3.jsonl`, DEV_ENVIRONMENT real `claude` rows, ARCHITECTURE "App prompts (P271)",
site `reference/prompts.md`, `reference/mcp-tools.md`, grep of tests and fixtures holding prompt text.

## 1. Decisions (final)

- D1. Scope = every registry entry present when the implementer starts (re-derived with `promptsizes`),
  including P286-P288 entries and the texts P285 Part 2 left out (`memory.mcp.store.*`,
  `memory.mcp.ingest.*`, `memory.mcp.semantic.*`, `memory.mcp.remember.message`). User overrides,
  `llm-prompts.json` and `store.go` untouched; an override made against an old default shows the existing
  `defaultChanged` flag. No entry added or removed: prompt counts (Space 102, Studio 34 at base, plus
  whatever P286-P288 add) stay equal to the count at start.
- D2. Verbatim, no rewrite: `memory.dataHygiene` (injection defence); the secrets clause in gate and
  finalize; `dbmcp.instructions` permissions sentence and masked-columns sentence (privacy semantics);
  error strings; every `{{...}}` action; fakeagent match keys `gatekeeper of a long-term memory`,
  `reconcile new facts`, `extract durable facts`, `cross-check facts extracted`, `distill text into terse
  atomic lines` (memoryflow constants). Why: safety text stays normal prose (`CLAUDE.md`); keys keep
  flows green without fixture churn.
- D3. Already terse, audit only (rewrite only what the style check flags): `memory.distill.system`,
  `memory.reconcile.system`, `memory.import.finalize.system`, `memory.import.verify.system` (P285 Part 2
  rewrites, measured), P286 entries (written terse per its plan §6). Why: further cuts there buy little
  and each needs a paid eval round.
- D4. `memory.gate.system`: trim-only pass. Cut articles, filler and hedges inside each sentence; keep
  every sentence, its order and every clause. No merging, no splitting into bullets. Why: P285 Part 2's
  restructured terse gate lost `R_all` (0.658 vs floor 0.693) and was reverted; a word-level trim keeps
  the rule structure the gate needs.
- D5. `memory.import.extract.system`: starting text is the current registry default (P285 result after
  the fallback). Full terse rewrite. Measured with the gate in the same eval round (§5).
- D6. Method per entry: raw default ≥ 150 chars and not D2/D3: `distill` draft (mode `instructions`),
  then human-rule pass (§3) on the draft against the original. Shorter entries: human-rule pass only
  (distill overhead exceeds the gain; most are one fragment already). Templated entries
  (`ade.rebase.prompt`, `ade.step.prompt`, `ade.stage.message`, `ade.start.message`, `ade.review.message`,
  `headless.finishStep.suffix`, `memory.mcp.remember.message`, any P286-P288 template): distill draft is
  guidance only; edit literal text between actions by hand, never an action.
- D7. Distill runs through a new dev command `internal/llmprompts/cmd/promptdistill`, not through a
  `claude` MCP session. It calls `importer.Distiller{Runner: memory.NewCLIRunner(), Prompts:
  llmprompts.Defaults()}.Distill(ctx, DistillRequest{Text: <raw default>, Mode: ModeInstructions})`,
  the same core as the MCP tool. Flags: `-ids a,b` or `-prefix p`, `-min 150` (raw chars), `-out
  <jsonl>`, `-cap <USD>`. Appends one JSON line per id `{id, chars, lines, costUsd}`; skips ids already in
  `-out` (resumable); stops before an id once the file's summed `costUsd` reaches `-cap`. Opt-in, spends
  tokens, never in hooks or CI. Why: `distill` is the SPEC's tool; a command makes the drafts reproducible
  and committed; the implementer has no `kira-memory` MCP server attached.
- D8. `promptsizes` gains two flags. `-snapshot <file>` writes `{id: {default, chars, tokens}}` (raw
  default plus rendered-example size, as today). `-compare <file>` prints per id before/after chars and
  tokens and change %, then the protected-token check (D9); exit 1 on any unexplained loss. Why: one tool
  for the SPEC's per-prompt before/after table and the "keep untouched" rule.
- D9. Protected-token check, per changed id, old default against new: (a) the ordered list of `{{...}}`
  actions is identical; (b) every number, backticked span, double-quoted span, identifier with `_`, `.`
  between letters or an inner capital, and every tool or arg name of the registry is still present;
  (c) per negation word (`not` incl. `n't`, `never`, `no`, `only`, `except`) the count does not drop. An
  intended loss (rare: a duplicated number, a rephrased `not` to `never`) is listed in
  `docs/v2.5/plans/P289-runs/allowed-losses.tsv` (`id`, token, why), which `-compare` reads.
- D10. Style and size guard in `checkprompts` (already in `bun run lint`), landed after the rewrite:
  - Style: a default fails when, outside `{{...}}` and backticks, it holds a filler term: `please`,
    `just`, `simply`, `basically`, `actually`, `really`, `very`, `of course`, `certainly`, `kindly`,
    `in order to`, `make sure`, `note that`, `it is important`, `you should`, `feel free`, or `→`.
    Message: `<id>: filler "<term>" (CLAUDE.md Communication style)`.
  - Budget: `internal/llmprompts/testdata/budget.tsv` (`id<TAB>max runes`, rendered example via
    `RenderExample`, as `promptsizes`). Fails when an entry exceeds its line, has no line, or a line names
    no entry. Message for a missing line: `<id>: no size budget; write it terse and add a line to
    internal/llmprompts/testdata/budget.tsv`. Lines equal the after sizes (a ratchet: growth is a visible
    diff).
  Why: keeps later prompts (P287, P288, anything after) terse without a human remembering; the SPEC
  allows "lint/check rule or budget", both are cheap.
- D11. Golden files (`internal/llmprompts/testdata/golden`) are regenerated from the new defaults:
  `golden_test.go` gains `-update` (writes the files), its comment changes from "pre-registry
  composition" to "current defaults; regenerate with -update after an intended default change". Diff of
  each regenerated file is reviewed against D9.
- D12. Behaviour parity: memory groups by the P285 eval subset (§5); every other group by its real
  `claude` rows (§6). A row failure gets one rerun; failing twice, swap the old text back for the suspect
  id (by `KIRA_*` override where the row supports it, else a scratch commit) and rerun; passing with the
  old text means revert that id. Ids no row exercises get D9 plus a rendered review only, listed as such
  in the results.
- D13. Revert path: old text from `docs/v2.5/plans/P289-runs/before.json` (D8 snapshot at base). Revert
  = restore that default, its golden and budget line, in a `revert(llmprompts): <id> to prior text`
  commit; list in results with round or row and metric.
- D14. One sequential Sonnet implementer. Why: every group edits `registry.go`, goldens and
  `budget.tsv`; memory eval rounds depend on order.

## 2. Inventory (base `7eec31df7`, rendered example, chars and `ceil(runes/3)`)

126 entries, 30567 chars, 10223 tok. Entries ≥ 150 chars listed; the rest by count.

| group | entries | chars | tok | rows (§6) |
|---|---|---|---|---|
| G1 memory pipeline systems | 7 | 12663 | 4222 | eval subset, gate, import, ingest, distill |
| G2 memory MCP instructions, tools, args, remember description | 48 | 6102 | 2046 | memory MCP, eval subset |
| G3 memory tool results, remember message | 7 | 1215 | 407 | memory MCP, eval subset |
| G4 headless (suffixes, kira-ade tools, args, ack) | 30 | 3849 | 1293 | ADE, smart scripts (both apps) |
| G5 ADE messages, lines, `run.resume.line` | 10 | 2181 | 731 | ADE, smart resume (both apps) |
| G6 DB MCP (Studio) | 24 | 4557 | 1524 | Studio suite |

| id | chars | tok | method |
|---|---|---|---|
| memory.dataHygiene | 177 | 59 | verbatim (D2) |
| memory.gate.system | 3384 | 1128 | distill + trim-only (D4) |
| memory.import.extract.system | 2025 | 675 | distill + rewrite (D5) |
| memory.import.finalize.system | 2615 | 872 | audit (D3) |
| memory.distill.system | 1763 | 588 | audit (D3) |
| memory.reconcile.system | 1344 | 448 | audit (D3) |
| memory.import.verify.system | 1355 | 452 | audit (D3) |
| memory.mcp.instructions | 1670 | 557 | distill + rewrite |
| memory.mcp.tool.store_memory | 493 | 165 | distill + rewrite |
| memory.mcp.tool.ingest_files | 359 | 120 | distill + rewrite |
| memory.mcp.tool.ingest_status | 260 | 87 | distill + rewrite |
| memory.mcp.tool.search_memories | 229 | 77 | distill + rewrite |
| memory.mcp.tool.memory_context | 171 | 57 | distill + rewrite |
| memory.mcp.remember.message | 470 | 157 | template (D6) |
| memory.mcp.ingest.awaiting | 221 | 74 | template (D6) |
| headless.rebase.reportSuffix | 525 | 175 | distill + rewrite |
| headless.tool.git | 335 | 112 | distill + rewrite |
| headless.space.instructions | 300 | 100 | distill + rewrite |
| headless.space.suffix | 285 | 95 | distill + rewrite |
| headless.finishStep.suffix | 261 | 87 | template (D6) |
| headless.script.reportSuffix | 243 | 81 | distill + rewrite |
| headless.tool.run_outcome | 191 | 64 | distill + rewrite |
| headless.tool.declare_repos | 169 | 57 | distill + rewrite |
| headless.tool.request_branch | 169 | 57 | distill + rewrite |
| ade.step.prompt | 476 | 159 | template (D6) |
| ade.rebase.prompt | 350 | 117 | template (D6) |
| ade.review.message | 353 | 118 | template (D6) |
| ade.stage.message | 264 | 88 | template (D6) |
| ade.start.message | 172 | 58 | template (D6) |
| run.resume.line | 274 | 92 | distill + rewrite |
| dbmcp.instructions | 1484 | 495 | distill + rewrite, D2 sentences verbatim |
| dbmcp.tool.run_query | 798 | 266 | distill + rewrite |
| dbmcp.tool.explain_query | 369 | 123 | distill + rewrite |
| dbmcp.tool.list_children | 185 | 62 | distill + rewrite |
| dbmcp.tool.explain_query.arg.path | 151 | 51 | distill + rewrite |
| dbmcp.tool.run_query.arg.path | 150 | 50 | distill + rewrite |
| 90 entries under 150 chars (args, short tools, lines, acks) | 6527 | about 2200 | human-rule pass |

Target, not a gate: 25 % fewer chars over rewritten (non-D2, non-D3) entries. Never pad; never shorten
D2 text, a negation or a number.

## 3. Human-rule pass (applies to every rewritten default)

- Fragments fine. Imperative. One rule per sentence or line, at most about 20 words.
- Cut articles, filler, hedges, pleasantries, restatements, "you"/"your" where the imperative carries it.
- Short word over long phrase. No invented abbreviations, no arrows.
- Keep: D2 text, `{{...}}` actions, schema and field names, tool and arg names, enum values, numbers,
  units, negations, error strings, quoted examples a rule needs, "because" clauses the rule needs to be
  applied right (P285 rationale rule: drop only when the rule alone makes it obvious).
- System prompts with a reply schema: one rule per line (P285 Part 2 shape), except gate (D4).
- Tool and arg descriptions: what it does, when to call it, limits. No marketing, no repetition of the
  arg list in the tool text.
- Where terse and clear conflict, clear wins (`CLAUDE.md`).
- Distill draft is input, not output: compare draft lines against the original sentence by sentence,
  restore any lost qualifier, condition, limit or negation.

## 4. Steps and commits (resumable from disk)

Step 0. Read SPEC rows P286-P288. Note which are Done. Run `promptsizes`; the id set at start defines
scope (D1). If an id exists that §2 does not list, add it to its group.

Step 1. `feat(llmprompts): prompt snapshot, compare and distill commands` (C1): D7 `promptdistill`, D8
`promptsizes -snapshot/-compare`, D11 `-update` on `golden_test.go`. Commit
`docs/v2.5/plans/P289-runs/before.json` (snapshot at start). Fast checks: `go build ./...`,
`bun run lint:go`.

Step 2. Distill drafts, one run for all D6 ids ≥ 150 chars: `go run ./internal/llmprompts/cmd/promptdistill
-min 150 -ids <list> -out docs/v2.5/plans/P289-runs/distill.jsonl -cap 1.5`. Commit
`test(llmprompts): P289 distill drafts` with the file. Ledger row (§7).

Step 3. Eval baseline before any memory text changes: `round-p289-00a`, `round-p289-00b` (§5). Commit
outputs `test(memory): P289 eval baseline`.

Step 4. Group commits in this order, each `feat(llmprompts): terse <group> prompts`: G6, G4, G5, G3, G2,
G1. Per group: rewrite (§3), regenerate goldens (`go test ./internal/llmprompts -run TestGolden -update`),
`promptsizes -compare before.json` clean, update every test or fixture holding the old text (§6
"text coupling"), fast checks, `go test ./internal/llmprompts/...`, the group's flow tests, `checkprompts`;
commit; then the group's real rows (§6); fix or revert (D12, D13) as its own commit. Record rows and spend
in the results ledger (§8) in the same or next commit.

Step 5. After G3, G2 and G1 land: eval `round-p289-01` (§5). Commit outputs. Decide per §5; reverts as D13.

Step 6. Sweep for P286-P288 prompts (runs as soon as the P288 row is Done; if P288 was Done at Step 0,
it runs now). `promptsizes -compare before.json` lists ids absent from `before.json` or changed since it
by another phase; each gets the style audit and §3 where it has filler or repetition; rows of the touched
integration (ADE row for workflow prompts; the P287 macOS and sandbox rows its plan adds). Commit
`feat(llmprompts): terse sweep of P286-P288 prompts`. If P288 is not Done when Step 9 ends, this step
stays open: the SPEC row says so, D10 keeps P287/P288 prompts in check meanwhile, and the orchestrator
runs Step 6 as a follow-up commit once P288 lands.

Step 7. `feat(llmprompts): terse style and size budget check` (C-guard): D10 in `checkprompts`, generate
`budget.tsv` from final `promptsizes` output. `bun run lint` green.

Step 8. Serial test-and-fix (§6 full list), one commit per group of related fixes.

Step 9. Docs and close-out (§9): `docs: P289 close-out`.

Resume: last commit names the step; `distill.jsonl` skips done ids; a round dir with `scores.json` is
done; the results ledger (§8) holds spend and row outcomes.

## 5. Memory eval (P285 harness, subset)

- Subset (tuning set, covers md plan, Go spec, md doc, code comments, JSON): `plan-p257`,
  `spec-chunk-go`, `doc-arch-prompts`, `cmt-runner-go`, `json-ade-errors`. Cost at `round-p3-01`: 1.44
  USD per round, judge included.
- Env: `KIRA_EVAL_MODE=run KIRA_EVAL_ROUND=round-p289-<nn> KIRA_EVAL_ONLY=<subset>
  KIRA_EVAL_LEDGER=spend-p289.jsonl KIRA_EVAL_CAP_USD=2 KIRA_EVAL_PHASE_CAP_USD=9`, `bun run
  eval:memory`. Outputs under `docs/v2.5/plans/P285-runs/` (harness-fixed dir).
- Reference = mean of `round-p289-00a` and `00b` subset aggregates (current tree, Part 3 pipeline; Part 1
  numbers do not apply after Part 3's merge rule). Record `|00a - 00b|` per metric as measured subset
  noise.
- Bands (P285 Part 1): `R_ess` 0.020, `R_all` 0.020, `P` 0.065, unsupported 0.010, duplicate 0.020,
  `C_fact` 0.029. Pass: `R_ess`, `R_all`, `P` ≥ reference − band; unsupported, duplicate, `C_fact` ≤
  reference + band.
- Decision rules:
  - `round-p289-01` passes: keep all.
  - Out of band: one confirmation rerun `01b`; the mean of `01`/`01b` decides.
  - Confirmed: `round-p289-02` with old `memory.gate.system` via `KIRA_EVAL_PROMPTS` (text from
    `before.json`). Passes: revert gate (D13). Fails: `round-p289-03` with old extract instead; passes:
    revert extract. Both fail: revert G2 and G3 MCP texts (finalize agent reads the tool descriptions and
    results) and both systems; list all.
  - Stage evidence (extracted vs stored misses, gate drops, finalize drops) named in the results for any
    revert.

## 6. Tests and text coupling

Text coupling found at base (update in the group commit that changes the text; prefer asserting the
registry render, `llmprompts.<Var>.Text(llmprompts.Defaults(), ...)`, over a literal):

- Goldens: 26 files in `internal/llmprompts/testdata/golden` (ADE, headless finish suffix,
  `memory.mcp.remember.message`, `run.resume.line`).
- Flows: `adeflow/resume_test.go:65` and both `termflow/smart_resume_test.go:80` ("closed while you
  worked"), `adeflow/llmprompts_test.go:45`, `internal/memory/service_test.go:25` (renders, fine),
  memoryflow constants (D2 keys).
- Contracts: `apps/kira-space/tests/contract/{ade-automation,smart-resume}.json`,
  `apps/kira-studio/tests/contract/{smart,smart-resume,script-editor}.json`. Regenerate with
  `KIRA_CONTRACT=write` per DEV_ENVIRONMENT "Contract fixtures"; never hand-edit.
- UI specs and mocks: `copy-coverage.spec.ts:43` regex, `ade-v2-run.spec.ts:78`,
  `ade-v2-automations.spec.ts:78`, `terminal-claude-missing.spec.ts:50`,
  `packages/workbench/src/testing/ui/scenarios/automationsSmart.ts:105`. Mocks may keep their own text
  where no spec compares it to the default; specs that compare follow the new default.
- Real `claude` module: `tests/claude/memory_docs_test.go` (`TestMemoryMcpFollowsDocs` relies on
  instructions wording: "files" on `ingest_files`, distill line, "do not Read the file first").
- Find any other: before each group commit, `rg -F` the first 30 chars of every old default of the group
  over `apps packages internal site` (excluding `internal/llmprompts`).

Rows per group (DEV_ENVIRONMENT "Real `claude` tests"; append `-count=1`):

| group | command |
|---|---|
| G1 | `bun run test:claude:space -run 'TestMemoryGate\|TestMemoryImport\|TestMemoryIngest\|TestMemoryDistill\|TestMemoryDistillBridge'` |
| G2, G3 | `bun run test:claude:space -run 'TestMemoryMcpThroughClaude\|TestMemoryMcpFollowsDocs\|TestMemoryInstallRegisters\|TestMemoryDistill'` |
| G4 | `bun run test:claude:space -run 'TestAdeHeadlessRun\|TestAdeStepResults\|TestAdeStageSession\|TestAdeRebaseRun\|TestAdeResumeRun\|TestAdeResumeLost\|TestSmartScriptRun\|TestSmartScriptResume'` and `bun run test:claude:studio -run TestSmartScriptRun` |
| G5 | G4 commands (`run.resume.line` is in both apps) |
| G6 | `bun run test:claude:studio` |
| final | DEV_ENVIRONMENT "Prompt registry" row (Space superset plus `bun run test:claude:studio`) |

No new unit or flow test: no new behaviour (`CLAUDE.md` test bar). Guards: `go run
./internal/llmprompts/cmd/checkprompts`, `go test ./internal/llmprompts/...`, both `llmpromptsflow`
counts unchanged from Step 0, catalog rules (`bun run lint`).

Serial test-and-fix (Step 8): `bun run lint`, `bun run lint:go`, `bun run lint:claude`, `bun run
typecheck`, `go test ./... -count=1`, `bun run test:flows:space`, `bun run test:flows:studio`, `bun run
test:unit`, `bun run test:ui:space`, `bun run test:ui:studio` (specs and contracts changed), `bun run
site:check`. Final real row superset. Fix at cause, pre-existing failures included (`CLAUDE.md`).

## 7. Spend ledger (cap 15 USD, user-adjustable)

| step | what | est. USD | running |
|---|---|---|---|
| 2 | distill drafts, about 33 ids, one chunk each | 1.0 | 1.0 |
| 3 | `round-p289-00a`, `00b` | 3.0 | 4.0 |
| 4 | G6, G4, G5 rows (haiku) | 0.3 | 4.3 |
| 4 | G3, G2, G1 rows (import 0.14 each, ingest, MCP) | 0.8 | 5.1 |
| 5 | `round-p289-01` | 1.5 | 6.6 |
| 6 | sweep rows | 0.2 | 6.8 |
| 8 | final superset rows | 0.7 | 7.5 |

Contingency, in order, only when triggered: row reruns and old-text reruns 0.5; `01b` 1.5; `02` 1.5;
`03` 1.5. Worst case 12.5; reserve 2.5. Before each paid step: actual total so far plus the step estimate
≤ 15, else stop, record, and ask the orchestrator (the user may raise the cap). Eval spend is metered in
`spend-p289.jsonl`; distill in `distill.jsonl`; real rows by the printed Space-suite spend (Studio
estimate under 0.01 per run), copied into §8.

## 8. Results (implementer fills, one commit per step)

- Ledger: step, planned, actual USD, running total.
- Per prompt before/after table from `promptsizes -compare before.json` (id, chars, tok, change), group
  totals, grand total.
- Eval rounds: subset aggregates, reference, bands, verdict.
- Rows run per group with result and spend.
- Reverted prompts: id, round or row, metric or failure.
- Ids with no row exercising them (D12).
- Allowed protected-token losses (copy of `allowed-losses.tsv` with reasons).

## 9. Docs and close-out

- `docs/ARCHITECTURE.md` "App prompts (P271)": entry counts (stale "85 entries: Space 61, Studio 33");
  goldens track current defaults (`-update`); defaults follow `CLAUDE.md` Communication style;
  `checkprompts` style and budget rules (D10) and `budget.tsv`; `promptsizes -snapshot/-compare`;
  `promptdistill`. "Memory ingest eval (P285)": P289 subset rounds and result line.
- `docs/DEV_ENVIRONMENT.md`: eval row gains P289 spend and ledger; new line for `promptdistill` (opt-in,
  spends, about 0.03 USD per prompt, never in hooks or CI); "Prompt registry" row: after a default
  rewrite run the full row.
- Site `reference/prompts.md`: defaults are terse; size budget and style check for contributors in one
  line only if the page already addresses contributors, else none; override after an app update shows
  "default changed" (check the existing text first). `reference/mcp-tools.md`: match any sentence that
  quotes a changed tool description. `space/agents.mdx`, `shared/automations.md`: only where they quote
  a changed suffix.
- SPEC row P289: Done with qualifier (bands met; reverted ids; sweep open or done).
- ARCHITECTURE "Known open items": add one only for a real remaining limitation.

## 10. File ownership vs P290 and concurrent phases

- P289 owns: `internal/llmprompts/**` (registry, goldens, `budget.tsv`, `cmd/*`), tests and fixtures in
  §6, `docs/v2.5/plans/P289-*` and `P289-runs/`, eval outputs `P285-runs/round-p289-*` and
  `spend-p289.jsonl`, ARCHITECTURE "App prompts" and eval lines, DEV_ENVIRONMENT rows above, site
  `reference/prompts.md`, `reference/mcp-tools.md` (plus `space/agents.mdx`, `shared/automations.md`
  only if they quote changed text).
- P290 owns: landing or presentation page, nav config (`site/astro.config.*`), `site/src/content/docs/
  docs/develop/**` removal, `site/scripts/check-docs.ts` rules, `sources` frontmatter pointing at
  Develop pages, screenshots.
- Overlap: none at base. The P289 site pages have no Develop `sources` and no Develop links, and the
  Develop pages do not mention prompts. Only possible overlap: P290 (f) restyling reference pages; table
  order runs P289 first, so P290 builds on P289's text. No concurrent edit: the P290 planner writes only
  its plan.
- P286 (implementer in `wt-p286`) adds `ade.review.comments`, `ade.review.round.message`,
  `ade.review.followup.message`, `headless.tool.reply_review_comment` (+3 args), `headless.reviewReply.ack`
  to `registry.go`. P289 never edits that worktree; its entries are covered by Step 0 scope, D3 audit and
  Step 6.

## 11. Verification (orchestrator, real checks)

1. `go run ./internal/llmprompts/cmd/promptsizes -compare docs/v2.5/plans/P289-runs/before.json` exits 0
   and its output equals §8's table.
2. `rg -c '"costUsd"' docs/v2.5/plans/P289-runs/distill.jsonl` ≥ the D6 distill id count; each listed
   id's default differs from `before.json`, or the results say why not.
3. `go run ./internal/llmprompts/cmd/checkprompts` green; deleting one line of `budget.tsv` makes it fail
   (scratch check, not committed).
4. `go test ./internal/llmprompts/... -count=1` green with regenerated goldens; `git diff 7eec31df7 --
   internal/llmprompts/store.go` empty.
5. `llmpromptsflow` counts equal Step 0 counts.
6. `spend-p289.jsonl` plus distill plus rows ≤ 15 (§8 ledger); eval numbers equal the rounds'
   `scores.json` subset aggregates.
7. Real rows of every touched group listed green with spend; reverted ids listed.
8. D2 texts byte-identical: `before.json` defaults for `memory.dataHygiene` equal the current default;
   fakeagent keys still substrings of their prompts.
9. Total rewritten-entry char change reported against the 25 % target.
10. Tool logs: this planner and the implementer's discovery show real `codegraph_explore` calls.
