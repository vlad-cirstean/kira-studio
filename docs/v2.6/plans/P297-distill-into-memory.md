# P297 plan: distill collapses into memory; rules

SPEC row P297 (`docs/v2.6/SPEC.md`). Base: `0656c71f` (v2.6, P296 result). Planner: Opus. Implementer: one
sequential Sonnet subagent (section 6). No split: the `kind` column feeds the gate, reconcile, `ApplyDoc`, the v3
doc writer and the merged lines; the shared merge fragment feeds both finalize and the no-store merge; every later
group builds on the one before.

Discovery: `codegraph_explore` over `Distiller Distill distill.go chunk.go`, `importer runner extract verify
finalize job tables`, `Service.Store decide runGate validateGate Memory FactOutcome`, `writeBack writedoc ParseDoc
FormatDoc CheckText DocLineSource`, `MemoryDistillService memorycli promptdistill`; reads of
`internal/memory/importer/{distill,runner,db(loadExtracted, applyVerdicts),extract,verify,finalize,agent,memdoc,
writedoc,chunk}.go`, `internal/memory/{gate,reconcile,service,store,model,applydoc}.go`, `migrations/*`,
`memfmt/*`, `memcheck/check.go`, `mcpserver/{server,ingest,distill}.go`, `memorycli/run.go`,
`internal/llmprompts/{registry,store,validate}.go`, `testdata/budget.tsv`, `bridge/memorydistill.go`,
`packages/workbench/src/memory/{distill/*,labels.ts,MemoryPanel.vue,AddMemoryDialog.vue}`,
`packages/shared/domain/{memory,memoryDistill}.ts`, `fakeagent.go`, `memoryflow/distill_test.go`,
`tests/claude/{memory_test,memory_docs_test,memory_gate_test}.go`, the three site pages, `docs/ARCHITECTURE.md`
memory sections and Known open items, `docs/DEV_ENVIRONMENT.md` real `claude` rows.

## 1. Current state (verified)

- Two pipelines. Import: chunk (`chunkFile`), extract (`memory.import.extract.system`, per chunk, evidence quote),
  verify (`memory.import.verify.system`, only `questionableIn` facts, Read/Grep over a copy of the source),
  finalize (`memory.import.finalize.system`, one agentic run per file: step 1 merges cross-chunk duplicates, step 2
  resolves `unresolved`, step 3 drops, step 4 calls `store_memory`). State lives in `import_jobs`/`import_files`/
  `import_chunks`, driven by the detached `Runner`.
- Distill: `importer.Distiller.Distill` chunks the same way, runs `memory.distill.system` per chunk (three at
  once, no retry), and only concatenates lines (`distill.go:246`). Cross-chunk duplicates survive. Modes `facts` and
  `instructions` (`DistillVars.Instructions`). Limits: 120 000 runes, 16 chunks, 2.00 USD per call. Callers: MCP
  `distill` tool (`mcpserver/distill.go`, wired in `memorycli/run.go:54`), `bridge.MemoryDistillService.Distill`
  (UI), `internal/llmprompts/cmd/promptdistill` (P289 drafting tool, mode instructions).
- `docs/ARCHITECTURE.md` Known open item "Memory import is not unified with distill" (two prompts). P297 resolves it
  by running distill on the import pipeline.
- Gate challenges "a question, an instruction or a task"; no-challenge mode challenges "a question or an
  instruction". Extract skips "step-by-step commands"; finalize drops "example". So a standing rule is refused today.
- `memories` has no kind. Versions immutable (`memories_immutable` trigger lists the value columns).
- Doc format `kira-memory: 2`: front matter, then any `#{1,6}` heading sets the section, `- <id> <fact>`, optional
  two-space reason. `kira-memory: 1` yields one problem and no facts. Writer `FormatDoc` prints `## <section>`.
  `RenderDoc` puts a locator reason's section in the heading and drops the reason line.
- Chunker on a table larger than `Max` (4000 tokens, about 12 000 chars): a table has no blank line, so it is one
  unit; `splitOversize` cuts it at line ends into 9000-rune pieces, and every piece after the first loses the header
  and delimiter rows. `docs/v2.5/plans/P285-report.md` (221 table rows) is not affected: its largest table is 60
  rows, 2967 chars, so every table fits one chunk. The defect is real for larger tables only.
- No `.memory.md` doc is tracked in this repo except the flow fixture `memoryflow/testdata/memdoc/billing.memory.md`.

## 2. Decisions

### D1. `kind`: column, migration, where it is set

- Migration `internal/memory/migrations/0008_p297_kind.sql` (version 8, name `kind`):
  `ALTER TABLE memories ADD COLUMN kind TEXT NOT NULL DEFAULT 'fact' CHECK (kind IN ('fact', 'rule'));` then drop and
  recreate `memories_immutable` with `kind` added to its column list. No table rebuild (ADD COLUMN with a constant
  default and CHECK is legal). Existing rows become `fact`; no backfill classification (versions are immutable, and a
  reclassification would need a model call per row).
- `memory.Kind{Fact,Rule}` constants in `model.go`; `Memory.Kind string json:"kind"`; `memoryColumns`/`scanMemory`
  read it; `commitInput.Kind`; `insertMemory` writes it; `FactOutcome.Kind`.
- Set in three places only, never by the caller (no `Item` field: SPEC allows no other metadata, and one classifier
  avoids a caller pinning a wrong kind):
  1. Gate: each output fact gains `"kind": {"enum": ["fact", "rule"]}` (required). `gateFact.Kind`;
     `validateGate`: empty means `fact` (an edited prompt override that drops the word still stores facts), any
     other value is `ErrClaudeOutput`. `work.Kind` carries it to commit.
  2. Merge (no store, D4): each line has `kind`.
  3. `ApplyDoc` (v3 doc): the category the fact sits under (D7).
- Reconcile keeps kinds apart. `reconcileInputFact` and `reconcileCandidate` gain `kind`; prompt sentence: `A rule and
  a fact are separate memories: noop and update need a candidate of the same kind.` Go guard in `checkDecision`: a
  noop or update whose candidate kind differs becomes `add` with why `A rule and a fact stay separate memories.`
  (same shape as `keptBesideWhy`). `prepare`: the exact-duplicate noop also requires equal kind. An update's new
  version takes the work's kind (equal by the guard).
- Rejected: an item `kind` field (caller-set metadata, SPEC forbids); kind on `memory_events` (the version row holds
  it); a `kinds` search filter (no consumer asked).

### D2. Kind in outputs

- MCP text, as a plain word after the version: `writeMemory` meta line `v3 rule origin=user scope=company ...`
  (always printed, `fact` too, so `grep ' rule origin='` finds rules); `renderStore` `Added km_… v1 rule: <fact>`,
  `Updated km_… to v2 rule: …`, `Already known km_… v1 fact: …`. Structured outputs carry `kind` through
  `memory.Memory` and `FactOutcome`.
- UI: `memoryKindSchema` (`z.enum(['fact','rule'])`) in `packages/shared/domain/memory.ts`; `memorySchema.kind`,
  store outcome `kind`. `labels.ts` `KIND_LABEL`. A `Rule` badge (`data-testid="memory-row-kind"`) only for
  `kind === 'rule'` in the `MemoryPanel.vue` row and the `MemoryStart.vue` detail, beside the origin badge. Facts stay
  unbadged (the default; a badge on every row is noise). i18n `memory.common.kind.rule.label`: `Rule`.
- Rejected: a kind column or filter in the list (no ask), badge for facts.

### D3. Prompts: rules accepted, examples and tables

New fragment `memory.kinds` (KindFragment, title/description/usedBy keys like `memory.dataHygiene`), included by
`memory.gate.system`, `memory.import.extract.system`, `memory.import.finalize.system`, `memory.merge.system`
(each lists it in `RequiredFragments`). Default text (checkprompts style applies; implementer may tighten words, not
meaning):

```
A memory is a fact or a rule.
- Fact: a durable claim: a decision with its reason, a rejected alternative with why, a convention, configuration, a name, ownership, a relationship, a constraint, how something works.
- Rule: a standing, general imperative that holds beyond one task, with its reason: "Never write amounts as floats, because the ledger rejects fractions." Keep it a short imperative; keep must, never and only.
- Not a memory: a question, a one-off task or request, one step of a procedure.
- An example is never a memory by itself. Keep one inside a fact or rule only when the rule is hard to state without it (an exact command, format or error string), it fits on one plain-text line without backticks, and the source states it. Otherwise point to the path where it lives. The reason carries the why.
- A table or a list of run results is not a memory. Keep one headline figure only when it is the evidence for a conclusion the text states; drop the rest.
```

Per prompt:
- Gate: include the fragment after hygiene. Challenge bullet `the fact is a question, an instruction or a task rather
  than a durable statement` becomes `the item is a question or a one-off task, not a durable fact or rule`. Step 1:
  `A rule stays an imperative.` Reason bullet unchanged (a rule without a reason is challenged). No-challenge
  paragraph: `is a question or an instruction` becomes `is a question or a one-off task`. Add `"kind": "rule" for a
  rule, else "fact".` Schema gains `kind`.
- Extract: include the fragment; `One claim per fact` becomes `One claim or rule per fact`; `Keep durable knowledge
  only: …` becomes `Keep facts and rules only (see above).`; skip list: `examples copied verbatim, step-by-step
  commands` becomes `standalone examples, step-by-step procedures (keep a rule they state), tables and run results
  (see above)`; keep-verbatim list gains `template variables`. Schema unchanged (kind is decided downstream).
- Verify: one sentence after the verdict list: `A fact may be a rule: an imperative with its reason. A rewritten rule
  stays an imperative.`
- Finalize: steps 1 to 3 move into fragment `memory.merge.rules` (D5); step 3 drop list becomes `not a memory (see
  above), trivia, time-bound or navigation`. Steps 4 to 7 renumber nothing (fragment keeps numbers 1 to 3).
- `memory.mcp.remember.message`: `the durable facts` becomes `the durable facts and standing rules`.
- Reconcile: D1 sentence only.

Rejected: a separate rule-only prompt (two classifiers drift); keeping `instructions` mode (SPEC: one mode).

### D4. No-store: `ingest_files` flag `distill`

- Name: `distill` (bool, default false). Agents and docs already know "distill" for "condense, store nothing"; the
  flag keeps that word on the one tool. Rejected: `store` default true (needs a pointer bool, inverted default in the
  schema), `dryRun`/`preview` (suggest a later real run), `noStore` (negative flag).
- Input: exactly one of `text` (new arg, at most `MaxDistillRunes` = 120 000 runes, markdown chunking, source name
  `text.md`) or `paths` with exactly one absolute file (not a folder). `text` without `distill` is refused
  (`to store text call store_memory, or save it to a file and ingest that`). With `distill`, every store-only arg is
  refused (`origin`, `sourceTag`, `scope`, `project`, `groups`, `writeDoc`, `session`): error `distill takes text or
  one file path only; it stores nothing`. `paths`, `origin` and `scope` become `omitempty` in `ingestInput` (schema:
  not required); Go requires `paths`, `origin` and `scope` when storing. Implementer checks the generated `required` list.
- Synchronous, in process, no job rows: the call returns the merged lines. Job tables model a durable, resumable,
  user-confirmed store; a no-store call has nothing to resume and its result belongs to the caller. Same contract as
  the old `distill` tool. The Engine and `db.go` are untouched.
- Stages (`importer.Distiller.Distill`, rewritten in `distill.go`), all through `ClaudeAgent` built from
  `Distiller{Runner, Prompts}` (fields unchanged, callers unchanged):
  1. Read and chunk: `distillSource` and `chunkFile` as today; limits `MaxDistillRunes`, `MaxDistillChunks` (16).
  2. Extract: `ClaudeAgent.Extract` per chunk, three at once (`distillWorkers`), the import's own `ExtractInput`.
  3. Build final facts with the import's code: factor `loadExtracted`'s per-chunk loop into a pure
     `chunkFinalFacts(rel, idx, headingPath, text string, facts []Fact) (ffs []FinalFact, verify []VerifyFact)` (ids
     `<chunk>.<n>`, `questionableIn`), used by both `loadExtracted` and `Distill`.
  4. Verify: when any fact is questionable, `ClaudeAgent.Verify` in `verifyBatch` batches over the source text
     (`Ext` from the path, `.md` for text). Missing verdict defaults to ambiguous via a helper shared with
     `Runner.verifyBatches`. Fold verdicts with a free `applyVerdicts(facts, verdicts) (kept []FinalFact, dropped
     []DroppedFact)`, which `extractedFile.applyVerdicts` now calls.
  5. Merge: one `ClaudeAgent.Merge` call (D5) when facts remain; none when zero facts (empty result). `tooManyFacts`
     guard reused: over it, `DistillError` reason `tooManyFacts`.
- No retry (as today): a transient failure fails the call; the caller retries. Rejected: the runner's backoff (it is
  built around job rows and the shared cooldown).
- Spend cap `DistillSpendCapUSD` 2.00 covers all stages: no extract chunk, verify batch or merge starts once the
  reported spend reaches it; the error names the amount (unchanged text). Cancel: ctx cancels running calls.
- Progress: `DistillProgress{Stage, Done, Total, CostUSD}`, `Stage` `extract` (Total = chunks), `verify` (Total =
  batches), `merge` (Total 1). First event `extract` 0 after chunking.
- Result: `DistillResult{Lines []Line{Text, Kind}, Unresolved []UnresolvedFact, CostUSD, Chunks, InRunes, OutRunes}`.
  Dropped facts are not returned (the source keeps them; an agent asked for lines).
- MCP output: `ingestOutput` gains `lines` (`[{text, kind}]`), `unresolved`, `costUsd`, all `omitempty`; `jobId`,
  `state` become `omitempty` (empty for distill). Text: lines in source order, one per line, no kind prefix (paste
  ready for a comment or prompt; a rule already reads as an imperative; kind is in the structured result). When
  unresolved is non-empty: a blank line, then `unresolved: <fact> | <questions joined by space>` per fact.
- `ReadOnlyHint`: `ingest_files` stays as annotated (it can write); description says distill stores nothing.

### D5. Merge shared with import finalize step 1

- Fragment `memory.merge.rules` (KindFragment) holds finalize steps 1 to 3 verbatim from today's text, except: step 2
  `A fact that stays ambiguous is not stored` becomes `is not kept`; step 1 adds `Never merge a rule with a fact.`;
  step 3 per D3. `memory.import.finalize.system` includes it in place of steps 1 to 3 (store behaviour and cost of
  import unchanged; one run per file as today).
- New system prompt `memory.merge.system` replaces `memory.distill.system` (deleted; `DistillVars` becomes
  `MergeVars{MaxLines int prompt:"required"}`, example 640). Text: hygiene, `memory.kinds`, input line (`"document"`
  (path, title, chunks), `"facts"` with id, chunk, section, evidence, unresolved; no reason, no provenance),
  `memory.merge.rules`, then:

  ```
  4. Return every other fact in "lines", in document order. "kind": "rule" for a rule, else "fact". "text": the shortest plain form that keeps the meaning: active voice, present tense where true; cut filler, hedges and pleasantries. Keep exactly negations, numbers, units, names, code identifiers, paths, error strings and template variables. One plain-text line: no Markdown, no backticks. At most {{.MaxLines}} lines.
  ```

  Schema: `{"lines": [{"text", "kind": enum}], "unresolved": [{"fact", "questions"}], "dropped": [{"fact", "why"}]}`.
- `Agent` interface gains `Merge(ctx, MergeInput) (MergeOutput, error)`; `ClaudeAgent.Merge` in new
  `importer/merge.go`: no tools, no MCP, `mergeLimits(facts)` mirroring `finalizeLimits` shape with constants
  `mergeBaseTimeout 120s`, `mergeBatchTime 30s`, `mergeMaxTimeout 10m`, `mergeBaseBudget 0.20`,
  `mergeBatchBudget 0.05`, `mergeMaxBudget 1.00`. `cleanLines` (moved from `distill.go`): trim, fold breaks, drop empty
  or over `MaxFactLen`, kind must be `fact`/`rule` (empty means fact), cap `MaxLines`. Test fakes (`recAgent`,
  `fakeAgent`) gain a `Merge` method.
- Rejected: splitting import finalize into a merge call plus a store run (one extra call per import file, changes
  measured import cost and eval baselines for no gain to import); one finalize prompt with a `{{if .Store}}` switch
  (one entry with two schemas and two tool sets is harder to read and edit than two entries sharing a fragment).

### D6. `distill` MCP tool removed; `instructions` mode removed

- Remove the tool: delete `mcpserver/distill.go`, `MemoryToolDistill` and its 3 args, budget lines, the server doc
  comment mention. `Options.Distill` stays (it is what `ingest_files` calls with `distill: true`); `addIngestTools`
  uses it; nil means distill is refused with `distill is not available in this server`. One tool: agents never pick
  between two entry points with one core; one description to keep in budget. A stale client gets the SDK's unknown
  tool error; instructions change with the next session. Rejected: a thin alias (a second description and schema to
  maintain, and agents keep choosing it).
- Mode: delete `ModeFacts`, `ModeInstructions`, `distillMode`, `DistillRequest.Mode`, `DistillVars.Instructions`.
  Bridge `MemoryDistillArgs.Mode` goes (a stale `mode` field from an old frontend is ignored by JSON decoding).
- `promptdistill`: delete `internal/llmprompts/cmd/promptdistill` (P289's one-off drafting tool; its drafts are
  applied, it was the only `ModeInstructions` caller, and the UI Distill view and `ingest_files distill` do the same
  job on pasted prompt text). Remove its `docs/DEV_ENVIRONMENT.md` row; `docs/ARCHITECTURE.md` P289 sentence becomes
  `promptdistill (deleted in P297) drafted ...`. Rejected: porting it to the new pipeline (no further use planned).

### D7. Doc format `kira-memory: 3`

Layout:

```
---
kira-memory: 3
group: kg_...
title: Billing
from: docs/billing.md
origin: user
scope: project
project: github.com/acme/billing
updated: 2026-10-18
---

## Facts

- km_aaaaaaaaaaaa Top-level fact with no source section.

### Amounts

- km_7h3kq9x2mfa4 Amounts are integer cents.

## Rules

### Amounts

- km_bbbbbbbbbbbb Never write amounts as floats.
  The ledger rejects fractions.
```

- Parser (`ParseDoc`), v3 body rules: `## Facts` and `## Rules` (exact) set the category and reset the section to
  ""; each at most once (`## Facts appears twice`); any order. `### <text>` sets the source section inside a
  category; before any category it is a problem. Any other heading (`#`, other `##`, `####`+) is a problem
  (`headings are ## Facts, ## Rules and ### <source section>`). A fact line before a category is a problem
  (`fact before ## Facts or ## Rules`): a reported problem, not an implied `Facts`, because the writer always prints
  the category and one strict rule keeps grep and hand edits predictable. Fact and reason lines unchanged.
  `memfmt.Fact.Kind` set from the category. Locator unchanged: `Stated in <from>, <section>` uses the `###` source
  heading, never the category.
- Version handling: `kira-memory: 1` and `kira-memory: 2` stay in scope (front matter parsed, group returned) and
  yield one problem each and no facts. v2 message: `kira-memory: 2 is retired (P297); rewrite it as kira-memory: 3
  with facts under ## Facts, rules under ## Rules and source headings as ###`. v1 message points at
  `kira-memory: 3`.
- `DocLineSource`: `kira-memory: 3`; headings `## (Facts|Rules)|### [^[:space:]].*` replace `#{1,6} …`.
  `TestRegexMatchesParser` keeps proving every parser-valid line matches.
- Formatter (`FormatDoc`): writes `kira-memory: 3`; `## Facts` with facts in input order, then `## Rules`; a category
  with no facts is omitted; `### <section>` wherever the section changes within a category; the "sections cannot
  end" rule applies per category; `checkFact` also requires kind `fact` or `rule` (empty means fact).
- `RenderDoc` (`writedoc.go`): `memfmt.Fact.Kind = m.Kind`; the running section is tracked per kind. `writeDocFile`
  accepts an existing doc of the same group when it has no problems or its version is below 3, so a write-back
  migrates a v2 doc of its own group in place. Other v2 docs: migrate by hand (D9 site text) or re-ingest the source
  with `writeDoc`.
- `ApplyDoc`: `commitInput.Kind = f.Kind`; `sameDocFact` also compares kind (a kind change is a new version).
- `memcheck`: cross-file drift also reports a kind mismatch for one id (`differs from`). No other change.
- Import of a v3 doc: `parseMemdoc`/`finalizeDoc` unchanged in shape; kinds reach the store through `ApplyDoc`. A v2
  doc fails the file with the v2 message (`docError`).
- Fixtures to v3: `memoryflow/testdata/memdoc/billing.memory.md` (add one rule under `## Rules`),
  `memfmt_test`, `memcheck/check_test`, `importer/{engine,writedoc}_test`, flow `ingest_test`, eval
  `memory_eval_footprint_test.go:251` check and `memory_eval_retrieval_test.go:341` `Version: 3`.
- Rejected: reading v2 as legacy facts (SPEC: v1 precedent, one problem); a `kind:` field per fact line (breaks the
  `- <id> <text>` grep shape).

### D8. Chunker: repeat a split table's header

Fix it (small, and the D3 tables rule needs readable headline rows): `ChunkMarkdown` adds goldmark's own GFM table
extension (`extension.Table`, already in the `goldmark` module; library rule) to the parser and records each
table's span plus its header and delimiter lines. When `sizeUnits` splits an oversize unit, each piece that starts
inside a table (after its delimiter row) is prefixed with that table's header and delimiter rows; the piece budget
accounts for them. Pieces never start inside the header. Unit test (boundary arithmetic, qualifies under the test
bar): a 3-column table of about 15 000 chars yields at least two chunks, every chunk holding table rows starts with
the header and delimiter rows, and no row is lost or duplicated. Rejected: forbidding cuts inside tables (a table
over `Max` must still be cut); dropping tables before extract (the headline-figure rule needs them).

### D9. UI: Distill view and Import as document

- `DistillView.vue`: delete the mode `SecondaryTabs`, `MODES`, the mode hint; one static hint
  `memory.distill.hint`: `Facts come back as short claims and rules as short imperatives. Negations and numbers stay.`
  `distillStore.ts`: delete `mode`. `DistillMode` type and `DistillArgs.mode` go
  (`packages/shared/domain/memoryDistill.ts`).
- Wire: `distillResultSchema.lines` becomes `z.array(z.object({text, kind: memoryKindSchema}))`, adds
  `unresolved: z.array(z.object({fact, questions}))`; `distillProgressSchema` adds `stage`
  (`z.enum(['extract','verify','merge'])`). Go: `MemoryDistillResult.Lines []importer.Line`, `Unresolved`;
  `MemoryDistillProgress.Stage`. `outChars` counts line texts joined by newline (as Copy copies). Regenerate bindings
  (`wails3 task common:generate:bindings`).
- `DistillResult.vue`: `Rule` badge on rule lines (`KIND_LABEL`); Copy, Store and Import as document pass
  `line.text`. When `unresolved` is non-empty, a list under the lines, heading `memory.distill.unresolved.title`
  (`Unclear, left out`), each fact with its questions. `DistillProgress.vue`: stage label keys
  `memory.distill.progress.{extract,verify,merge}.status` (`Reading parts`, `Checking against the source`,
  `Merging lines`), with done/total.
- `AddMemoryDialog.vue` lines mode: `lines` prop stays `string[]` (caller maps texts); the gate decides kind.
- `ToImport` unchanged (lines in, markdown doc, normal import job). Rejected: writing a v3 doc from the lines (they
  have no ids or provenance; the import confirm sets provenance).
- `Limits()` unchanged. New error key `backend.space.memory.distill.tooManyFacts.body` (`The text yields too many
  facts for one merge. Split it.`), mapped in `distillReasonKeys`.
- Delete i18n `memory.distill.mode.*`, `llmPrompts.entry.memoryDistillSystem.*`; add
  `llmPrompts.entry.{memoryMergeSystem,memoryKinds,memoryMergeRules}.*`, the keys above. Copy rules (check-copy)
  apply; catalog `--unused` must stay clean.

### D10. MCP texts (`internal/llmprompts/registry.go`)

- `memory.mcp.instructions`: store paragraph `Store a durable fact or decision` becomes `Store a durable fact,
  decision or standing rule`; `fact:` bullet adds `or a rule: an imperative that holds beyond this task`; reason
  bullet unchanged. Replace the distill sentence with: `Condense text or one file into short lines without storing
  (for a comment or a prompt too): call ingest_files with distill true and text or one absolute path; do not Read the
  file first.` Recall: `an indented meta line (version, kind, origin, scope)`.
- `memory.mcp.tool.store_memory`: `Store facts in long-term memory.` becomes `Store facts and standing rules in
  long-term memory.`; add `A question or a one-off task is challenged.`
- `memory.mcp.tool.search_memories`: `Meta lines show provenance` becomes `Meta lines show kind (fact or rule),
  provenance`.
- `memory.mcp.tool.ingest_files`: `Store the facts of files` becomes `Store the facts and rules of files`; add `With
  distill true, stores nothing and returns the merged lines of text or one file; the call waits for them.`
  Args: `paths` adds `; with distill exactly one file`; new `text`: `text to distill, at most {{.Max}} characters;
  only with distill true` (`MaxVars{Max: importer.MaxDistillRunes}`); new `distill`: `true: store nothing and return
  the merged lines; takes text or one path and no other argument; default false`.
- `memory.mcp.tool.ingest_status`: unchanged.
- `testdata/budget.tsv`: delete `memory.distill.system`, `memory.mcp.tool.distill*`; add `memory.kinds`,
  `memory.merge.rules`, `memory.merge.system`, the two new args; set changed entries to their rendered sizes (`go run
  ./internal/llmprompts/cmd/checkprompts` prints them). `go test ./internal/llmprompts -run TestGolden` (no golden
  covers these; run anyway).

### D11. Docs

- `site/.../reference/memory-formats.md`: doc format section rewritten for v3 (layout above, category and `###`
  rules, missing category is a problem, locator uses the source heading); retired formats paragraph adds v2 with the
  hand migration (wrap facts under `## Facts`, demote source headings to `###`, move rules under `## Rules`) or
  re-ingest with `writeDoc`. `sources:` unchanged unless a path moves.
- `reference/mcp-tools.md`: delete `### distill`; `ingest_files` documents `distill` and `text`, the refused
  combinations, limits (120 000 characters, 16 parts, 2 USD), stages and the output (lines, unresolved);
  `store_memory` mentions rules and the challenge of one-off tasks; search meta line shows kind.
- `space/memory.mdx`: "Condense text with distill" rewritten: agents call `ingest_files` with `distill`; the UI runs
  the same pipeline, one mode, rules marked `Rule`, unclear lines listed; memory list shows a `Rule` badge.
- `docs/ARCHITECTURE.md`: tools list (line ~4856) drops `distill`, `ingest_files` gains `distill`/`text`; "Text
  formats"/"Doc format" bullets to v3; "Distill (P285 Part 2)" and "Part 4 (UI)" bullets rewritten to P297's pipeline
  (stages, limits, progress stages, wire shapes, no job rows); "Formatted docs" bullet (~5022) to v3; schema-bound
  prompts list (~5266) `distill` becomes `merge`; new `kind` bullet (D1, D2); delete Known open item "Memory import
  is not unified with distill" (resolved: one pipeline, the extract prompt).
- `docs/DEV_ENVIRONMENT.md`: delete the `promptdistill` row; real `claude` rows keep their test names (D12); record
  measured spend.

### D12. Tests (CLAUDE.md test bar, split at the IPC boundary)

Unit (complex logic only): `memfmt_test` v3 parser rules (categories, `###`, repeats, missing category, v1/v2
problems), formatter round trip with both kinds, regex-vs-parser; `chunk_test` table header (D8); `check_test`
drift fixtures to v3 plus one kind-mismatch case. No test for the migration, `validateGate` kind default,
`checkDecision` kind guard (one `if` each).

Flow (backend half) and UI spec (frontend half), per feature:
- Kind: flow `memoryflow` store test via the bridge with a fake gate answering `kind: rule`: `Recent` returns
  `kind: rule`, outcome `kind: rule`; contract `memory.json` rewritten (`KIRA_CONTRACT=write`). UI
  `memory-module.spec.ts`: a mocked rule memory shows the `Rule` badge, a fact shows none.
- No-store pipeline: flow `distill_test.go`: `TestMcpDistill` becomes `TestMcpIngestDistill` (fake extract answers
  for two chunks sharing a duplicate claim, a fake merge answer; assert text lines, structured kinds, `unresolved`
  rendering, no `kira:memory:changed`, no job created, tool list has no `distill`, refusals: `distill` plus `origin`,
  `text` without `distill`, a folder path). `TestBridgeDistill`, `TestBridgeDistillCancel`,
  `TestBridgeDistillSpendCap` keep their behaviour with extract and merge prompts scripted, progress stages
  asserted; contract `memory-distill.json` rewritten. `fakeagent.promptDoc` comment updated (the `source` field is
  no longer a distill input). UI `memory-distill.spec.ts`: no mode tabs, static hint, rule badge, unclear list,
  stage label; `mockRuntime` and `ipcChannels` updated.
- v3 doc: flow `ingest_test` memdoc case applies the rule as `kind: rule` and the write-back doc has `## Facts` and
  `## Rules`; a v2 doc fails with the v2 message. Backend only (no UI surface).
- Visual: `tests/visual/memory.spec.ts` distill snapshot changes (mode tabs gone): re-record after confirming Inter
  per `docs/DEV_ENVIRONMENT.md` "tests/visual/* pixel diffs".

Real `claude` (opt-in, prove the prompt changes steer):
- `TestMemoryGate`: add `assertGateKinds`: `Never write amounts as floats.` with reason `The ledger rejects
  fractions.` stores with kind `rule`; `Fix the failing test in billing_test.go now.` with reason `CI is red.` is
  challenged; `Always run the linter.` with reason `because` is challenged; the existing billing-api fact has kind
  `fact`.
- `TestMemoryDistill`: the agent calls `ingest_files` with `distill: true` and the path; no `store_memory`; lines
  non-empty.
- `TestMemoryDistillBridge`: text of two sections over the chunk minimum fill, each stating `billing-api listens on
  port 8080`, plus one rule sentence with a reason: exactly one line mentions `8080` (cross-chunk merge), at least one
  line has kind `rule`.
- `TestMemoryMcpFollowsDocs`: tools list drops `distill`; subtest `distill` expects `ingest_files` with `distill`
  true and the path, no text, no store, no Read of the file.
- `TestMemoryImport`: add one rule sentence with a reason to its fixture; assert one stored memory with kind `rule`.

Eval (concrete question: does the extract wording regress recall?): one subset round, `KIRA_EVAL_ONLY` the P289
5-source subset, cap 2 USD, compared with the P289 baseline round; record `R_ess`, `P`, `C_store` in the result.
A drop of `R_ess` beyond the noise band goes back to the prompt wording, same phase.

## 3. Commit groups (Conventional Commits, in order)

1. `feat(memory): memories have a kind, fact or rule`: D1 migration, model, store, gate prompt and schema
   (fragment `memory.kinds` added here), reconcile guard and sentence, `FactOutcome.Kind`, MCP meta and store
   text (D2), budget lines for gate, reconcile and `memory.kinds`, fake gate answers left as is (empty means fact),
   kind flow test, contract.
2. `feat(space): memory list marks rules`: D2 UI (schema, labels, badges, i18n), UI spec.
3. `feat(memory)!: kira-memory doc format 3 with Facts and Rules`: D7 memfmt, writedoc, applydoc, memcheck,
   fixtures and tests. Footer `BREAKING CHANGE: kira-memory: 2 docs are retired; rewrite them as kira-memory: 3.`
4. `fix(memory): chunker repeats a split table's header`: D8 and its test.
5. `feat(memory): import prompts keep standing rules`: D3 extract, verify, finalize (fragment `memory.merge.rules`),
   remember message, budget.
6. `feat(memory)!: ingest_files distill runs the import pipeline; distill tool removed`: D4, D5, D6 Go side
   (`distill.go` rewrite, `merge.go`, `Agent.Merge`, shared helpers, `memory.merge.system`, `memory.distill.system`
   removed, mcpserver ingest and distill.go removal, memorycli, bridge Go, promptdistill deleted, error key), flow
   tests, contracts, `fakeagent` comment. Footer `BREAKING CHANGE: the distill MCP tool and its mode argument are
   removed; call ingest_files with distill true.`
7. `feat(space): distill view runs one mode and shows rules`: D9 frontend, bindings, i18n, UI spec, visual baseline.
8. `feat(memory): agent docs describe rules and ingest distill`: D10 texts, budget sizes, real `claude` test updates.
9. `docs: memory rules and one distill pipeline`: D11.
10. `docs(v2.6): P297 result`: result section here, SPEC row status.

## 4. Verification (run once near the end; fast checks per commit)

- Per commit: `go build ./...`, `bun run typecheck`, `bun run lint`, pre-commit hook clean (never `--no-verify`).
- `go test ./internal/memory/... ./internal/llmprompts/...`; `go run ./internal/llmprompts/cmd/checkprompts`.
- Flow: `CGO_ENABLED=1 KIRA_CONTRACT=write go test ./apps/kira-space/internal/flows/memoryflow/ -run
  'TestMcpIngestDistill|TestBridgeDistill|<kind test>|<ingest memdoc test>'`, then the whole package without
  `KIRA_CONTRACT`.
- UI: `npx playwright test --config=apps/kira-space/playwright.config.ts --project=ui memory-distill memory-module
  copy-coverage`, then the visual `memory` spec.
- `bun run lint:rules`, `bun run lint:dead` (knip), `bun run lint:go`, `bun run lint:claude`.
- Greps that must return nothing outside `docs/v2.5/`, `docs/v2.4/` and `docs/v2.6/plans/`: `ModeInstructions`,
  `ModeFacts`, `DistillMode`, `memory.distill.system`, `MemoryDistillSystem`, `MemoryToolDistill`, `distillCall`,
  `promptdistill` (except the ARCHITECTURE history sentence), `memory.distill.mode`, `kira-memory: 2` (except the
  retired-format texts, the v2 message and its tests), `__distill` (except the real `claude` assertion that the tool is
  gone).
- Built `kira-space`: `memory-check` at repo root exit 0; temp repo with a staged v2 doc exits 1 with the v2
  message; a v3 doc with both categories exits 0.
- Schema check: in `TestMcpIngestDistill`, assert the `ingest_files` input schema's `required` list holds none of
  `paths`, `origin`, `scope` (D4).
- Real `claude` rows (`docs/DEV_ENVIRONMENT.md`, append `-count=1`): the prompt-registry row (covers gate, MCP,
  import, ingest, distill rows), plus `bun run test:claude:studio`. Then the eval subset round (D12). Record spend and
  numbers in the result section.

## 5. Out of scope

Kind filters in search or the UI; reclassifying stored memories; an item `kind` argument; changing import job
tables, Engine or runner scheduling; a v2-to-v3 converter command; MCP progress notifications for distill.

## 6. File ownership

One implementer owns every file named in sections 2 and 3. Streams rejected: the kind column (group 1) is read by
the v3 doc (group 3) and the merged lines (group 6); the `memory.kinds` fragment (group 1) is included by groups 5
and 6; groups 6 and 7 share the distill wire shapes. Each depends on the one before.

## 7. Result

Done. 10 commit groups on `v2.6`, in plan order; no push, no tag.

Commits: `4671aba6` kind; `3e3d9772` list marks rules; `9a02ec85` doc format 3; `a25d6ac9` chunker table header;
`fc31e42d` import prompts keep rules; `4a75376b` ingest_files distill, distill tool removed; `cc9fc3be` distill view;
`c64994b9` agent docs; `3318f389` docs; `d771ed81` real `claude` row asserts; this result commit.

Deviations from the plan:

- D10 texts (instructions, tool and arg descriptions, remember message) landed in group 6 with the tool removal, not
  group 8: the removed `distill` tool left no valid instruction text. Group 8 holds the real `claude` row changes.
- `chunkFinalFacts` takes no `judged` filter; `loadExtracted` filters verdicts itself.
- `fakeAgent` in `importer/engine_test.go` was the only fake needing `Merge` (no `recAgent` in the importer tests);
  `recAgent` in `tests/claude/memory_eval_test.go` got a pass-through `Merge`.
- `TestMemoryDistillBridge` text needs filler in both parts: a tail chunk under `MinTail` merges back into the
  first, so a short second part gives one chunk.
- `TestMemoryImport` asserts the restore rule is stored with kind `rule`, not "exactly one rule": the unchanged
  fixture sentences "Never call billing-api directly...", hotfix write-up and "only fixes linked to a defect" are rules too (4 stored rules).
- `spend-p297.jsonl` and `round-p297-01` sit in `docs/v2.5/plans/P285-runs/` (harness-fixed dir).

Verification (all run after the last code commit, tree at `d771ed81` plus docs):

- `go build ./...`, `go vet`, `bun run lint` (biome, rules, checkprompts, check-docs), `bun run lint:go` (0 issues),
  `bun run lint:claude` (0 issues in both modules), `bun run lint:dead` (knip clean), `bun run typecheck`: clean.
- `go test ./internal/... ./apps/kira-space/...` with `CGO_ENABLED=1`: all packages ok (memory, importer incl. table
  header test, memfmt v3 parser and regex-vs-parser, memcheck kind drift, llmprompts goldens, memoryflow).
- Flow: `TestStoreRule`, `TestMcpIngestDistill` (no `distill` tool, `ingest_files` schema `required` lacks
  `paths`, `origin`, `scope`; 13 refused argument shapes; no job, no `kira:memory:changed`; merge input holds both parts),
  `TestMcpIngestDistillCrossChecks`, `TestMcpIngestDistillSpendCap`, `TestBridgeDistill*` (stage progress), v3
  doc cases (`TestImportFormattedDocParsesOnly`, write-back with `## Facts` and `## Rules`, `TestImportRetiredV2DocFails`).
  Contracts rewritten with `KIRA_CONTRACT=write`: `memory`, `memory-distill`, `memory-import`, `restart`.
- UI: `memory-distill`, `memory-module`, `copy-coverage`, `settings-llm-prompts`, `list-keyboard`,
  `memory-import`, `memory-provenance`, `settings-memory` all pass. Visual `memory` baseline re-recorded after
  `fc-match sans-serif` printed Inter.
- Greps: `ModeInstructions`, `ModeFacts`, `DistillMode`, `memory.distill.system`, `MemoryDistillSystem`,
  `MemoryToolDistill`, `distillCall`, `memory.distill.mode`, `__distill` return nothing outside excluded dirs;
  `promptdistill` only in the ARCHITECTURE history sentences; `kira-memory: 2` only in retired-format texts and tests.
- Built `kira-space` (`-tags server`): `memory-check` at repo root exit 0; temp repo with a staged v2 doc exit 1 with
  the v2 message; staged v3 doc with both categories exit 0.
- Real `claude` rows (CLI 2.1.302): gate (`assertGateKinds`: rule stored as `rule`; one-off task and `Always run the
  linter.` with reason `because` challenged), `TestMemoryDistill`, `TestMemoryDistillBridge` (2 parts, one 8080 line, one
  rule line), `TestMemoryMcpFollowsDocs`, `TestMemoryMcpThroughClaude`, `TestMemoryInstallRegisters`, `TestMemoryImport`,
  `TestMemoryIngestThroughClaude`, ADE and smart script rows, `test:claude:studio`: pass. In the first full
  run `TestMemoryMcpFollowsDocs` failed and `TestMemoryImport` failed (my "exactly one rule" assert); the Docs test passed
  twice on rerun, cause of the one failure not captured (the run's output was filtered); likely model variance with the Go suite running at the same time.
- Eval subset (`round-p297-01`, 5-source subset, cap 2 USD, `KIRA_EVAL_PHASE_CAP_USD=4`: the harness reserves 2 USD,
  so a phase cap of 2 skips every source). Against the mean of `round-p289-00a`/`00b`: `R_ess` 0.899 (0.871, up),
  `R_all` 0.721 (0.712), `P` 0.521 (0.635; the two baselines differ by 0.106 on `P`, 00a alone 0.582), unsupported 0.014 (0.006;
  one fact in 73), `C_fact` 0.444 (0.443), `C_store` 0.654 (0.658 / 0.702). No `R_ess` drop, so the extract wording stays.
  The `P` figure sits under the P289 pass line (reference minus 0.065 = 0.570 on the mean) and inside the baseline
  noise; one confirmation round was not run (cap).

Costs (USD): eval round 1.503 (ledger `spend-p297.jsonl`); real `claude` rows about 0.30 in all: gate 0.005 to 0.03,
distill bridge 0.030, distill tool 0.03, docs row 0.022 per run (3 runs), import 0.114 per run (2 runs), prompt-registry
row 0.082 (`claude -p` meter), studio under 0.01.

Not verified: the macOS-only paths; a rerun of the eval round; why the first `TestMemoryMcpFollowsDocs` run failed.
`git fetch --depth=1 origin 9ed83ae8...` was needed for the eval corpus commit (shallow clone), repo state otherwise unchanged.
