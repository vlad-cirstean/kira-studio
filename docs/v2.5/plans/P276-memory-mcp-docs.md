# P276 plan: memory MCP docs: short, clear, say what is expected

Ask (SPEC row P276): rewrite `kira-memory` server instructions, every tool and argument
description and the `remember` prompt for the final tool surface (store with origin, session,
scope, group; `asComment`; ingest by path and status; context lookup; search). State expectations
plainly: the module extracts and splits facts itself, but every submitted fact comes with its
reason, who decided it (user, agent, external with source) and scope; content files go by path,
never inline. Docs follow `CLAUDE.md` "Communication style"; no description longer than needed.
`docs/ARCHITECTURE.md` "Memory MCP server and module" updated to match. Real `claude` memory row
re-run to confirm an agent follows the new docs.

Base: `v2.0` at `af7cef3da` (P275 close-out). Discovery ran through `codegraph_explore`:
`mcpserver.Build`, `storeInput`/`searchInput`/`storeOutput`, `storeSchema`/`searchSchema`,
`requestFor`, `commentMarker`, `writeMemory`/`scoreMeta`/`semanticNote`, `addIngestTools`/
`ingestSchema`, every `memory.mcp.*` registry entry, `llmprompts.InputSchema`/`describeNested`,
`checkprompts` `main`/`phrases`, `memory.MaxItems`/`maxGroups`/`DefaultContextLimit`/
`DefaultSearchLimit`, `validateGroups`/`CheckJobGroups`, importer `finalizeTools`/`maxFactIDs`.
Targeted reads: `registry.go` 300-570, ARCHITECTURE 4634-4894, P275 plan, `golden_test.go`,
`llmpromptsflow` `TestList`, `en.json` `memoryMcp*` keys, `tests/claude/memory{,_ingest}_test.go`,
DEV_ENVIRONMENT "Real `claude` tests" table.

Out of scope (decided): tool behaviour, schemas and result shapes (docs-only phase; one constant
export below only feeds a description); tool-result texts `memory.mcp.store.challenged`,
`.store.prepared`, `.ingest.started`, `.ingest.awaiting`, `.semantic.*` (already short and correct
for the final surface; two flow/unit tests pin the `Nothing was stored.` prefix); gate, reconcile,
import system prompts (not MCP docs); ARCHITECTURE sections other than the memory one.

## 1. Today

- Texts live in `internal/llmprompts/registry.go` 391-514 (`MemoryMcpInstructions`, seven
  `MemoryTool*` entries plus `arg(...)` entries, `MemoryRememberDescription`, `MemoryRememberMessage`).
  `mcpserver.Build` reads them once per session (`Applies: NewSession`). Users can override each in
  Settings; an override keeps winning after this phase (wanted).
- Default lengths at base (chars): instructions 1636, `store_memory` 488, `search_memories` 250,
  `memory_history` 130, `memory_context` 258, `ingest_files` 401, `ingest_status` 309,
  `remember` description 85; all `memory.mcp.*` defaults 7669.
- Gaps against the ask:
  - Nothing says the store splits and rewords facts; `items.fact` says "one claim, written to stand
    alone", which pushes agents to pre-split and drop reasons. Instructions say "one item per fact".
  - Instructions never say completeness beats format, nor that a reason is never invented.
  - `ctx=N` and score parts (P275) are not explained in the instructions.
  - Hard-coded numbers that can drift: `store_memory` `groups` "up to 5" (literal, `maxGroups` 5
    unexported, `service.go:30`); `ingest_files` `groups` `MaxVars{Max: 4}` literal
    (`mcpserver/ingest.go:50`, really `maxGroups-1`, `CheckJobGroups`); `ingest_status` "up to 50"
    (`importer.maxFactIDs`).
- ARCHITECTURE memory section, stale lines: MCP server bullet (4721-4727) lists four tools, misses
  `ingest_files`/`ingest_status` and search filters; "MCP text output" (4794-4795) misses score
  parts and `ctx=N`; "Import mode" (4825) says import forces `external`/`doc`/`personal`, but since
  P274 `requestFor` takes the job's provenance and falls back to those only when the job is gone.
  No bullet says where agent-facing texts live or what contract they state.
- Tests pinning texts: `internal/llmprompts/testdata/golden/memory.mcp.remember.message.{empty,blank,given}.txt`
  (`TestGolden`). Nothing pins instructions or tool descriptions. `checkprompts` flags any 48-char
  prefix of a default copied outside the registry (tests and docs skipped).
- Real `claude` memory tests are directive ("call X with Y"), so none shows an agent following the
  docs unprompted.

## 2. Design (all decisions final)

### 2.1 Contract every text states

One shape, repeated only where the reader needs it: fact (rough text fine, the store splits and
rewords), reason (required, never invented), origin (user, agent, external plus `sourceTag`),
scope (company, project, personal). Content files go by path. Recall is loose: read and discard.

### 2.2 Registry texts (`internal/llmprompts/registry.go`), final wording

Implementer pastes these verbatim; only a test-forced change is allowed, recorded in Result.

`memory.mcp.instructions` (1410 chars):

```
Long-term memory shared by the user and their agents, across sessions and projects.

Store a durable fact or decision when the user states one or you learn one worth keeping. Call store_memory; each item needs:
- fact: what is true. Rough or compound text is fine: the store splits it into atomic facts and rewords them.
- reason: why it is true or was decided. Never invent one.
- origin: who decided it. "user" (the user stated or confirmed it), "agent" (you concluded it) or "external" with a sourceTag (a source such as slack, jira or a doc says it).
- scope: "company", "project" (this repo unless project is set) or "personal".
Never drop a reason, origin or scope to tidy a fact. Never store secrets.
Origins rank user, external, agent; an agent fact never replaces a user fact.
A challenge stores nothing: ask the user the returned questions or fix the items, then call again with the answers in clarifications.

Files (repo docs, a Slack or Jira export): call ingest_files with absolute paths, then ingest_status. Never read or paste the content; Kira reads the files. Save external material to a .md, .txt or .json file first.

Recall: search_memories matches words and meaning, best first, and returns loosely related results; drop what is unrelated. Cite a memory by its fact id (km_...). ctx=N in a result's meta means memory_context has N facts stored with it; memory_history shows its versions.
```

`memory.mcp.tool.store_memory`:

```
Store facts in long-term memory. Each item needs fact, reason, origin and scope. The store splits compound text into atomic facts, rewords them, and updates a matching fact in the same scope unless the stored one has a higher origin; old versions stay as history. An unclear item or weak reason is challenged: nothing is stored and questions come back. Returns each stored fact id. With asComment, stores nothing and returns the facts as a code comment.
```

`store_memory` arguments:

| Field | Text |
|---|---|
| `items` | `facts to store, 1 to {{.Max}}; each needs fact, reason, origin and scope` |
| `items.fact` | `what is true; rough or compound text is fine, the store splits and rewords it` |
| `items.reason` | `why it is true or was decided; never invented` |
| `items.origin` | `who decided it: user (the user stated or confirmed it), agent (you concluded it) or external (a source outside this conversation; set sourceTag)` |
| `items.sourceTag` | `source name, only for origin external: lowercase a-z, 0-9 and -, such as slack, jira, confluence, email, doc or web` |
| `items.scope` | `where it holds: company, project or personal (the user only)` |
| `items.project` | `project key for scope project, such as github.com/acme/billing; omit for this repo's project; only for scope project` |
| `clarifications` | `question and answer pairs answering an earlier challenge` |
| `session` | `Claude Code session id; omit for this session` |
| `groups` | `up to {{.Max}} groups every item joins, besides its session and request; memory_context reads a group's facts` |
| `groups.kind` | `task, document or thread` |
| `groups.key` | `stable id: a task id such as PROJ-123, an absolute document path or a thread URL` |
| `groups.title` | `optional label for people` |
| `asComment` | `path or extension of the target file, such as internal/billing/api.go or py; stores nothing and returns a code comment; no groups` |

`groups` becomes `MaxVars`: `storeSchema` passes `"groups": llmprompts.MaxVars{Max: memory.MaxGroups}`;
the entry example is `MaxVars{Max: 5}`.

`memory.mcp.tool.search_memories`:

```
Search memories by words and meaning, best first. Recall-biased: drop unrelated results. Meta lines show provenance, score parts (score is relevance times boosts) and ctx=N for memory_context. Superseded versions only with includeHistory.
```

Draft lengths (chars, base in brackets): `store_memory` 453 (488), `search_memories` 238 (250),
`memory_history` 84 (130), `memory_context` 182 (258), `ingest_files` 362 (401), `ingest_status`
266 (309), `remember` description 63 (85).

Arguments: `query` `free text, matched by words, prefixes, word forms and meaning`; `includeHistory`
unchanged; `limit` unchanged; `scopes` `only these scopes: company, project, personal`
(unchanged); `origins` unchanged; `project` `project key whose facts rank first; omit for this
repo's project, "" for none`.

`memory.mcp.tool.memory_history`:

```
Every version of one memory, oldest first, with the event that explains each change.
```

Argument `id`: `fact id, or the id of any version` (same text for `memory_context` `id`).

`memory.mcp.tool.memory_context`:

```
The facts stored with one fact, per group (session, request, task, document, thread), newest first. Call it after search_memories when a result shows ctx=N or needs its surroundings.
```

Argument `limit` unchanged.

`memory.mcp.tool.ingest_files`:

```
Store the facts of files and folders by path, in the background. Send absolute paths, never content: Kira reads the files. Reads Markdown, text, JSON and JSON Lines; a file in kira-memory doc format is applied as is. Every fact gets the origin, scope and groups given. Returns a job id for ingest_status. A large job waits for the user to start it in Kira Space.
```

`ingest_files` arguments: `paths` unchanged; `origin` `who decided the content: user, agent or
external (an outside source such as a Slack export; set sourceTag)`; `sourceTag` same text as
`store_memory`'s; `scope` `where the facts hold: company, project or personal (the user only)`;
`project` `project key for scope project, such as github.com/acme/billing; omit for the first
path's project; only for scope project`; `groups` `up to {{.Max}} groups every fact joins,
besides each file's document group; memory_context reads a group's facts`; `groups.kind`,
`groups.key` unchanged; `groups.title` `optional label for people`; `writeDoc` `also write each
file's facts beside it as <name>.memory.md in kira-memory doc format; default false`; `session`
`Claude Code session id; omit for this session`. `ingestSchema` passes
`"groups": llmprompts.MaxVars{Max: memory.MaxGroups - 1}`.

`memory.mcp.tool.ingest_status`:

```
State of an ingest job: progress, totals, cost, and per file its state, document group and counts of stored, updated, unchanged, dropped and unresolved facts. The structured result lists stored fact ids per file; pass one to memory_context to read that file's facts.
```

`memory.mcp.remember.description`: `Store durable facts from given text or the recent conversation.`
Argument `text`: `what to remember; omit for the recent conversation`.

`memory.mcp.remember.message`:

```
Store the durable facts from {{if .Text}}the text below{{else}}the recent conversation{{end}} with store_memory. Give every item its reason, origin (user: the user stated it; agent: you concluded it; external with a sourceTag: a source such as slack or jira states it) and scope (company, project or personal). Rough wording is fine: the store splits and rewords facts. If store_memory returns questions, ask the user, then call it again with the answers as clarifications. Report what was stored.{{if .Text}}

{{.Text}}{{end}}
```

### 2.3 Go change (description feed only)

`internal/memory/service.go`: add `MaxGroups = maxGroups` beside `MaxItems`, comment "the MCP tool
descriptions state it". Used by `storeSchema` and `ingestSchema` (2.2). No behaviour change.

### 2.4 Settings catalog

`packages/theme/src/i18n/en.json` `llmPrompts.entry.memoryMcpInstructions.description`:
`Tells an agent what each stored fact needs, how to send files by path and how to search.` Other
memory catalog keys stay (still accurate).

### 2.5 `docs/ARCHITECTURE.md` "Memory MCP server and module"

Edits, each in `CLAUDE.md` style, no other bullet touched:

- MCP server bullet (4721-4727): tools `store_memory` (progress `checking`, `reconciling`,
  `saving`; `asComment`), `search_memories` (`includeHistory`, `scopes`, `origins`, `project`,
  `limit`), `memory_history`, `memory_context`, plus `ingest_files` and `ingest_status` when
  `Options.Ingest` is set (never in import mode); prompt `remember`. Keep registration and spawn facts.
- New bullet after it, "Agent docs (P276)": texts live in `internal/llmprompts/registry.go`
  (`memory.mcp.*`), read once per session. Contract: the store splits and rewords; the agent sends
  each fact with reason, origin and scope, never inventing a reason; files go by path. Numbers in
  descriptions come from Go constants (`memory.MaxItems`, `MaxGroups`, search and context limits,
  `maxIngestPaths`), never literals.
- "MCP text output" bullet: meta is `vN origin=... [source=...] scope=... [project=...] [match=...]
  [score parts] [historical] [ctx=N]`; point to Ranking "Output" for the parts; neutral parts omitted.
- "Import mode" bullet: provenance, groups and session come from the import job; a job no longer
  found falls back to `external`/`doc`/`personal`. Keep `source_ref`, CHECK and history facts.
- Merge "Memory UI adds `settings/SemanticModelSection.vue` ..." into the Settings bullet above it
  (one concern, two bullets today).

### 2.6 Real `claude` check that an agent follows the docs

New file `apps/kira-space/tests/claude/memory_docs_test.go`, `TestMemoryMcpFollowsDocs`, same
harness as `TestMemoryIngestThroughClaude` (re-executed binary as `memory-mcp`, env with
`KIRA_MEMORY_HOME`, `KIRA_SPACE_HOME`, `HOME`, `PATH`; cwd a git repo with origin
`github.com/acme/billing`). Prompts name the goal only, never a tool argument:

1. Store: `Remember for the team: we deploy billing-api with Helm, because ops standardised on Helm
   charts in 2025. Use the kira-memory server.` Allowed tools: all six `mcp__kira-memory__*`.
   Assert the first `store_memory` input: at least one item, every item has non-empty `reason`,
   `origin` `user`, `scope` in the closed set. No assertion on the gate verdict (real Sonnet).
2. Files: write `docs/deploy.md` (one short paragraph, one chunk) in the repo. Prompt: `Add the
   docs in <abs docs dir> to long-term memory.` Allowed tools: the six memory tools plus `Read`,
   `Glob`, `Grep`. Assert an `ingest_files` call whose `paths` hold the docs dir or the file, and
   no `Read`/`Grep` tool use on any path under the docs dir. Then cancel the job through the app's
   import control (find the cancel entry with `codegraph_explore` on `MemoryImportService`), so
   no extract spend.

Why a new test: the existing rows are directive and cannot show an agent following docs; the
SPEC asks for that confirmation. Unit-test bar does not apply (opt-in real `claude` suite).

DEV_ENVIRONMENT "Real `claude` tests" table: add `TestMemoryMcpFollowsDocs` to the "Memory MCP and
install" row regex and to the "Prompt registry" row regex. Spend measured and appended to the
spend line.

## 3. Execution

One sequential Sonnet implementer, main checkout. Why: SPEC Process says so; one small chain
(texts, then test, then docs). Typecheck and lint per commit.

### 3.1 Implementer order and commits

1. `registry.go` (2.2), `service.go` `MaxGroups`, `mcpserver/server.go` `storeSchema` vars,
   `mcpserver/ingest.go` `ingestSchema` vars, golden files regenerated to the new remember message
   (three files, render through `TestGolden` expectations, check by eye), `en.json` (2.4). Run
   `go test ./internal/llmprompts/... ./internal/memory/... -count=1`,
   `go run ./internal/llmprompts/cmd/checkprompts`. Commit
   `feat(memory-mcp): state what agents must send in instructions and tool docs`.
2. `tests/claude/memory_docs_test.go` (2.6), DEV_ENVIRONMENT rows. Commit
   `test(memory-mcp): real claude follows memory docs unprompted`.
3. ARCHITECTURE (2.5). Commit `docs: memory MCP section matches final tool surface`.

### 3.2 Test and fix (same implementer, after 3.1)

`bun run lint`, `bun run lint:go`, `bun run typecheck`, `go test ./... -count=1`,
`bun run test:flows:space` (llmprompts and memory flows read these entries). No UI change, so no
UI suite. Then the real `claude` rows (section 6). A doc text an agent misreads in 2.6 gets
reworded at cause and the row re-run; record each rewording in Result. Fix at cause; commit per
group.

### 3.3 Close-out (same implementer)

Result section here (lengths before/after, spend, rewordings). SPEC P276 Done. Commit
`docs: P276 close-out`.

## 4. File ownership (single implementer)

No streams. Why: three small, ordered steps; the test depends on the texts.

| Area | Files |
|---|---|
| Prompts | `internal/llmprompts/registry.go`, `internal/llmprompts/testdata/golden/memory.mcp.remember.message.{empty,blank,given}.txt` |
| Memory | `internal/memory/service.go`, `internal/memory/mcpserver/{server,ingest}.go` |
| Catalog | `packages/theme/src/i18n/en.json` |
| Tests | `apps/kira-space/tests/claude/memory_docs_test.go` |
| Docs | `docs/ARCHITECTURE.md`, `docs/DEV_ENVIRONMENT.md`, `docs/v2.5/SPEC.md`, this plan |

A needed file outside this table: edit it and name it in the commit body.

## 5. Tests

Docs-text phase, no behaviour change: no flow plus UI pair, no new unit test. Existing tests:
`TestGolden` golden files move to the new remember message; `llmpromptsflow` `TestList` count
stays 96 (no entry added or removed; recount to confirm). No other test pins these texts.

## 6. Real `claude` rows (opt-in, after 3.2)

Prompt registry row from DEV_ENVIRONMENT, with the new test:
`bun run test:claude:space -run 'TestMemoryGate|TestMemoryMcpThroughClaude|TestMemoryMcpFollowsDocs|TestMemoryInstallRegisters|TestMemoryImport|TestMemoryIngest|TestAdeHeadlessRun|TestAdeStepResults|TestAdeStageSession|TestAdeRebaseRun|TestSmartScriptRun'`
and `bun run test:claude:studio`. Report spend per run.

## 7. Verification (orchestrator, real checks)

1. Lengths: a scratch test over `llmprompts.All()` (not committed) sums `memory.mcp.*` defaults:
   total below 7669; instructions at most 1636; each tool description at most its base length (1).
2. `rg -n 'one item per fact|written to stand alone|up to 5 groups|up to 50' internal/llmprompts/registry.go` → none.
3. `rg -n 'splits' internal/llmprompts/registry.go` hits instructions, `store_memory`, `items.fact`
   and the remember message; `rg -n 'never invent|Never invent' internal/llmprompts/registry.go`
   hits instructions and `items.reason`; `rg -n 'absolute paths' internal/llmprompts/registry.go`
   hits instructions and `ingest_files`.
4. `rg -n 'MaxGroups' internal/memory` shows the constant and both schema callers;
   `rg -n 'MaxVars\{Max: 4\}' internal/memory/mcpserver` → none.
5. `go run ./internal/llmprompts/cmd/checkprompts` passes; `go test ./internal/llmprompts -run TestGolden` passes.
6. `rg -n 'ingest_files' docs/ARCHITECTURE.md` hits the MCP server bullet; `rg -n 'ctx=N' docs/ARCHITECTURE.md`
   hits the MCP text output bullet; the import-mode bullet no longer says it "forces" `external`.
7. `rg -n 'TestMemoryMcpFollowsDocs' docs/DEV_ENVIRONMENT.md apps/kira-space/tests/claude` hits
   both rows and the test; real `claude` rows ran and passed, spend reported.
8. Suites in 3.2 green.
9. Implementer's tool log shows `codegraph_explore` where it discovered code beyond this plan
   (expected: the import cancel entry in 2.6).

## 8. Decisions log (final)

- Final texts written in this plan: wording is the deliverable; the implementer only applies it.
- Instructions keep sections store, files, recall: matches the order an agent meets the tools.
- Say the store splits and rewords: agents stop pre-splitting and dropping reasons.
- "Never invent a reason": a made-up reason passes the gate yet poisons the data.
- `asComment` described only on its tool: rare use, saves instruction tokens.
- One instructions text for normal and import mode: finalize has its own system prompt and a
  three-tool allowlist, so a mention of ingest tools is harmless there.
- Numbers from Go constants (`MaxGroups` exported, ingest groups `MaxGroups - 1`), "up to 50" dropped:
  no description can drift from the code.
- No fact and reason length limits in descriptions: rare, and the `ErrInvalid` message states them.
- Tool-result texts unchanged: already short, correct and test-pinned.
- Settings catalog: only the instructions purpose line changes; it alone went stale.
- ARCHITECTURE: fix stale lines, add the contract bullet, merge one duplicate; ranking and
  embedding bullets stay (P275 wrote them against the current tree).
- New real `claude` test with goal-only prompts: only way to show an agent follows the docs.
- File case cancels its ingest job: proves path-not-content without extract spend.
- No flow or UI test: no behaviour change.
- One sequential implementer: small ordered chain, SPEC Process.

## 9. Result

Pending.
