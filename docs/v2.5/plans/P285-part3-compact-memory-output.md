# P285 Part 3 plan: compact memory output

Ask (SPEC row P285 Part 3, decisions final there): (a) merge very closely related facts into one denser
fact in the store step and its prompt; (b) drop the evidence quote unless it adds information, source
locator added by code, rationale inline only when stated and not obvious; (c) new compact, grep-first
text format for code-comment blocks and `.memory.md` docs: fact id once, no `fact:`, `reason:`,
`keywords:` prefixes; round-trip tests; compat decision; update `memfmt`, write-back, MCP texts, prompts,
site `memory-formats` page, ARCHITECTURE; (d) eval on the P285 harness, total cap 20 USD, `C_fact` and
the whole stored footprint clearly below Part 1, `C_doc` measurement fixed, `R_ess` not below Part 2
beyond noise; (e) Opus plan, one Sonnet implementer, serial test-and-fix with real `claude` rows,
close-out, Artifact updated.

SPEC names the plan `plans/P285-part3-compact-memory.md`; this file is the plan. Close-out corrects the
SPEC row's plan path to `plans/P285-part3-compact-memory-output.md`.

Base: `v2.0` at `6ef32ad7d` (P285 Part 2 close-out). Discovery ran through `codegraph_explore`:
`memfmt` (`ParseDoc`, `ParseComments`, `FormatDoc`, `FormatComment`, `CheckText`, `StripMarkup`,
`Fact`/`Doc`/`Block`, `MarkersFor`, `CommentLineSource`/`DocLineSource`), callers `writeDocFile`/
`docText`/`docTitle`, `parseMemdoc`/`finalizeDoc`, `Service.ApplyDoc`/`applyDocFact`/`sameDocFact`,
`Service.Prepare`/`preparedFact`/`commentFor`, `memcheck.Check`, `mcpserver` `requestFor`/
`storeMemory`/`commentMarker`/`Options`, `runGate`/`validateGate`/`cleanKeywords`, `ClaudeAgent.Finalize`/
`Extract`/`cleanFacts`, `Fact`/`FinalFact`/`FinalizeInput`, `loadExtracted`/`finishChunk`/`claimChunk`,
registry `MemoryGateSystem`/`MemoryReconcileSystem`/`MemoryImportExtractSystem`/
`MemoryImportFinalizeSystem`/`MemoryMcpInstructions`/`MemoryToolStoreMemory`. Targeted reads (nested
module not indexed, or not code): eval harness `apps/kira-space/tests/claude/memory_eval*_test.go`,
`memory_test.go`, `memory_docs_test.go`; `mcpserver/server.go` `writeMemory`; P285 plan, Part 2 plan,
report; ARCHITECTURE memory sections; DEV_ENVIRONMENT real `claude` rows; site `reference/memory-formats.md`,
`space/memory.mdx`, `reference/mcp-tools.md`; `en.json` memory prompt entries; `P285-runs/*/facts.jsonl`
size split (below).

Out of scope (decided): unified distill import (Part 2 reverted it; user said leave the extract plus
verify split); extract and verify prompts and schemas (extract keeps `evidence` for the cross-check);
chunk budget; ranking and keyword generation (P275); reconcile prompt; distill tool and UI (Part 4);
judge prompts and golden (frozen); DB schema.

## 1. Where the bytes go today

`round-p2-final` tuning, per source (chars): plan-p257 fact 4066, reason 3476, keywords 2517, written
doc 13482; doc-readme fact 7161, reason 4884, keywords 5221, doc 24193; cmt-runner-go fact 2449, reason
817, keywords 1673, doc 7528. So a P273 doc is about 3x the fact text: reason (evidence quote plus
locator) about 0.6 to 0.9x, keywords about 0.6x, and per fact three id-prefixed lines plus a blank line
(about 70 chars). `round-final` (Part 1) has no doc for 9 of 15 sources (write-back bug, since fixed),
so its `C_doc` was never measured.

## 2. Decisions (final)

Format:

- D1. Doc format version 2: line 2 `kira-memory: 2`. Why: the file states its own grammar; a stray v1
  file gets a precise message instead of silent prose ingest.
- D2. No compatibility reader, no migration. A `kira-memory: 1` doc is in scope and yields one problem
  (`kira-memory: 1 is the retired P273 format; rewrite it as kira-memory: 2`); front matter still parses,
  so write-back may overwrite a v1 doc of the same group. A comment line `<id> fact: ...` or
  `<id> reason: ...` yields `'<id> fact:' and '<id> reason:' lines are the retired P273 format; write
  '<id> <fact>' and an indented reason line`. Why: P273 landed 2026-10-12, after the last release
  v0.2.2 (2026-10-07); only dev files and one fixture hold it, so a reader for both grammars is cost
  with no user.
- D3. Stored data: no rewrite. Existing facts keep their reasons (evidence quotes included) and
  keywords. Why: stored reasons are provenance history; the format is only a rendering, the DB schema
  does not change.
- D4. Comment block: header unchanged (`kira-memory origin=<o> [source=<tag>] scope=<s>`); each fact
  is `<id> <fact text>`; an optional reason is the next comment line with text indented by exactly two
  spaces. No keywords. Why: id once, no prefixes; the indent ties the reason to its fact without an id.
- D5. Doc body: headings set the section; each fact is a list item `- <id> <fact text>`; an optional
  reason is the next line indented by exactly two spaces; blank lines are free. No per-fact keywords.
  Why: a `.md` renders as a bullet list with the reason continuing its item; `grep -rn km_<id>` still
  hits one line holding the id and fact.
- D6. Per-fact keywords leave the doc format; the store keeps generating them (gate) for ranking. Doc
  front matter keeps its optional doc-level `keywords`. Why: keywords are a search index, not
  knowledge; grep and FTS already read the fact text; they were about 0.6x the fact text in docs.
- D7. New optional front matter key `from` (after `title`): the job-relative path of the source the
  facts were stated in. Key order: group, title, from, origin, source, scope, project, session, keywords,
  updated. Why: lets a reason-less fact rebuild its exact stored locator on re-import.
- D8. Source locator: `memfmt.Locator(path, section)` returns `Stated in <path>` or
  `Stated in <path>, <section>` (section whitespace collapsed, inline Markdown stripped, so it passes
  `CheckText`); `memfmt.ParseLocator(reason, path) (section string, ok bool)` is its exact inverse. One
  definition for importer, store and writer. Why: SPEC "locator added by code"; exact inverse makes
  write-back and re-import lossless.
- D9. Reason optional in both formats. Doc: a fact without a reason line takes
  `Locator(from or the doc's own job-relative path, section)` on apply. Comment: Reason `""`
  (memcheck only). Why: rationale rule; a reason that is only a locator repeats the doc's own header
  and heading.
- D10. Formatter refuses a comment fact text starting `fact: `, `reason: ` or `keywords: `. Why: keeps
  the D2 retired-line check unambiguous.
- D11. MCP text output (`search_memories`, `memory_history`, `memory_context`) follows the same layout:
  `<id> <fact>`, then `  <reason>`, then `  v<N> origin=... [source=...] scope=... [project=...]
  [match=...] [score parts] [historical] [ctx=N]`. Why: one grammar on every surface; id once saves
  output tokens per result; the meta line is self-identifying by its leading `v<N> origin=`.

Pipeline:

- D12. Evidence quote never stored. Extract keeps `evidence` for the cross-check (`questionableIn`);
  finalize still sees it and folds any information it adds into the fact text. Why: SPEC (b); one place
  for knowledge; the reason stays a pure, rebuildable locator.
- D13. `loadExtracted` sets each `FinalFact.Section` to the chunk's `heading_path` (code, not model)
  and a new `FinalFact.Reason` = `memfmt.Locator(f.Rel, headingPath)` (at most `memory.MaxReasonLen`
  runes). Why: Part 2 D8 design; the model-written section varied.
- D14. Import-mode store pins the locator: `StoreRequest.ImportPath` (Go-only, like `NoChallenge`),
  set by `mcpserver.requestFor` from `ImportProvenance.RelPath`. In `decide`, for every add or update
  of an import request, the committed reason is the item's reason when
  `ParseLocator(itemReason, ImportPath)` is ok, else `Locator(ImportPath, "")`. Noop keeps the stored
  version. Why: gate and reconcile rewrite reasons; the locator is provenance and must not drift.
- D15. Rationale rule: a reason the source states goes inline in the fact (`X, because Y`) only when the
  fact alone does not make it obvious; drop it when self-explanatory. Lives in finalize (where facts are
  merged and stored) and in the gate (for a fact that states its own rationale). Extract unchanged.
  Why: Part 1 recall gains came from extract; compaction belongs to the store step the SPEC names.
- D16. Merge step: finalize prompt merges facts about the same subject and the same aspect (fields of
  one type, values or limits of one setting, cases of one rule) into one fact keeping every qualifier,
  at most 300 characters; never across subjects. The gate stops splitting such a list: a sentence
  listing values, fields, cases or limits of one subject is one claim. Why: finalize is the one step
  that sees all of a file's facts; without the gate clause the store splits merges back.
- D17. Reconcile prompt unchanged. Why: it sees one fact against loose candidates and is shared with
  live stores; finalize already sees the whole file.
- D18. Write-back: `from` = job-relative path when header-safe, else empty; each stored fact whose reason
  `ParseLocator`s to that path takes that section as its heading and no reason line; any other reason is
  written in full under the running section. A locator without section after a section started is
  written in full (sections cannot end). Per-fact keywords not written. Why: the reason-less lines are
  the main saving and stay lossless (D7, D9).
- D19. `ApplyDoc`: `ApplyDocRequest.Path` (memdoc job-relative path). Reason-less fact: reason per D9.
  `sameDocFact` compares fact and resolved reason only. Update keeps the stored keywords; add takes the
  doc-level keywords. Why: round trip write, then re-import, is a noop for every fact.
- D20. `memcheck` cross-file rule: one id, one fact text; reasons compared only when both files state
  one. Why: a doc may omit a reason a comment states.
- D21. MCP texts: `memory.mcp.instructions` describes the result layout (`<id> <fact>`, indented reason
  and meta line; `ctx=N` in the meta line); `memory.mcp.tool.store_memory` says the store splits
  independent claims and keeps a list about one subject as one fact. `writeDoc` and `asComment` arg
  texts keep their meaning (format name only). Why: SPEC (c); docs must match behavior.

Eval:

- D22. `C_doc` fix: `C_doc` = runes of the doc that `importer.RenderDoc` (the exported pure renderer
  write-back uses) renders from the file's stored facts, front matter included, over source runes;
  computed for every source whether or not the write succeeded. The harness also re-parses the render
  (`ParseDoc` problems must be 0) and compares it with the written file when one exists (`docMismatch`
  in `scores.json`). Why: Part 1 read the written file, which failed for 9 of 15 sources.
- D23. New free harness mode `KIRA_EVAL_MODE=footprint` with `KIRA_EVAL_ROUNDS=<r1,r2,...>`: re-renders
  each listed round's `facts.jsonl` stored facts through `RenderDoc` (synthetic valid ids, origin agent,
  scope project, the eval project key, rel `<id>.<kind>`, fixed date) and writes
  `<round>/footprint-<p273|v2>.json` (per source and aggregate: source, fact, record, doc runes and
  tokens, facts, `C_fact`, `C_rec`, `C_doc`). No `claude`, no ledger. Never overwrites `scores.json`.
  Why: Part 1 and Part 2 footprints and the format-only gain cost nothing.
- D24. Ledger `spend-p3.jsonl` (`KIRA_EVAL_LEDGER`), `KIRA_EVAL_PHASE_CAP_USD=18.5`,
  `KIRA_EVAL_CAP_USD=6`; 1.5 USD kept for the real `claude` rows (their cost comes from test output,
  logged in the report). Why: SPEC caps the TOTAL at 20 USD.
- D25. Gates for the final tree (tuning aggregate):
  - `C_fact` <= 0.468 (Part 1 final 0.497 minus its band 0.029: "clearly below").
  - `C_doc` (v2 render) <= Part 1 `C_doc` (P273 render of `round-final`, from E0) minus the `C_doc` band
    (|00a - 00b| of E0 renders, at least 0.05).
  - `R_ess` >= 0.839 (Part 2 `round-p2-final` 0.859 minus the `R_ess` band 0.020). Also report it on the
    8 sources of `round-p2-04` (0.864 there).
  - Guard: unsupported + distorted <= 0.02 (Part 1 target). Why: merging can distort a qualifier.
  Reported, not gated: `R_all`, `P`, atomic (expected to drop: denser facts by design, frozen judge),
  standalone, duplicate, `reasonOk` (the frozen judge asks for a quote D12 removes), `C_rec`, stored
  count, mean fact length, locator share (stored reasons equal to this file's locator).
- D26. A gated metric outside its band gets one confirmation rerun when within 0.01 of its limit and the
  ledger allows; else it counts. A kept override lands verbatim in the registry, so that round measures
  the committed tree.
- D27. One sequential Sonnet implementer for code and eval; test-and-fix and close-out follow in order,
  resuming from disk. Why: memfmt, writer, harness and every round consume the previous commit.

## 3. Format by example

Go comment (from `store_memory` `asComment` or by hand):

```go
// kira-memory origin=user scope=project
// km_7h3kq9x2mfa4 Billing amounts are stored in cents, because the ledger rejects fractional values.
// km_2b8c4d6f8g0h Staging deploys at 09:00 UTC.
//   Release calendar fixes it.
```

Same block in CSS: `/* km_2b8c4d6f8g0h Staging deploys at 09:00 UTC. */` then `/*   Release calendar
fixes it. */` (marker, one space, two-space indent).

Doc written by import write-back (`docs/billing-runbook.memory.md` beside `docs/billing-runbook.md`):

```md
---
kira-memory: 2
group: kg_4m2x8q1b7c3d
title: Billing runbook
from: docs/billing-runbook.md
origin: agent
scope: project
project: github.com/acme/billing
updated: 2026-10-14
---

## Amounts

- km_7h3kq9x2mfa4 Billing amounts are stored in cents, because the ledger rejects fractional values.
- km_2b8c4d6f8g0h Refunds post on the next business day; partial refunds post the same day.

## Deploys

- km_9c2d4e6f8g1h Staging deploys at 09:00 UTC.
  Release calendar, confirmed by ops in March.
```

On re-import, `km_7h3kq9x2mfa4` gets reason `Stated in docs/billing-runbook.md, Amounts`, equal to the
stored one: noop. `km_9c2d4e6f8g1h` keeps its written reason.

Grep: `grep -rn km_7h3kq9x2mfa4` finds the fact line; `grep -rn -A1 <id>` adds the reason;
`grep -rnE '^- km_[0-9a-hjkmnp-tv-z]{12} '` lists doc facts.

Line regexes (ERE, Go and grep -E):

- `CommentLineSource` = `^[[:space:]]*(//|#|--|;|%|<!--|/\*) (kira-memory origin=(user|agent|external
  source=[a-z0-9-]{1,32}) scope=(company|project|personal)( -->| \*/)?|<FactID> [^[:space:]].*|  [^[:space:]].*)$`
- `DocLineSource` = `^(---|kira-memory: 2|(group|title|from|origin|source|scope|project|session|keywords|updated): [^[:space:]].*|- <FactID> [^[:space:]].*|  [^[:space:]].*|#{1,6} [^[:space:]].*|)$`

Parser rules, comment: in scope = text starting `kira-memory ` or `km_`, or a two-space-indented line
directly after a fact line of an open block (its reason). Any other line ends the block, unflagged
(legacy), including a second indented line. Kept checks: header grammar, marker and indent equal to the
header, closer and `--` rules, `CheckText` on fact and reason, duplicate id, empty block, fact without
header. New: retired v1 line (D2).

Parser rules, doc: front matter as today plus `from` (optional, header-safe) and line 2 `kira-memory: 2`
(`kira-memory: 1`: front matter only, one retired problem, `Doc.Version` 1). Body: blank lines, headings,
`- <id> <text>`, and one optional `  <text>` reason directly after a fact line. Anything else is a
problem. `CheckText` on fact and reason; duplicate id.

`memfmt` type changes: `Fact.Keywords` removed; `Doc.From`, `Doc.Version` added.

## 4. Prompt text

Finalize (`memory.import.finalize.system`), replace the input line and steps 1 and 4; `FinalizeVars`
loses `MaxReason`:

```
Input: "document" (path, title, chunks), "provenance" (origin, sourceTag, scope, project), "challenge", "facts": atomic facts extracted separately per chunk, in document order. Each has id, chunk, section, evidence quote, reason (source locator) and, when the chunk left something open, "unresolved".

1. Chunks were read independently. Merge duplicates and near-duplicates into one fact. Also merge facts about the same subject and the same aspect (fields of one type, values or limits of one setting, cases of one rule) into one fact that keeps every qualifier of each, at most 300 characters. Never merge facts about different subjects.
4. Store the rest with store_memory, at most {{.MaxItems}} items per call. Item origin, sourceTag, scope, project: the input "provenance" values (omit missing ones; the store enforces them). Item fact: standalone; keep a reason the facts or evidence state inline ("X, because Y") only when the fact alone does not make it obvious. Item reason: the fact's "reason", exactly; a merged fact takes the reason of its first fact. Never put an evidence quote in a reason.
```

Gate (`memory.gate.system`), replace steps 1 and 2 (rest unchanged):

```
1. Split it into independent claims, one fact each. A sentence listing values, fields, cases or limits of one subject is one claim: keep it one fact. One sentence each, about 20 words; a list about one subject may run to 300 characters. Rewrite each fact to the shortest plain form ... (rest of today's step 1 verbatim)
2. Attach the reason that supports each fact, in the same short plain style. A reason "Stated in <path>" or "Stated in <path>, <section>" is a source locator: keep it verbatim; it supports a fact from that document. A fact that states its own rationale ("X, because Y") keeps it only when the fact alone does not make it obvious.
```

Fakeagent keys (`gatekeeper of a long-term memory`, finalize opening line) stay. `en.json` texts stay
(purposes unchanged); recheck `memoryImportFinalizeSystem` and `memoryGateSystem` descriptions against the
new text and edit only if wrong.

## 5. Eval order (cap 20 USD, ledger `spend-p3.jsonl`)

Env for paid runs: `KIRA_EVAL_LEDGER=spend-p3.jsonl KIRA_EVAL_PHASE_CAP_USD=18.5 KIRA_EVAL_CAP_USD=6`.
Free checks first.

| step | what | USD est. | phase est. |
|---|---|---|---|
| E0 | `footprint` on `round-00a,round-00b,round-final,round-p2-final,round-p2-04`, P273 renderer (before C4) | 0 | 0 |
| E1 | same rounds, v2 renderer (after C4): format-only gain | 0 | 0 |
| E2 | smoke `round-p3-smoke`, `KIRA_EVAL_ONLY=json-ade-errors,cmt-claude-go`, full Part 3 tree | 1.0 | 1.0 |
| E3 | `round-p3-01`, tuning, full Part 3 tree | 4.5 | 5.5 |
| E4 | contingency (below), at most two runs | 9.0 | 14.5 |
| E5 | `round-p3-holdout`, `KIRA_EVAL_SET=holdout`, final tree | 2.0 | 16.5 |

E2 checks, before E3 spends: both sources `done`; render re-parses clean; locator share >= 0.9; no store
challenge naming a missing or weak reason; written doc equals render. A failure is a code fix, then E2
again (`round-p3-smoke2`).

E4 contingency, in order, only when triggered by E3:

1. A gated metric within 0.01 of its limit: confirmation rerun `round-p3-01b` (D26).
2. `R_ess` under floor: read loss stage. Essential misses with `inExtracted` true grew (finalize lost
   them): `round-p3-02` override narrows the merge sentence to "fields of one type and values of one
   setting" only. Else noise: count E3 as a regression only after step 1.
3. `C_fact` above 0.468 with `R_ess` at least 0.02 over floor: `round-p3-02` override strengthens the
   merge ("merge every pair of facts with the same subject and aspect; prefer fewer, denser facts").
4. Unsupported + distorted over 0.02: `round-p3-02` override adds "never change a number, negation or
   condition when merging" to finalize step 1.

A kept override lands verbatim in `registry.go` in that round's commit. When no Part 3 prompt variant
meets the gates, revert the prompt changes that fail (merge sentence, gate list clause) one at a time,
list them in the report as reverted with their metric, and report the format-only and code-locator gains
(E1, E3) as Part 3's result. The ledger stopping a run ends the loop; the report says so.

E5 runs on the committed tree after E3/E4 decide; all-15 numbers combine the kept tuning round with E5.

## 6. Commits (one sequential implementer, resumable from disk)

Fast checks per commit: `bun run lint:go`, `go vet` of touched packages, `bun run lint:claude` when the
nested module changed, `go run ./internal/llmprompts/cmd/checkprompts` and `go test ./internal/llmprompts/...`
when `registry.go` changed, `go test` of touched packages.

1. C1 `refactor(memory): pure doc renderer for write-back`. `importer.RenderDoc(DocInput, []memory.Memory)
   (text string, left, bad int, err error)`; `writeDocFile` calls it; behavior unchanged.
2. C2 `test(memory): eval footprint mode and rendered C_doc` (D22, D23): harness `footprint` mode,
   `KIRA_EVAL_ROUNDS`, run-mode `C_doc` via `RenderDoc`, `docMismatch`, render re-parse, locator share
   stage count.
3. C3 `test(memory): P285 part 3 footprint baseline` (E0): `footprint-p273.json` in each listed round;
   report "Part 3" section with the E0 table, `C_doc` band and the D25 limits filled in.
4. C4a `feat(memory)!: compact memfmt v2` (D1 to D10): `memfmt` parse, format, regexes, `Locator`/
   `ParseLocator`, `Doc.From`/`Version`, `Fact` without `Keywords`; `memfmt_test.go` (below); `memcheck`
   D20 plus `check_test.go`. Footer `BREAKING CHANGE: kira-memory: 1 docs and '<id> fact:' comment
   lines are retired; see docs/v2.5/plans/P285-part3-compact-memory-output.md`.
5. C4b `feat(memory): write-back and doc apply in format v2` (D18, D19): `RenderDoc`, `writeDocFile` v1
   overwrite rule, `ApplyDoc`/`applyDocFact`/`sameDocFact`, `finalizeDoc` passes `Path`;
   `service_test.go` `TestApplyDocDecisions`; memoryflow `ingest_test.go`, fixture `billing.memory.md`.
6. C4c `feat(memory): MCP results in the compact layout` (D11): `writeMemory`; `server_test.go`,
   memoryflow `format_test.go` `TestMcpSearchTextFormat`/`TestMcpPrepareComment`; real `claude`
   `memory_test.go` meta-line check (`  v<N> origin=` line with ` score=`).
7. C5 `test(memory): P285 part 3 footprint in format v2` (E1): `footprint-v2.json` per listed round,
   report table P273 vs v2.
8. C6a `feat(memory): source locator by code` (D13, D14): `FinalFact.Reason`, `loadExtracted`
   section and reason from `heading_path`, `StoreRequest.ImportPath`, `requestFor`, `decide` pin;
   `engine_test.go` fake agent, memoryflow fixtures.
9. C6b `feat(memory): merge related facts, locator and rationale rules in prompts` (§4, D21): finalize,
   gate, MCP instructions and `store_memory` texts; `FinalizeVars`; `en.json` only if wrong.
10. C7 `test(memory): P285 part 3 smoke` (E2). C8 `test(memory): P285 part 3 round 01` (E3) with report
    row. C9.. one commit per contingency round (`feat(memory): ... (P285 part 3 round N)` when kept,
    `test(memory): P285 part 3 round N rejected: ...` when not). C10 `test(memory): P285 part 3 hold-out`.

Resume: a round dir with `facts.jsonl` lines skips those sources; a round with `scores.json` is done; a
round with `footprint-<fmt>.json` is done for that format; the report log names the last finished step.

## 7. Tests

- `memfmt_test.go` (parser with interacting rules, CLAUDE.md test bar met): round trip comment for every
  marker kind (line, `<!-- -->`, `/* */`, xml no-dash) with and without reasons; doc round trip with
  sections, reason-less facts, `from`, front matter keywords; `CommentLine`/`DocLine` vs parser
  (`TestRegexMatchesParser` rewritten for v2); rule table (indented line not after a fact ends the block
  unflagged; reason with markup; duplicate id; fact without header; marker or indent differs; retired v1
  comment line; `kira-memory: 1` doc yields one retired problem and its group; doc reason not after a
  fact; formatter refuses `fact: `-prefixed text); `Locator`/`ParseLocator` inverse incl. section with
  `, ` and markup stripped, and a path that is a prefix of another.
- `memcheck` `check_test.go`: drift on fact text; reason compared only when both state one.
- `service_test.go` `TestApplyDocDecisions`: reason-less fact rebuilds the locator (with and without
  `from`); write-then-apply noop; update keeps stored keywords.
- Go flow tests (backend half): memoryflow `TestImportProvenanceWritesDoc` (written doc is v2: `from`,
  section headings, no reason lines for locator reasons, re-parses clean; stored reasons equal
  `Locator(rel, heading path)` even when the fake gate rewrites them, D14); `TestImportFormattedDocParsesOnly`
  (v2 fixture; re-ingest of a written doc is all noop); a v1 memdoc fails the file with the retired
  message; `TestMcpPrepareComment` (v2 comment parses clean); `TestMcpSearchTextFormat` (D11 layout);
  `TestCommentCheckHook` (v2 lines pass, v1 lines flagged). No UI spec: no UI surface changes (the
  import view only shows the doc path); state this in the close-out.
- Real `claude` (opt-in, after C6b and again in test-and-fix): registry row of DEV_ENVIRONMENT, which
  includes `TestMemoryGate`, `TestMemoryImport`, `TestMemoryIngest*`, `TestMemoryMcpThroughClaude`
  (asComment parses clean, meta line), `TestMemoryMcpFollowsDocs` (instructions changed),
  `TestMemoryInstallRegisters`, `TestMemoryDistill`, plus ADE and smart rows, and `bun run test:claude:studio`.
  Log their spend in the report.

## 8. Serial test-and-fix (after §6)

`bun run lint`, `bun run lint:go`, `bun run lint:claude`, `bun run typecheck`, `go test ./... -count=1`,
`bun run test:flows:space`, `bun run test:unit`, `checkprompts`, `go test ./internal/llmprompts/...`,
`bun run test:ui:space` when `en.json` changed, site check and `check-docs`, real `claude` rows (§7).
Fix at cause, pre-existing failures included (CLAUDE.md), one commit per group.

## 9. Close-out (docs)

- `docs/ARCHITECTURE.md`: "Text formats" bullets rewritten for v2 (comment, doc, `from`, optional reason,
  locator, no per-fact keywords, retired v1 messages, regexes); MCP text output layout; `asComment`
  sample; import: section and locator by code (`loadExtracted`), `ImportPath` pin, no evidence in
  reasons, finalize merge rule, gate list rule; write-back (sections, `from`, reason-less facts, v1
  overwrite); `ApplyDoc` (locator rebuild, keywords kept); eval section: `footprint` mode,
  `KIRA_EVAL_ROUNDS`, fixed `C_doc` definition, Part 3 results. "Known open items": a written doc holds
  no per-fact keywords, so importing it into another store indexes its facts with doc-level keywords only.
- `docs/DEV_ENVIRONMENT.md`: eval row (Part 3 spend, `spend-p3.jsonl`, free `footprint` mode); env table
  gains `KIRA_EVAL_ROUNDS`.
- Site: `reference/memory-formats.md` rewritten from §3 (sources list gains this plan);
  `space/memory.mdx` write-back paragraph; `reference/mcp-tools.md` `store_memory` text (D21) and result
  layout if described.
- `P285-report.md` Part 3: format (§3 sample), footprint tables (E0, E1, final), iteration log (same
  columns as Part 2 plus `C_doc`, `C_rec`, stored count, locator share), results vs D25 gates, all-15
  numbers, one before/after doc excerpt (`plan-p257` P273 vs v2), spend (ledger plus real rows), what
  was reverted.
- Artifact `Memory Ingest Eval` (https://claude.ai/artifact/W3cx8zARKcBe8EhYfiz8vQ): read it, add a
  Part 3 section (footprint bars P273 vs v2, gates table, doc excerpt), republish to the same URL. If the
  close-out subagent lacks the Artifact tool, the orchestrator does it.
- SPEC row P285 Part 3: Done with a result qualifier; plan path corrected. Commit `docs: P285 part 3
  close-out`.

## 10. Verification (orchestrator, real checks)

1. `rg -n 'kira-memory: 1' internal/ apps/ site/` shows only the retired-message code and its tests.
2. `rg -n '" fact: |" reason: |" keywords: |" meta: ' internal/memory` empty.
3. `go test ./internal/memory/... ./apps/kira-space/internal/flows/memoryflow/...` green.
4. `rg -n 'evidence' internal/llmprompts/registry.go` hits only extract, verify and finalize input
   wording; no reason template holds `<evidence>`.
5. Each listed round has `footprint-p273.json` and `footprint-v2.json`; `round-p3-01` (and any
   contingency, hold-out) has `scores.json` with `docMismatch` 0 and render problems 0.
6. Report numbers equal `scores.json` aggregates (spot-check 3 sources); D25 gates stated met or not.
7. `spend-p3.jsonl` total plus logged real-row spend <= 20 USD.
8. Real `claude` rows run and green, spend in the report.
9. Implementer tool logs show `codegraph_explore` calls for discovery (E3 failure analysis included).
10. Artifact link opens with a Part 3 section; SPEC row and plan path updated.
