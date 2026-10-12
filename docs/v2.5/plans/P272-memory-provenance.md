# P272 plan: memory data model: nanoid ids, origin, session, scope, groups

Ask (SPEC row P272, user requirements): facts get nanoid ids, collision-free, short, greppable,
stable across versions of one fact. Each fact records who decided it (origin `user`, `agent`,
`external` plus source tag), the Claude Code session that added it, and its scope (`company`,
`project` with the project named, `personal`). Facts belong to groups (session, task, document,
thread, ...). New MCP read tool returns a fact's immediate context (sibling facts of its groups) as a
second step. Gate, reconcile, search output, history, Memory module UI and `@shared/domain/memory`
carry the fields; immutability triggers cover them. Existing rows migrate. Prompt edits go through
`internal/llmprompts`.

Base: `v2.0` at `8c722c17a` (P271 close-out). Discovery ran through `codegraph_explore` (memory
store, schema and commit path, service and gate/reconcile, mcpserver, memorycli, importer db, Space
bridge, workbench memory UI and queries, repo identity) plus targeted reads of migrations, sqlitex
`Migrate`, `memorycli/run.go`, `bridge/memory.go`, memory Vue files, `llmprompts/schema.go` and
registry memory entries.

Out of scope (later rows, decided): comment and doc text formats, a non-persisting store flag (P273);
ingest by path, external no-challenge rule, JSON chunker (P274); ranking, scope/project boost, search
filters (P275); full rewrite of MCP instructions and descriptions (P276). P272 edits prompt texts
only as far as the new fields need.

## 1. Today (line numbers at base)

- `internal/memory/migrations/0001_memories.sql`: `memories` (`seq` PK, `id` UNIQUE uuid,
  `lineage_id`, `version`, `fact`, `reason`, `keywords`, `author` user|agent, `status`,
  `supersedes_id`/`superseded_by_id` FK `memories(id)`, `fact_hash`, timestamps); triggers
  `memories_immutable` (values), `memories_stay_superseded`, `memories_no_delete`; FTS5
  `memories_fts` external content on `seq`; `memory_revision` bumped on insert. `0002`:
  `memory_embeddings.seq` FK `memories(seq)`. `0003`: `memory_events` rebuilt with `source`
  mcp|ui|import, `source_ref`, `author`, FKs `memory_id`/`previous_id` to `memories(id)`; import
  tables.
- `sqlitex.Migrate` (`internal/sqlitex/sqlitex.go:145`): SQL-only steps, one transaction each, DSN
  `_foreign_keys=1`.
- `Store.commitFact` (`store.go:299`): `uuid.NewString()` per version; v1 id = lineage id;
  event row per decision.
- `Service.Store` (`service.go:168`): validate (`validateRequest` :122, request-level `Author`,
  `Source`, `SourceRef`), gate (`gate.go:49`), `prepare` hash short-circuit and candidates
  (`reconcile.go:63,91`), one reconcile call (:126), commit per work with stale retry (:239).
- MCP (`mcpserver/server.go`): `store_memory` input `items[{fact,reason}]`, `author`,
  `clarifications`; import mode (`Options.ImportRef`, `--import-ref`) forces author agent, source
  import. `search_memories`, `memory_history`, prompt `remember`. Text output `renderMemories` shows
  version id, author.
- Space bridge `MemoryService` (`apps/kira-space/internal/bridge/memory.go`): `Search`, `Recent`,
  `History`, `Store` (author user, source ui). Frontend `memoryControl.ts`, `MemoryControl`
  (`packages/workbench/src/memory/module.ts`), `queries.ts`, `MemoryPanel.vue`, `MemoryStart.vue`
  (detail and version trail), `AddMemoryDialog.vue` (fixed `MANUAL_REASON`), `labels.ts`
  (`AUTHOR_LABEL`, `eventText`).
- `llmprompts.InputSchema` (`internal/llmprompts/schema.go:13`) describes top-level properties only.
- No git-remote normaliser under `internal/`; `apps/kira-space/internal/ghclient.ParseRemote` is
  app-internal and rejects nested paths.
- Behaviour check, "not persisted via an MCP flag": today `store_memory` persists every accepted
  fact; a challenge stores nothing; no flag exists. The user's flag is P273 (3): an opt-in
  comment-preparation mode. P272 keeps persist-by-default and adds no flag.

## 2. Design (all decisions final)

### 2.1 Ids

- **Fact id = lineage id**, nanoid: `km_` + 12 chars of Crockford base32 lowercase
  `0123456789abcdefghjkmnpqrstvwxyz`. Example `km_7h3kq9x2mfa4`. Regex `\bkm_[0-9a-hjkmnp-tv-z]{12}\b`.
- **Version id** = `<fact id>.<version>`, e.g. `km_7h3kq9x2mfa4.2`. Grepping a fact id finds every
  version.
- Generator `internal/memory/ids.go` `newFactID()` via `github.com/matoous/go-nanoid/v2`
  `gonanoid.Generate(alphabet, 12)` (MIT, pure Go). Insert retries once on a UNIQUE collision.
- **Agents cite the fact id.** Text outputs show the fact id and version number, never the version id.
- **Lookups accept** fact id (resolves to the current version), version id, or a legacy uuid.
- **Old uuids stay resolvable** through `memory_legacy_ids(legacy_id PK, memory_id FK)`.
- **Idempotency:** same fact plus reason in the same scope and project returns the existing id
  (hash short-circuit, noop). Caller-supplied ids wait for P273/P274.

### 2.2 Origin

- Per item, required, no default: `user`, `agent`, `external`. `external` requires `sourceTag`;
  `user` and `agent` forbid it.
- `sourceTag`: open set, lowercase `[a-z0-9-]`, 1 to 32 chars, trimmed and lowercased on input.
  Descriptions suggest `slack`, `jira`, `confluence`, `email`, `doc`, `web`.
- Grade, stored as origin and shown in the UI: user = human-challenged, correct; external =
  correct, probably incomplete; agent = reference only. Order user > external > agent.
- **Grade guard:** reconcile may not `update` a candidate whose grade is higher than the new
  fact's. Go turns such an update into `add`, with why "Kept beside a higher-graded fact." Prompt
  states the same rule.
- A version's origin is the origin of the item that wrote it. An update by the same or higher grade
  carries the new item's origin.
- Events: `author` becomes `origin` (per fact, same set) plus `source_tag`; `source` (channel
  mcp|ui|import) unchanged.

### 2.3 Session

- `memories.session_id` (TEXT NULL): the Claude Code session that wrote the version.
- Capture order in the `memory-mcp` subprocess: `session` tool argument, else env
  `CLAUDE_CODE_SESSION_ID` read at start, else NULL. Validation: 1 to 128 chars of
  `[A-Za-z0-9._:-]`.
- UI-added and import rows: NULL; the channel (`ui`, `import`) already says where they came from.
- Pre-existing rows: NULL.
- Step 0 of execution probes whether a stdio MCP server spawned by real `claude` sees
  `CLAUDE_CODE_SESSION_ID` (§4). If not, the env path stays (harmless), the `session` argument
  remains the capture, and close-out adds a `docs/ARCHITECTURE.md` Known open item.

### 2.4 Scope and project

- Per item, required, no default: `company`, `project`, `personal`.
- `project` key: normalised `origin` remote, `host/path` lowercased, no scheme, user, password,
  port or `.git`, e.g. `github.com/kirathecat/kira-studio`. Nested GitLab paths kept.
  No `origin` remote: `local:` + absolute path of the main worktree (parent of
  `git rev-parse --path-format=absolute --git-common-dir`).
- `internal/memory/project.go`: `NormalizeRemote(url) (string, bool)` and
  `DetectProject(ctx, dir) (string, error)` (runs `git` with a 5 s timeout). Credentials never
  reach the key.
- Server side: scope `project` with no `project` argument takes `DetectProject(cwd)` of the
  `memory-mcp` process, detected once at start. Neither present: item invalid with a clear message.
- `project` set with scope other than `project`: invalid.
- Project key bounds: 1 to 300 chars, no whitespace.
- Backfill: every pre-existing row `personal`.

### 2.5 Groups

- `memory_groups(id PK 'kg_'+nanoid, kind, key, title, created_at, UNIQUE(kind, key))`.
- `memory_group_members(group_id FK, lineage_id, added_at, PK(group_id, lineage_id))`.
  Membership is per fact (lineage), so it survives new versions.
- Kinds (closed): `session` (key session id, auto), `request` (key request id, auto, every store
  call), `task` (agent-given, e.g. `PROJ-123`), `document` (key absolute path, auto in import mode),
  `thread` (agent-given, e.g. a Slack thread URL).
- `store_memory` `groups` argument: up to 5 of `{kind: task|document|thread, key 1..300, title
  0..200}`. Every add, update and noop of the call joins every group (INSERT OR IGNORE).
- Append-only: triggers forbid UPDATE and DELETE on both tables.
- Backfill: one `request` group per distinct `memory_events.request_id` of add/update events; one
  `document` group per import file behind import events (key `import_files.path`, title
  `rel_path`; key `source_ref` when the file row is gone).

### 2.6 Context read

- `Service.Context(ctx, id, limit)`: resolve id, then for each group of the fact (newest first):
  group `{id, kind, key, title, total}` plus up to `limit` current sibling facts, newest first,
  self excluded. `limit` default 20, max 100.
- Wire `memory.Context{Memory Memory; Groups []GroupContext}`; `GroupContext{ID, Kind, Key, Title,
  Total int, Facts []Memory}`.
- MCP tool `memory_context` (args `id`, `limit`), read-only.

### 2.7 Schema migration `0004_provenance.sql`

One SQL step (sqlitex runs SQL only, one transaction, FKs on). Outline:

1. `PRAGMA defer_foreign_keys = ON;` (valid inside a transaction; FK checks move to commit).
2. `CREATE TEMP TABLE id_map(old_id PK, new_id, old_lineage, new_lineage)`. One new lineage per
   distinct `lineage_id`: `'km_' ||` 12 × `substr(alphabet, (random() & 31) + 1, 1)`.
   `new_id = new_lineage || '.' || version`. `random() & 31` is uniform over 32 and avoids
   `abs()` overflow. A collision aborts the step via UNIQUE; the next open retries.
3. `memories_v4`: old columns, `author` dropped, plus `origin` CHECK in set, `source_tag`
   CHECK shape plus `(origin = 'external') = (source_tag IS NOT NULL)`, `scope` CHECK in set,
   `project` CHECK `(scope = 'project') = (project IS NOT NULL)`, `session_id`. Copy with mapped
   ids, `supersedes_id`, `superseded_by_id`. `origin`: `external` with tag `doc` when the
   version's creating event has source `import`; else old `author`. `scope = 'personal'`. Keep
   `seq` values (FTS and embeddings key on `seq`).
4. `memory_events_v4`: `author` becomes `origin` (+ `source_tag`, `session_id`), ids mapped; the
   `import` source_ref CHECK kept.
5. Drop old tables, rename, recreate indexes, plus `memories_lineage_current`.
6. Recreate triggers: `memories_immutable` over every value column including `origin`,
   `source_tag`, `scope`, `project`, `session_id`; stay-superseded; no-delete; FTS insert; revision
   bump. FTS content table name is unchanged, so the index stays valid.
7. `memory_legacy_ids` from `id_map`; groups and members backfill (§2.5).
8. Indexes: `memories(scope, project) WHERE status = 'current'`, `memory_group_members(lineage_id)`.

`memory_embeddings` keeps its rows (keys on `seq`). The FTS index needs no rebuild.

### 2.8 Go API (`internal/memory`)

- `model.go`: constants `OriginUser|Agent|External`, `ScopeCompany|Project|Personal`,
  `GroupSession|Request|Task|Document|Thread`, `GradeOf(origin) int`. `Memory` loses `Author`,
  gains `Origin`, `SourceTag *string`, `Scope`, `Project *string`, `SessionID *string`. `Event`
  loses `Author`, gains `Origin`, `SourceTag *string`, `SessionID *string`. New `Group`,
  `GroupContext`, `Context`.
- `Item{Fact, Reason, Origin, SourceTag, Scope, Project}`; reason now required 1 to
  `MaxReasonLen`. Why: every fact needs its reason; the gate still judges quality.
- `StoreRequest{Items, Clarifications, Session, Groups []GroupRef, Source, SourceRef, Progress}`;
  `Author` removed.
- `validateRequest` adds per-item origin, tag, scope and project rules, session shape, group bounds.
- `work` carries the item's provenance; gate facts inherit their item's provenance in Go.
- `prepare`: hash short-circuit within same scope and project. `candidates`: FTS and vector
  candidates filtered to same scope and project (`SearchArgs.within`, unexported, not on MCP).
  Why: an update supersedes; a personal note must never replace a company rule.
- `checkDecision`: grade guard (§2.2).
- `Store` methods: `commitFact` writes new columns, version ids, memberships; `resolve(id)`;
  `Lineage` and `Context` resolve fact, version or legacy ids; `Projects(ctx)` distinct project keys
  of current facts; `ImportDocument(ctx, ref)` path and rel path for import mode.
- `Service.Context`, `Service.Projects`.

### 2.9 MCP surface (`mcpserver`, `memorycli`)

- `store_memory` input: `items[{fact, reason, origin, sourceTag?, scope, project?}]`,
  `clarifications?`, `session?`, `groups?`. `author` removed.
- Session and project defaults come from `Options.SessionID` and `Options.Project`, filled by
  `memorycli.Run` from env and `DetectProject(os.Getwd())`.
- Import mode: the server sets every item to origin `external`, tag `doc`, scope `personal`,
  session none, plus the `document` group from `ImportDocument(ref)`.
- `memory_context` tool (§2.6). `memory_history` `id` accepts fact, version or legacy id.
- Text output: one line per fact,
  `- km_7h3kq9x2mfa4 v2 user project:github.com/acme/billing: <fact>` then `  reason: ...`;
  `external:slack` for external; flags `[historical]`, `[semantic]` kept. Store outcomes print fact
  ids. Context output: group header line `group <kind> <key>` (title when set), then fact lines.
  P273 replaces these formats.
- `llmprompts.InputSchema` gains nested argument entries `items.<field>`, `groups.<field>`: when a
  parent property has any nested entry, every property of its item object needs one (same panic
  rule). Enums for `origin`, `scope`, `groups.kind` set in `mcpserver` on the built schema.
  Required follows Go `omitempty` (origin, scope required).

### 2.10 Prompt edits (`internal/llmprompts/registry.go` only)

- `memory.mcp.instructions`: replace the author sentence. Each item names origin (user decided,
  agent concluded, external with source tag) and scope (company, project, personal). Add
  `memory_context`: use it with a fact id to read facts stored with it. Cite facts by fact id.
- `memory.mcp.tool.store_memory`: args `author` removed; `session`, `groups`, `items.fact`,
  `items.reason`, `items.origin`, `items.sourceTag`, `items.scope`, `items.project`,
  `groups.kind`, `groups.key`, `groups.title` added.
- New `memory.mcp.tool.memory_context` (+ args `id`, `limit` with `LimitVars`).
- `memory.mcp.tool.memory_history` arg `id`: fact id or version id.
- `memory.gate.system`: input items carry origin, sourceTag and scope; split facts keep them, so the
  output schema is unchanged.
- `memory.reconcile.system`: candidates carry `origin`; rule "never update a candidate with a
  higher grade than the new fact (user > external > agent); choose add". Input fact gains `origin`.
- `memory.import.finalize.system` step 4: `author "agent"` becomes origin `external`, sourceTag
  `doc`, scope `personal` (the server enforces it anyway).
- `memory.mcp.remember.message`: ask for origin and scope per fact.
- Texts follow `CLAUDE.md` "Communication style". Registry count rises by 13 (tool 1, its args 2,
  store_memory args net +10). Implementer recounts and updates `llmpromptsflow` `TestList`
  (Space 61 to 74 if the count holds).

### 2.11 IPC (Space `bridge.MemoryService`)

- `MemoryStoreArgs{Items []MemoryStoreItem{fact, reason}, Clarifications, Scope, Project}`.
  The server sets origin `user` on every item. Why: the UI always speaks as the user.
- New `Context(MemoryContextArgs{ID, Limit}) (memory.Context, error)`.
- New `Projects() ([]string, error)`.
- Errors through `memoryErr`; `ErrNotFound` maps to `E_NOT_FOUND`. Wails bindings regenerated per
  `docs/DEV_ENVIRONMENT.md`.
- TS: `packages/shared/domain/memory.ts` `memoryOriginSchema`, `memoryScopeSchema`,
  `memoryGroupKindSchema`, `memoryContextSchema`; `memorySchema` and `memoryEventSchema` fields
  per §2.8; `memoryAuthorSchema` deleted. `MemoryControl.memoryStore(items, clarifications, scope,
  project, signal)`, `memoryContext(id)`, `memoryProjects()`. `ipcChannels.ts` adds
  `memoryContext`, `memoryProjects`.

### 2.12 UI (`packages/workbench/src/memory/`)

- `labels.ts`: `ORIGIN_LABEL`, `SCOPE_LABEL`, `GROUP_KIND_LABEL`, `GRADE_TEXT`; `eventText` uses
  origin (external shows the tag).
- `MemoryPanel.vue` row: origin `Badge` (user `info`, agent `default`, external `warn` with tag),
  scope `Badge` (project shows the key, truncated, full key in title).
- `MemoryStart.vue` detail: fact id in `font-data` with copy (VueUse `useClipboard`, `CopyButton`
  if one exists in theme); grade line from `GRADE_TEXT`; scope and project; session id in
  `font-data`, or channel label when none. New `MemoryContext.vue` section below the reason:
  `SectionHeading` per group (kind label, key, title), sibling rows as buttons selecting that fact;
  TanStack `useMemoryContext(id)` (key `['memory','context',id]`, invalidated by the existing change
  sync). Trail events show origin and session.
- `AddMemoryDialog.vue`: scope `ToggleGroup` (Personal, Project, Company; default Personal: a
  stronger claim is an explicit choice). Project field shown for Project:
  `Popover` + `Command` combobox over `useMemoryProjects()` with free text, pattern from
  `automations/run/AdeContextFields.vue`. Submit disabled while Project has no key.
- Tailwind utilities only, shadcn-vue primitives, `<script setup lang="ts">`, catalog keys in
  `packages/theme/src/i18n/en.json` under `memory.*`.
- `data-testid`: `memory-detail-id`, `memory-detail-origin`, `memory-detail-scope`,
  `memory-detail-session`, `memory-context`, `memory-context-group` (`data-kind`),
  `memory-context-fact-<id>`, `memory-row-origin`, `memory-row-scope`, `add-memory-scope`,
  `add-memory-project`.

## 3. Execution

One sequential Sonnet implementer, main checkout. Why: one schema, one service, every layer reads
the previous one (SPEC Process). Typecheck and lint per commit; no expensive suites until §3.2.

### 3.1 Implementer order and commits

0. Probe (scratchpad, not committed): register a stdio server printing its env through
   `claude -p --strict-mcp-config --mcp-config` (haiku, `--max-budget-usd 0.05`, temp HOME per
   `docs/DEV_ENVIRONMENT.md`). Record whether `CLAUDE_CODE_SESSION_ID` arrives and equals
   `--session-id`. Append the finding to this plan's result section in the final commit.
1. `go get github.com/matoous/go-nanoid/v2@v2.1.0`; `ids.go`; `project.go` + `project_test.go`.
   Commit `feat(memory): nanoid fact ids and project keys`.
2. `0004_provenance.sql`, `migrations/embed.go`, `model.go`, `store.go`, `vectors.go` columns,
   migration test. Commit `feat(memory): provenance, scope and groups schema`.
3. `service.go`, `gate.go`, `reconcile.go`, `hybrid.go` (`within`), `llmprompts/schema.go`
   nested args, registry edits §2.10, `service_test.go`/`store_test.go` updates. Commit
   `feat(memory): store provenance through gate and reconcile`.
4. `mcpserver/server.go`, `memorycli/run.go`, `server_test.go`, importer test touch-ups. Commit
   `feat(memory-mcp): origin, scope, session, groups and memory_context`.
5. Space bridge, bindings, shared domain, `memoryControl.ts`, `module.ts`, `queries.ts`,
   `ipcChannels.ts`, `mockRuntime.ts` defaults. Commit `feat(memory): context and projects over IPC`.
6. UI and catalog keys. Commit `feat(memory-ui): provenance, scope and context`.
7. Flow tests, contracts, UI specs, existing spec and test updates, `llmpromptsflow` count, real
   `claude` test edits. Commit `test(memory): provenance flows and UI specs`.

### 3.2 Serial test-and-fix (one Sonnet, after 3.1)

`bun run lint`, `bun run lint:go`, `bun run typecheck`, `go test ./...`,
`bun run test:flows:space`, `bun run test:ui:space`, `bun run test:unit`, visual Space (memory
baselines change; update them). Then real `claude` (§5). Fix at cause; commit per group.

### 3.3 Close-out (one Sonnet)

`docs/ARCHITECTURE.md` "Memory MCP server and module": fact and version ids, origin and grade,
scope and project key, session capture, groups, `memory_context`, migration 4. Library table:
nanoid row. Known open item only if step 0 found the env missing. Result section here. SPEC P272
Done. Commit `docs: P272 close-out`.

## 4. File ownership (single implementer)

No streams. Why: the schema, service, MCP, IPC and UI form one dependency chain; no split passes the
zero-overlap and no-ordering rule.

| Area | Files |
|---|---|
| Go deps | `go.mod`, `go.sum` |
| Memory core | `internal/memory/{ids,project,model,store,service,gate,reconcile,hybrid,vectors}.go`, `internal/memory/migrations/{embed.go,0004_provenance.sql}`, `internal/memory/{project,store,service}_test.go` |
| MCP | `internal/memory/mcpserver/{server,server_test}.go`, `internal/memory/memorycli/run.go`, `internal/memory/importer/engine_test.go` (author refs) |
| Prompts | `internal/llmprompts/{registry,schema}.go`, `internal/llmprompts/testdata/golden/remember*.txt` if the remember default changes |
| Space bridge | `apps/kira-space/internal/bridge/memory.go`, Space Wails bindings (`memoryservice.ts` and models) |
| Shared TS | `packages/shared/domain/memory.ts`, `apps/kira-space/frontend/src/bridge/memoryControl.ts`, `packages/workbench/src/memory/{module,queries,labels}.ts` |
| UI | `packages/workbench/src/memory/{MemoryPanel,MemoryStart,AddMemoryDialog,MemoryContext}.vue`, `packages/theme/src/i18n/en.json` |
| Tests | `apps/kira-space/internal/flows/memoryflow/{provenance_test,store_test,import_test}.go` + testdata, `apps/kira-space/internal/flows/llmpromptsflow/llmprompts_test.go`, `apps/kira-space/tests/contract/memory.json`, `apps/kira-space/tests/ui/{memory-provenance,memory-module,list-keyboard}.spec.ts`, `apps/kira-space/tests/ui/support/{ipcChannels,mockRuntime}.ts`, `apps/kira-space/tests/claude/{memory_test,memory_gate_test,memory_import_test}.go`, Space visual baselines touching memory |

A needed file outside this table: edit it and name it in the commit body (one implementer, no
ownership conflict).

## 5. Tests

Unit (advanced logic only):

- `project_test.go` `TestNormalizeRemote`: table over https, http, ssh with user and port, scp
  form, `git://`, `.git` suffix, trailing slash, upper-case host, nested GitLab path, URL with
  user:token (stripped), file path and junk (rejected). Why: parser with interacting rules and a
  credential leak to prevent.
- `store_test.go` `TestMigration4Provenance`: migrate to 3, seed a 2-version lineage (user, ui),
  an agent lineage with an import event and file row, an embedding, then open. Assert:
  - fact and version id format, versions share the fact id;
  - supersede links remapped, `PRAGMA foreign_key_check` empty;
  - legacy uuid resolves in `Lineage`, FTS search finds the fact, embedding row joins;
  - origin `user`, `agent` and `external`/`doc`, scope `personal`;
  - request and document groups, memberships;
  - UPDATE of `origin`, `scope` and `session_id` aborts; group delete aborts.
  Why: data migration with interacting rules. Replaces nothing; `TestMigration3KeepsEvents` stays.
- Existing `service_test.go`, `store_test.go`, `server_test.go` updated for the new request shape;
  no new unit tests for validation (single-condition guards).

New-feature split at the IPC boundary (same scenario, same asserted result; contracts in
`apps/kira-space/tests/contract/memory.json`):

| Scenario | Go flow (`memoryflow/provenance_test.go`) | UI spec (`memory-provenance.spec.ts`) |
|---|---|---|
| UI store with project scope | `TestStoreScopedFromModule`: `Store` two items scope `project`, project `github.com/acme/billing` → both `origin` user, scope and project set, `sessionId` null, `lineageId` matches the id regex; contracts `args:MemoryService.Store#scoped`, `MemoryService.Recent#scoped`, `MemoryService.Projects#one` | Add dialog: pick Project, choose `github.com/acme/billing` from suggestions, submit; sent args equal the contract; rows show User and the project badge |
| Context from the module | `TestContextOfStoredFact`: `Context(first fact id)` → one `request` group holding the second fact; contract `MemoryService.Context#request` | select first row: detail shows fact id, grade line, scope; `memory-context-group[data-kind=request]` lists the second fact; clicking it selects it |
| Agent store with provenance | `TestMcpStoreProvenance`: fakeagent drives `memory-mcp` with env `CLAUDE_CODE_SESSION_ID=flow-session`, one item origin `external`, sourceTag `slack`, scope `company`, group `thread` → `Recent` shows them, `sessionId` `flow-session`; `Context` lists `session`, `request`, `thread` groups; contracts `MemoryService.Recent#mcp`, `MemoryService.Context#mcp` | row shows external Slack and Company badges; detail shows session id and three groups labelled by kind |
| Grade guard | `TestAgentCannotSupersedeUser`: user fact stored; agent store whose fake reconcile updates it → outcome `add`, user fact still current | none: backend rule, no new UI state |

Existing specs `memory-module.spec.ts` and `list-keyboard.spec.ts` and flows `store_test.go` and
`import_test.go` move to the new fields (no `author`).

## 6. Real `claude` rows (opt-in, after 3.2)

- `bun run test:claude:space -run 'TestMemoryGate|TestMemoryMcpThroughClaude|TestMemoryInstallRegisters|TestMemoryImport'`.
- `TestMemoryMcpThroughClaude` gains a store step: claude calls `store_memory` (origin `agent`,
  scope `project`, no project argument, cwd a temp git repo with an `origin` remote), then
  `memory_context` on the returned id. Assert project key detected; assert stored session equals the
  run's `--session-id` when step 0 found the env present, else assert NULL.
- `TestMemoryImport` asserts imported facts are `external`/`doc`/`personal` with a `document` group.
- Report spend per run.

## 7. Verification (orchestrator, real checks)

1. `rg -n 'uuid.NewString' internal/memory --glob '!*_test.go'` → only `requestID` and import ids,
   none in `commitFact`.
2. `rg -n 'gonanoid' internal/memory` shows a real caller in `ids.go` used by `commitFact`.
3. `rg -n 'AuthorUser|AuthorAgent|memoryAuthorSchema|AUTHOR_LABEL|"author"' internal/memory apps/kira-space packages`
   → none, except git blame code.
4. `sqlite3` on a migrated copy of a v3 fixture: `PRAGMA foreign_key_check` empty;
   `SELECT count(*) FROM memories WHERE lineage_id NOT GLOB 'km_*'` = 0.
5. `rg -n 'memory_context' internal/memory/mcpserver internal/llmprompts/registry.go` shows tool and
   registry entry; `rg -n 'memoryContext' packages/workbench/src/memory` shows the query used in
   `MemoryContext.vue`.
6. UI libraries: `MemoryContext.vue` uses `@tanstack/vue-query` through `queries.ts`; dialog uses
   shadcn `ToggleGroup`, `Popover`, `Command`; no `<style` in `packages/workbench/src/memory/`.
7. Registry count matches `TestList`; `go run ./internal/llmprompts/cmd/checkprompts` passes.
8. Suites in §3.2 green; real `claude` rows run and reported.
9. This planner's and every discovery subagent's tool log shows real `codegraph_explore` calls.

## 8. Decisions log (final)

- Fact id = lineage id: a comment cites one id across every version.
- Version id `<fact id>.<n>`: derived, grepping the fact id finds every version.
- Prefix `km_`, Crockford base32 lowercase, 12 chars: word-boundary grep, no look-alikes, 60 bits.
- `go-nanoid/v2` library: library-first rule; MIT, pure Go.
- Migration ids via SQLite `random() & 31`: sqlitex runs SQL steps only; uniform over 32.
- Legacy uuid map kept: transcripts and notes may already cite old ids.
- Origin per item, required: one call can mix user and agent facts.
- Open `sourceTag` set with a shape check: new sources need no release.
- Grade order user > external > agent, enforced in Go: lower grade never hides a better fact.
- `author` removed everywhere: one term per concept.
- Session from argument, then env, then NULL: no hook infrastructure for one field.
- Scope per item, required; UI defaults Personal: MCP data stays complete, UI choice is visible.
- Project key from `origin` remote, `local:` path fallback: same key across clones and worktrees.
- New `internal/memory/project.go` parser: `ghclient.ParseRemote` is app-internal and rejects
  nested paths.
- Backfill scope `personal`: old rows never claimed wider validity.
- Reconcile and hash noop within scope and project: an update must not cross scopes.
- Groups by lineage, append-only: membership survives versions; history stays auditable.
- `request` kind recorded and backfilled: answers "which facts arrived together".
- Import mode writes `external`/`doc`/`personal` plus a `document` group: P274 reuses it.
- Gate output schema unchanged: provenance is Go-side inheritance, not a model choice.
- No search filters, no non-persist flag: P275 and P273 own them.
- Nested argument descriptions in `InputSchema`: agents must see what origin and scope mean.
- One sequential implementer: one dependency chain, SPEC Process.

## 9. Result

### 9.1 Step 0 probe

Real `claude -p --strict-mcp-config` started a stdio server that printed its env. `CLAUDE_CODE_SESSION_ID`
arrived and equaled the run's `--session-id`. Session capture from env works; no known open item.
