# P285 Part 2 plan: terse memory prompts and distill tool

Ask (SPEC row P285 Part 2, decisions final there): rewrite memory-pipeline prompts (extract, finalize,
verify, gate, reconcile) and memory MCP instructions, tool and arg descriptions as terse atomic
instructions, same meaning. Add read-only MCP tool `distill`. Unify: `distill` is the base, memory import
is `distill` per chunk plus the memory layer. Redo the P285 eval within Part 1 noise bands, cap 30 USD.
Update docs, site pages, Artifact page.

Base: `v2.0` at `ce80d78c3` (P285 Part 1 close-out). Discovery ran through `codegraph_explore`:
registry entries `MemoryImportExtractSystem`/`FinalizeSystem`/`VerifySystem`/`GateSystem`/
`ReconcileSystem`/`MemoryDataHygiene`/`MemoryMcpInstructions`/`MemoryTool*` and their `arg` rows,
`ClaudeAgent.Extract`/`Verify`/`Finalize`, `cleanFacts`, `Agent`, `Fact`/`FinalFact`, `Questionable`/
`questionableIn`/`normalizeQuote`, `loadExtracted`/`applyVerdicts`/`claimFinalize`/`finishChunk`,
`runExtract`/`runVerify`/`verifyBatches`/`runFinalize`/`tooManyFacts`, `chunkFile`/`materialiseNext`,
`mcpserver.Build`/`Options`/`addIngestTools`, `memorycli.Run`/`RunIngest`, `runGate`/`validateGate`,
`Service.reconcile`, `ReadText`/`kindOf`/`DefaultCaps`, `Bound.list`/`Preview`. Targeted reads (not in the
index or not code): eval harness `apps/kira-space/tests/claude/memory_eval*_test.go` (nested module),
`memory_docs_test.go`, memoryflow `import_test.go`/`ingest_test.go`/`format_test.go`, `engine_test.go`
fake agent, `llmpromptsflow` count (97), ARCHITECTURE memory and eval sections, DEV_ENVIRONMENT real
`claude` rows, site `space/memory.mdx` and `reference/mcp-tools.md`, P285 plan and report.

Out of scope: UI (Part 4 owns the distill UI); store format, fact merging, `C_doc` measurement fix (Part 3);
other registry prompts, tool-result texts (`memory.mcp.store.*`, `memory.mcp.ingest.*`,
`memory.mcp.semantic.*`), `memory.mcp.remember.message` (P289); `claudeModel`; chunk budget (Part 1
follow-up, user decision pending); judge prompts and golden (frozen).

## 1. Decisions (final)

- D1. Tool name `distill`. No clash: `kira-memory` tools are `store_memory`, `search_memories`,
  `memory_history`, `memory_context`, `ingest_files`, `ingest_status`; prompt `remember`.
- D2. One prompt, registry id `memory.distill.system` (Go `MemoryDistillSystem`), replaces
  `memory.import.extract.system`. Why: SPEC says no separate extract prompt; a new id because schema and
  vars change, so an old override could never validate against it.
- D3. Instruction mode is a template branch of the same prompt (`DistillVars.Instructions bool`), not a
  second entry. Why: SPEC "option of the same prompt".
- D4. Schema `{"lines": [{"text": string, "unresolved": string}]}`, both required. No `evidence`, no
  `section`. Why: SPEC drops the quote; code knows the section (chunk heading path), the model need not
  echo it.
- D5. Evidence dropped entirely, never conditional. Exact strings the quote used to carry (error texts,
  run notes, quoted values) go verbatim inside the line. Why: "unless it adds information" is met by the
  keep-verbatim rule; a conditional field would keep the cost the SPEC removes.
- D6. Core lives in `internal/memory/importer` (`distill.go`), not a new package. Why: it needs the
  chunker (`chunkFile`, `ReadText`, `kindOf`); a `distill` package importing `importer` while `importer`
  calls the core would cycle. `mcpserver` already imports `importer`.
- D7. `Agent.Extract` becomes `Agent.Distill` (`DistillInput`/`DistillOutput`, `runDistill`). File states
  `extracting`/`extracted` and `import_chunks.facts` stay. Why: Go names follow the one pipeline; states are
  a wire contract the UI (Part 4) reads.
- D8. Section and locator by code: `Fact.Section` = chunk heading path; `FinalFact.Reason` =
  `Stated in <rel path>, <section>` (or `Stated in <rel path>` without a heading), at most
  `memory.MaxReasonLen` runes. Finalize copies it as each item's reason; a merged fact takes its first
  fact's reason. `FinalizeVars.MaxReason` goes. Why: SPEC "locator is added by code".
- D9. Questionable rule without evidence: a line is questionable when `unresolved` is set, or when one of
  its salient tokens is missing from the chunk text plus context (both through `normalizeQuote`). Salient
  token: a run with a digit, a backticked or double-quoted span, or a word holding `_`, `/`, `.` between
  letters, `::`, or an inner capital (camelCase, PascalCase). Why: keeps a cheap invented-claim guard
  ("verify against chunk text") now that no quote exists; numbers, identifiers and quoted strings are what
  a distortion changes. One table unit test (`verify_test.go`): several interacting token classes
  (CLAUDE.md test bar).
- D10. Verify keeps the source copy and `Read`/`Grep` (an open reference often resolves outside the
  chunk). Input facts lose `evidence`; schema loses `evidence`; `Verdict.Evidence` goes. Rewritten fact is
  a terse line.
- D11. Rationale rule, in distill and gate: keep a reason the source states inline (`X, because Y`) only
  when the line alone does not make it obvious; drop it when self-explanatory. Prompt mode (D3) keeps rules
  as short imperatives, negations and numbers verbatim.
- D12. Gate gains two clauses: keep a `Stated in <path>[, <section>]` locator in the reason verbatim; a
  reason naming a source document supports a fact from that document. Why: without them the gate would
  drop the code-built locator or challenge agent-origin imports whose reason no longer quotes the source.
- D13. `distill` limits: input at most 120 000 runes (about 40 000 estimated tokens), from text or one
  absolute path (`ReadText` with `DefaultCaps.MaxFileBytes`, 1 MiB); at most 16 chunks under
  `DefaultBudget`; per-chunk `--max-budget-usd 0.50` (today's `extractBudget`), timeout 180 s; per-call
  spend cap 2.00 USD: no chunk starts once reported spend reaches it, and the call fails with the spent
  amount. Three chunks at once (import's extract concurrency). Why: one call stays well under a dollar in
  practice (Part 1: about 0.03 USD per chunk); caps stop a runaway.
- D14. `distill` input: exactly one of `text`, `path`; `mode` `facts` (default) or `instructions`. Text
  input chunks as Markdown; a path chunks by its extension (`kindOf`), unknown extension as text. Output:
  text content = lines joined by `\n`; structured output `{"lines": [string]}`. Never ids, evidence,
  keywords, origin, scope, `unresolved`, cost. Errors are tool errors (`memory.ErrInvalid` wrapping for bad
  input). Annotations `ReadOnlyHint: true`. Never calls the store gate, never writes memory.db.
- D15. `distill` is registered when `Options.Distill` is set; `memorycli.Run` sets it only outside import
  mode. Why: the finalize agent has no use for it and must not spend on nested calls.
- D16. Core API shaped for Part 4's bridge: `importer.Distiller{Runner *memory.CLIRunner, Prompts
  llmprompts.Source}` with `Distill(ctx, DistillRequest{Text, Path, Mode}) (DistillResult{Lines []string,
  CostUSD float64, Chunks int, InRunes, OutRunes int}, error)`, cancellable through ctx. MCP shows only
  lines; Part 4 shows cost and sizes.
- D17. Import mode stays `facts`. Why: ingested docs are knowledge; instruction mode is a distill option for
  agents condensing prompts (P289).
- D18. Rewrite set: `memory.gate.system`, `memory.reconcile.system`, `memory.import.finalize.system`,
  `memory.import.verify.system`, new `memory.distill.system`, `memory.mcp.instructions`, every
  `memory.mcp.tool.*` description and arg, `memory.mcp.remember.description` and its `text` arg.
  `memory.dataHygiene` stays verbatim (safety clause).
- D19. Unchanged in every rewrite: template variables, `{{template "memory.dataHygiene"}}`, schema and
  field names, tool names, enum values, negations, numbers, error strings, the secrets clause, the fakeagent
  keys the flows match (`gatekeeper of a long-term memory`, `reconcile new facts`, `cross-check facts
  extracted`; new key `distill text into terse atomic lines` replaces `extract durable facts`).
- D20. Spend ledger per part: harness env `KIRA_EVAL_LEDGER` (file name under `P285-runs/`, default
  `spend.jsonl`); Part 2 uses `spend-p2.jsonl` with `KIRA_EVAL_PHASE_CAP_USD=30` and
  `KIRA_EVAL_CAP_USD=6`. Why: the Part 1 ledger already holds 57.88 USD; Part 3 reuses the knob.
- D21. Rounds named `round-p2-<nn>` under `P285-runs/`. Reference = Part 1 `round-final` tuning aggregate
  (read the numbers from its `scores.json`; report: `R_ess` 0.883, `R_all` 0.713, `P` 0.895, unsupported
  0.000, duplicate 0.000, `C_fact` 0.497). Bands from Part 1 (`R_ess` 0.020, `R_all` 0.020, `P` 0.065,
  unsupported 0.010, duplicate 0.020, `C_fact` 0.029).
- D22. Pass: `R_ess`, `R_all`, `P` ≥ reference − band; unsupported, duplicate ≤ reference + band;
  `C_fact` ≤ reference + band. `reason ok`, atomic, standalone, `C_rec` reported, not gated: the frozen
  judge's `reasonOk` asks for a quote that D5 removes. Why: the SPEC lists exactly the gated metrics.
- D22a. A gated metric outside its band gets one confirmation rerun before it counts as a regression.
  Why: Part 1 saw 0.03 `R_ess` drift on identical code; budget allows one.
- D23. Fallback to the old split only when the unified round regresses after its one fix round (§4).
  Fallback = `git revert` of the unification commit (C5); `distill` stays a standalone tool with its own
  prompt; finalize and verify keep their terse rewrite in the old evidence shape.
- D24. Prompt sizes come from a new command `internal/llmprompts/cmd/promptsizes`: renders every entry
  through the existing preview path (`Bound.Preview` over defaults, example vars, fragments included) and
  prints id, chars, `ceil(runes/3)`; `-prefix memory.` filters. Why: before/after per prompt here and in
  P289, measured the same way, rendered as sent.
- D25. One sequential Sonnet implementer. Why: registry.go, importer types and the harness are shared by
  every step, and each measurement round consumes the previous commit.

## 2. Prompt inventory (before)

Raw default text, chars and `ceil(runes/3)`, at `ce80d78c3` (registry text is ASCII). The official
before/after table comes from `promptsizes` (rendered, fragments and example vars included) in C1 and at
close-out.

| id | chars | tok | Part 2 action |
|---|---|---|---|
| memory.dataHygiene (fragment) | 177 | 59 | verbatim |
| memory.gate.system | 2851 | 951 | terse + D12 |
| memory.reconcile.system | 1288 | 430 | terse |
| memory.import.extract.system | 1905 | 635 | replaced by memory.distill.system |
| memory.import.finalize.system | 2319 | 773 | terse + D8 input |
| memory.import.verify.system | 1373 | 458 | terse + D10 |
| memory.mcp.instructions | 1437 | 479 | terse + distill line |
| memory.mcp.tool.store_memory (+14 args) | 453 (+1196) | 151 (+406) | terse |
| memory.mcp.tool.search_memories (+6 args) | 238 (+330) | 80 (+112) | terse |
| memory.mcp.tool.memory_history (+1 arg) | 84 (+33) | 28 (+11) | terse |
| memory.mcp.tool.memory_context (+2 args) | 182 (+96) | 61 (+32) | terse |
| memory.mcp.tool.ingest_files (+11 args) | 362 (+893) | 121 (+302) | terse |
| memory.mcp.tool.ingest_status (+1 arg) | 266 (+31) | 89 (+11) | terse |
| memory.mcp.remember.description (+1 arg) | 63 (+50) | 21 (+17) | terse |
| memory.mcp.tool.distill (+3 args) | new | new | new |

Target, not a gate: about 25 to 40 % fewer chars on gate, reconcile, finalize, verify and instructions;
args only where a shorter form exists (many are already one fragment). Never pad, never shorten a
negation, number or safety clause.

## 3. Prompt texts

### 3.1 `memory.distill.system` (final shape; implementer may tighten wording, not rules)

Vars `DistillVars{MaxLines int `prompt:"required"`; Instructions bool}` (`MaxLines` = `maxLinesPerChunk`
40, today's `maxFactsPerChunk`). Literal `{{`/`}}` in text must be escaped for `text/template`.

```
You distill text into terse atomic lines. Output only the schema.

{{template "memory.dataHygiene"}}

Input: "text"; optional "context" (end of the previous part: read it for references, never distill it), "section", "source".
"text" may be JSON from an export: field values are content; author, time and id fields are context.

- One claim per line, in source order.
- Terse: cut articles, filler, hedges, pleasantries. Fragments fine. Short word over long phrase. No invented abbreviations, no arrows.
- Keep verbatim: negations (not, never, no, only, except), numbers, units, names, code identifiers, paths, error strings, quoted text.
- Keep every qualifier that changes the claim: conditions, exceptions, limits.
- Keep decisions with their reasons, rejected alternatives with why, conventions, configuration, ownership, relationships, constraints, how things work.
- Keep a reason the text states inline ("X, because Y") only when the line alone does not make it obvious. Drop it when self-explanatory.
- Name the subject. Replace a pronoun with the name only when the text makes it certain. Otherwise keep the words and set "unresolved" to what is missing; else "".
- Skip navigation, tables of contents, boilerplate, licence text, copied examples, step-by-step commands, time-bound chatter, process chatter (who ran what, commit and phase lists, run results, spend), code mechanics with no behavioral meaning (selectors, local variable names, fixture values).
- Never invent or infer beyond the text. Never include a secret (password, token, API key, private key).
{{if .Instructions}}- The text is instructions. Each line is one rule as a short imperative. Keep must, never and only force, template variables and schema field names verbatim. Keep commands and examples a rule needs.
{{end}}- At most {{.MaxLines}} lines. None when nothing durable.
```

Fakeagent key: `distill text into terse atomic lines`. Catalog keys `llmPrompts.entry.memoryDistillSystem.
{title,description,usedBy.body}` replace the `memoryImportExtractSystem` ones in `packages/theme/src/i18n/
en.json` (title "Distill", description: condenses text into terse atomic lines; used by memory import per
chunk and the `distill` MCP tool).

Input wire (`distillWire`): `{"source": rel path or "", "section": heading path, "context": ..., "text":
...}`. `cleanLines`: trim, drop empty and over `memory.MaxFactLen`, trim `unresolved`, cap at
`maxLinesPerChunk`.

### 3.2 `memory.import.finalize.system`

Input facts carry `id`, `chunk`, `fact`, `section`, `unresolved` (omitempty), `reason` (D8); no evidence.
Rules kept, terse: merge duplicates and near-duplicates; resolve `unresolved` from other facts, else list
under `unresolved` with the open question; drop non-durable (trivia, example, time-bound, navigation) with
why; drop and never store a secret; store the rest via `store_memory`, at most `{{.MaxItems}}` items per
call, input `provenance` values as origin, sourceTag, scope, project (omit missing; store enforces);
fact standalone; reason = the fact's `reason` (merged: first fact's); `challenge` true/false handling
verbatim in meaning; `search_memories` only to word a fact; stop when every fact is stored, merged,
dropped or unresolved; report only facts not stored.

### 3.3 `memory.import.verify.system`

Input facts `id`, `fact`, `section`, `unresolved`. Truth source is the file named in `source`; read it with
`Read` and `Grep` only; find the words in the file before any verdict. Verdicts: `confirmed`, `rewritten`
(terse standalone line, at most 300 characters, only what the file says), `unsupported`, `ambiguous`;
`why` one sentence; `fact` "" unless rewritten; every id once; at most `{{.MaxFacts}}` per call.

### 3.4 `memory.gate.system`, `memory.reconcile.system`

Terse rewrite, one rule per line, every clause kept (split, style rule, keyword count, every challenge
trigger, clarification handling, no-challenge mode, origin rank, action definitions). Gate adds D11 and
D12. The gate's own style rule stays (it is the store's style contract, ARCHITECTURE "Style rule").

### 3.5 MCP instructions, tool and arg descriptions

Terse, same facts. Instructions add one line, wording final up to tightening: `Condense long text or a
file into short lines without storing: distill (text or absolute path; mode instructions for prompts).
Stores nothing; to store a file use ingest_files.` The last clause keeps `TestMemoryMcpFollowsDocs` "files"
on `ingest_files`.

New entries: `memory.mcp.tool.distill` (KindTool, Name `distill`), args `text` (text to distill; at
most `{{.Max}}` characters; or path), `path` (absolute file path; or text), `mode` (`facts` default, or
`instructions`: rules as short imperatives). `llmpromptsflow` `TestList` count 97 becomes 101.

## 4. Measurement order (cap 30 USD, ledger `spend-p2.jsonl`)

Cheap first. Every round commits `round-p2-<nn>/` outputs plus a row in the report's Part 2 iteration log
(same columns as Part 1, plus questionable count and share of stored reasons starting `Stated in`).

| step | what | est. USD | running |
|---|---|---|---|
| M0 | free: build, `go test ./internal/...`, flows, `checkprompts`, `promptsizes` | 0 | 0 |
| M1 | real rows `TestMemoryDistill`, `TestMemoryMcpFollowsDocs` (after C2) | 0.2 | 0.2 |
| M2 | `round-p2-01` tuning: Part 1 pipeline, terse gate + reconcile via `KIRA_EVAL_PROMPTS` | 4.3 | 4.5 |
| M3 | `round-p2-smoke`: `KIRA_EVAL_ONLY=plan-p153,json-ade-errors` after C5 (wiring, write-back) | 1.0 | 5.5 |
| M4 | `round-p2-02` tuning: unified pipeline, all terse defaults | 4.5 | 10.0 |
| M5 | `round-p2-final`: all 15 sources, committed defaults | 5.7 | 15.7 |
| M6 | real rows: prompt registry row of DEV_ENVIRONMENT (superset) plus `TestMemoryDistill` | 0.3 | 16.0 |

Contingency (only when triggered, in this order): confirmation rerun of a round (D22a, 4.5); one fix round
`round-p2-03` (prompt edit as override, 4.5); fallback round `round-p2-04` after reverting C5 (4.3);
distill-only round (below, 2.5). Worst case about 32: the harness stops at the cap (starts no source within
2 USD of it); the implementer skips the distill-only round before ever overrunning.

Decision rules:

- M2 regresses (D22, after D22a): revert gate and reconcile to Part 1 text one at a time by stage evidence
  (gate challenges and drops point at gate; update/noop shifts point at reconcile); keep the one that
  passes, list the reverted one. No extra round unless the cause is ambiguous; then one round with only
  the gate terse.
- M4 regresses: loss-stage analysis (extracted vs stored misses, questionable count, verdicts, finalize
  drops, reasons without `Stated in`). One fix round on the named prompt via override. Still regressed:
  fallback (D23), round `round-p2-04`, then M5 on the fallback tree.
- M5 outside a band on hold-out only: reported, not tuned (Part 1 overfitting guard).
- A reverted prompt is listed in the report with its round and metric.
- Distill-only round (`KIRA_EVAL_MODE=distill`, contingency): runs `Distiller.Distill` per source path and
  scores the lines as stored facts (reason empty) with the same judge. Reports recall and `C_fact` of the
  bare tool, for P289. Runs only when the ledger has at least 4 USD left after M6.

## 5. Commits (one sequential implementer, resumable from disk)

1. `feat(llmprompts): promptsizes command` (C1). Report gets a "Part 2" section skeleton with the before
   table from the command. Fast checks.
2. `feat(memory): distill MCP tool` (C2). `importer/distill.go` (`Distiller`, `distillChunk`,
   `cleanLines`, limits D13), registry `MemoryDistillSystem` + `DistillVars` + tool and args, en.json
   catalog keys (extract keys stay until C5), `mcpserver` `Options.Distill` (interface with the D16
   method) and tool registration, `memorycli.Run` wiring (D15). Flow test and real row (§6). `extract`
   still runs import.
3. `test(memory): eval ledger per part` (C3). `KIRA_EVAL_LEDGER`; distill-only mode left for contingency
   (add in the same commit only if run).
4. M1, M2. `test(memory): P285 part 2 round 1 ...` with outputs; kept text lands as
   `feat(memory): terse gate and reconcile prompts` (C4).
5. `feat(memory): terse memory MCP texts` (C4b): instructions, tool and arg descriptions (D18). Real row
   `TestMemoryMcpFollowsDocs` (0.05 USD) before commit.
6. `feat(memory)!: import distills each chunk` (C5). Remove `MemoryImportExtractSystem`, `ExtractVars`,
   `extract.go` (merged into `distill.go`), `Agent.Distill` (D7), `Fact` without `Evidence`, section from
   heading path, `FinalFact.Reason` (D8), questionable rule (D9) plus `verify_test.go`, verify schema and
   input (D10), terse finalize and verify (§3.2, §3.3), `FinalizeVars` without `MaxReason`, en.json
   extract keys removed, `engine_test.go` fake agent, memoryflow constant and fixtures
   (`extract-*.json` become `distill-*.json` in the lines schema), harness `recAgent` and record fields
   (`extractedFact.Evidence` dropped). Footer `BREAKING CHANGE: memory.import.extract.system is gone; an
   override of it no longer applies.` In-flight jobs: old `import_chunks.facts` rows decode (extra field
   ignored); questionable is recomputed by D9; no migration.
7. M3, M4 (and contingency) commits as in §4.
8. M5: `test(memory): P285 part 2 final run`.
9. Serial test-and-fix (§7), one commit per group.
10. Close-out (§8): `docs: P285 Part 2 close-out`.

Resume: a round dir with `facts.jsonl` lines skips those sources; `scores.json` marks a round done; the
report's Part 2 log shows the last finished step; `spend-p2.jsonl` holds the spend.

## 6. Tests (split at the IPC boundary)

No UI changes here (Part 4), so no UI spec. Go side:

- Flow test `TestMcpDistill` (memoryflow, `memoryMCP` client, fakeagent rule on the distill key):
  text in, lines out; path to a two-chunk Markdown file, lines in source order across chunks; `mode
  instructions` reaches the prompt (fakeagent records the system text); nothing stored (`Recent` empty, no
  `kira:memory:changed` event); both or neither of `text`/`path`, relative path, over-limit input each a
  tool error; spend cap stops new chunks (fake result `total_cost_usd`).
- Flow tests updated for the unified pipeline: `TestImportLifecycle`, `TestImportRetries`,
  `TestImportVerifiesQuestionableFacts` (a line with a number absent from its chunk goes to verify),
  `TestImportProvenanceWritesDoc` (reason starts `Stated in`), ingest tests on the new fixtures.
- Unit: `verify_test.go` table for D9 only. Nothing else new (CLAUDE.md test bar).
- `internal/memory/mcpserver/server_test.go`: `distill` absent without `Options.Distill` and in import
  mode (extend the existing tool-list check).
- Real `claude` (nested module, opt-in): new `TestMemoryDistill` (memory-mcp re-exec, `claude -p` with only
  `mcp__kira-memory__distill` allowed, a short doc path; asserts a `distill` tool use, a non-empty result,
  no `store_memory`, memory.db has no facts); `TestMemoryMcpFollowsDocs` gains subtest "distill" (goal-only
  prompt "Condense <path> into short lines; store nothing." asserts `distill` with `path`, no
  `store_memory`, no `Read` of the file). Existing rows stay green: `TestMemoryGate`, `TestMemoryImport`,
  `TestMemoryIngestThroughClaude`, `TestMemoryMcpThroughClaude`, `TestMemoryInstallRegisters`.
- Guards: `go run ./internal/llmprompts/cmd/checkprompts`, `go test ./internal/llmprompts/...`, catalog
  rules (`bun run lint`), `llmpromptsflow` count 101.

## 7. Serial test-and-fix

`bun run lint`, `bun run lint:go`, `bun run lint:claude`, `bun run typecheck`, `go test ./... -count=1`,
`bun run test:flows:space`, `bun run test:unit`, `bun run test:ui:space` (en.json changed),
`bun run site:check` (`bun run lint` already runs `site/scripts/check-docs.ts`). Real rows: DEV_ENVIRONMENT
"Prompt registry" row plus `TestMemoryDistill`. Fix at cause, pre-existing failures included (CLAUDE.md).

## 8. Docs and close-out

- `docs/ARCHITECTURE.md` "Memory MCP server and module": step 1 is distill (prompt id, lines schema,
  section and locator by code); cross-check rule D9; verify without evidence; finalize reason D8; new
  bullet `distill` tool (D13 to D16, read-only, never the gate, not in import mode); "App prompts (P271)"
  schema-bound list (`distill` replaces import extract). "Memory ingest eval (P285)": `KIRA_EVAL_LEDGER`,
  Part 2 results line, distill mode if added.
- `docs/DEV_ENVIRONMENT.md`: rows "Memory MCP and install" and "Memory import and ingest" and "Prompt
  registry" gain `TestMemoryDistill`; eval row: Part 2 spend; env table gains `KIRA_EVAL_LEDGER`.
- Site: `site/src/content/docs/docs/space/memory.mdx` (import distills each chunk; reasons name file and
  section; distill section: what it does, limits, stores nothing); `reference/mcp-tools.md` new `### distill`
  under kira-memory, other tool texts matched to the new descriptions.
- Report `P285-report.md` "Part 2": prompt size table before/after (from `promptsizes`), iteration log,
  results vs reference with bands, reverted prompts list, fallback taken or not, spend, examples (one source,
  Part 1 final facts vs Part 2 final facts, plus raw distill lines).
- Artifact `Memory Ingest Eval` (https://claude.ai/artifact/W3cx8zARKcBe8EhYfiz8vQ): read it, add a Part 2
  section (size table, metric cards vs Part 1 with bands, iteration rows), republish to the same URL. If the
  close-out subagent lacks the Artifact tool, the orchestrator does it.
- SPEC row P285 Part 2: Done with a result qualifier (bands met, or which metric and the fallback).
- ARCHITECTURE "Known open items": add one only for a real remaining limitation.

## 9. Verification (orchestrator, real checks)

1. `rg -n 'memory.import.extract|MemoryImportExtract|extract durable facts' --glob '!docs/v2.5/plans/**'`
   empty (fallback taken: the C5 revert commit exists and the report says so).
2. `rg -n '"evidence"' internal/llmprompts/registry.go` empty unless fallback.
3. `rg -n 'MemoryDistillSystem' internal/memory/importer` shows a real caller in import and in
   `Distiller`; `mcpserver` registers `distill` with `ReadOnlyHint`; `memorycli.Run` sets it only without
   `--import-ref`.
4. `go run ./internal/llmprompts/cmd/promptsizes -prefix memory.` output equals the report's after table.
5. Report Part 2 numbers equal `round-p2-final/scores.json` tuning aggregate; each gated metric within
   D22 of the reference or the fallback path is documented.
6. `spend-p2.jsonl` total ≤ 30.
7. Real rows run and listed with spend: `TestMemoryDistill`, `TestMemoryMcpFollowsDocs` (with "distill"),
   import, ingest, MCP, gate.
8. `llmpromptsflow` count 101; `checkprompts` green; en.json has no `memoryImportExtractSystem`.
9. Site pages and ARCHITECTURE mention `distill`; Artifact link opens with a Part 2 section.
10. Tool logs: this planner and the implementer's loss analysis show real `codegraph_explore` calls.
