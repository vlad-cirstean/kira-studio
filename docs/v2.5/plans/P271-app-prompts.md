# P271 plan: app prompts in one file, editable in Settings

Ask (SPEC row P271, user requirement): every LLM prompt and LLM-facing instruction both apps send
lives in ONE source file with id, title, owning app, purpose, default text and declared template
variables. Callers read the effective prompt through one function. Overrides persist where every
consumer reads them, `memory-mcp` subprocess included. Settings gains a Prompts section in each app:
title, purpose, where used, Monaco editor, default vs edited marker, reset, diff against default,
preview with resolved variables marked by `VarText`. Save validates template parse and required
variables; a schema-bound prompt keeps its JSON schema fixed. A guard keeps prompt strings out of
every other file. User-authored text (smart-script bodies, workflow stage and step prompts) stays out.

Base: `v2.0` at `cbc60ea4a` (P270 close-out). Discovery ran through `codegraph_explore` (memory
prompts, ADE composition, claudeheadless suffixes and MCP servers, dbmcp, settings repos and bridge,
SettingsShell and panes, VarText) plus targeted reads of `apps/kira-space/internal/ade/*.go`, which
the index does not cover.

Not to confuse: `internal/prompts` and `packages/workbench/src/prompts/` are the P246 popup router.
This phase names everything `llmprompts` / `llmPrompts`.

## 1. Inventory

Every entry below moves into the registry. "Args" are MCP tool argument descriptions (today
`jsonschema:"..."` struct tags). Line numbers at base.

### 1.1 Memory (Space; `internal/memory`)

| Id | Today | Kind |
|---|---|---|
| `memory.dataHygiene` | `gate.go:10` `dataHygiene`, re-exported `claude.go:49` `DataHygiene` | fragment |
| `memory.gate.system` | `gate.go:12-34` `gatePrompt`; schema `gate.go:36` `gateSchema`; call `gate.go:116` | system, schema-bound |
| `memory.reconcile.system` | `reconcile.go:11-21`; schema `reconcile.go:23`; call `reconcile.go:173` | system, schema-bound |
| `memory.import.extract.system` | `importer/extract.go:20-34`; schema `extract.go:36`; call `extract.go:87` | system, schema-bound |
| `memory.import.finalize.system` | `importer/finalize.go:29-42`; schema `finalize.go:44`; call `finalize.go:98` | system, schema-bound |
| `memory.mcp.instructions` | `mcpserver/server.go:20-26` | instructions |
| `memory.mcp.tool.store_memory` | `server.go:65`; args `server.go:29-31` | tool + 3 args |
| `memory.mcp.tool.search_memories` | `server.go:72`; args `server.go:35-37` | tool + 3 args |
| `memory.mcp.tool.memory_history` | `server.go:88`; arg `server.go:47` | tool + 1 arg |
| `memory.mcp.remember.description` | `server.go:101`; arg `server.go:102` | text + 1 arg |
| `memory.mcp.remember.message` | `server.go:112-122` `rememberText` | message template |
| `memory.mcp.store.challenged` | `server.go:149` | tool-result instruction |
| `memory.mcp.semantic.notInstalled` | `server.go:197` | tool-result instruction |
| `memory.mcp.semantic.unavailable` | `server.go:199` | tool-result instruction template |

### 1.2 Headless agent runs (both apps; `internal/claudeheadless`, `internal/scriptruns`)

| Id | Today | Kind |
|---|---|---|
| `headless.finishStep.suffix` | `suffix.go:7` `FinishStepSuffix` + `suffix.go:11-29` `FinishStepSuffixFor`; TS mirror `apps/kira-space/frontend/src/ade/v2/board/runMessage.ts:5-11,27-52` | suffix template |
| `headless.space.suffix` | `suffix.go:38` | suffix |
| `headless.rebase.reportSuffix` | `suffix.go:44` | suffix |
| `headless.script.reportSuffix` | `suffix.go:47`; composed `scriptruns/preview.go:177-180` | suffix |
| `headless.space.instructions` | `space.go:22-24` | instructions |
| `headless.tool.finish_step` | `mcp.go:215`; args `mcp.go:129-134`; status description built `mcp.go:179-192` | tool + 6 args (status is a template) |
| `headless.finishStep.ack` | `mcp.go:278` "Recorded. Stop now." | tool-result instruction |
| `headless.tool.task_info` | `space.go:128` | tool |
| `headless.tool.declare_repos` | `space.go:142`; arg `space.go:87` | tool + 1 arg |
| `headless.tool.request_branch` | `space.go:160`; args `space.go:91-92` | tool + 2 args |
| `headless.tool.branch_status` | `space.go:175`; args `space.go:96-97` | tool + 2 args |
| `headless.tool.run_outcome` | `outcomes.go:53`; args `outcomes.go:40-43` | tool + 4 args |
| `headless.tool.git` | `gittool.go:318`; args `gittool.go:35-36` | tool + 2 args |

### 1.3 ADE (Space; `apps/kira-space/internal/ade`)

| Id | Today | Kind |
|---|---|---|
| `ade.rebase.prompt` | `rebaseprompt.go:13-49` `composeRebasePrompt` (fmt) | message template |
| `ade.step.prompt` | `vars.go:50-76` `composePrompt` header; TS mirror `runMessage.ts:77-86` `defaultRunMessage` | message template |
| `ade.stage.message` | `vars.go:108-125` | message template |
| `ade.review.message` | `vars.go:151-168` (closing sentence `vars.go:166`); used `review_agent.go:51` | message template |
| `ade.start.message` | `vars.go:172-183`; used `launches.go:563` | message template |
| `ade.repoLine` | `vars.go:92-97` `repoLine.String` | fragment template |
| `ade.jiraLine` | `vars.go:99-104` | fragment template |
| `ade.rebase.contextLine` | `rebase.go:753-773` (line `rebase.go:771`) | message template |
| `ade.sendBack.line` | `route.go:148` | message template |

Glue only, stays in code (whitespace joins of entries, no prompt words): `rebaseRunPrompt`
`rebaseprompt.go:52`, `composeResumePrompt` `vars.go:79`, smart-step suffix join `smartstep.go:82-86`,
`preview.go:177-180` join.

### 1.4 Studio DB MCP (`apps/kira-studio/internal/dbmcp`)

| Id | Today | Kind |
|---|---|---|
| `dbmcp.instructions` | `server.go:142` | instructions |
| `dbmcp.tool.list_connections` | `server.go:203` | tool |
| `dbmcp.tool.list_children` | `server.go:207`; args `tools.go:92-94` | tool + 3 args |
| `dbmcp.tool.describe_table` | `server.go:211`; args `tools.go:111-113` | tool + 3 args |
| `dbmcp.tool.describe_schema` | `server.go:215`; args `tools.go:133-135` | tool + 3 args |
| `dbmcp.tool.run_query` | `server.go:219`; args `tools.go:157-160` | tool + 4 args |
| `dbmcp.tool.explain_query` | `server.go:223`; args `tools.go:400-403` | tool + 4 args |

Totals: 43 top-level entries (3 fragments), 42 argument entries, 85 in all. Space lists 61, Studio 33
(shared: `headless.script.reportSuffix`, `headless.tool.finish_step` with 6 args, `headless.finishStep.ack`). The orchestrator checks
this count against the registry.

### 1.5 Out of scope (decided)

- Tool and server names, MCP prompt title "Remember", tool error strings (`toolError(...)`), data
  formatting in tool results (`renderStore` outcome lines, `renderMemories`). Why: identifiers and
  error/data text, not instructions; P273 reworks result formats.
- User-authored text: smart-script command bodies, workflow stage/step prompts, `{task}` style
  substitution (`vars.go:19-30`, TS `defaultRunMessage` replaceAll of the step prompt). Why: SPEC.
- `internal/flowtest/fakeagent` tool descriptions. Why: test tooling.
- JSON output schemas stay fixed: shown read-only in Settings, never editable. Why: SPEC (4); Go
  decodes them into fixed structs.

## 2. Design (all decisions final)

### 2.1 Package `internal/llmprompts`

- **Name** `llmprompts`. Why: avoids `internal/prompts` (P246) and says what it holds.
- **The one file** `internal/llmprompts/registry.go`: every entry's id, kind, apps, title key,
  purpose key, usedBy key, applies-when, default text, vars type, example vars, required fragments,
  fixed schema. No prompt text anywhere else. Why: SPEC (2); P272-P276 edit prompts here only.
- **Go source file, not YAML/JSON.** Why: typed handles give compile-time safety at every caller,
  and Go raw strings hold multi-line text; texts with backticks (`dbmcp.instructions`) use quoted
  strings.
- Supporting files (no prompt text): `entry.go` (types), `render.go`, `parts.go`, `validate.go`,
  `store.go`, `schema.go`, `bound.go`, `cmd/checkprompts/main.go`.
- **Typed handles.** `type Prompt[V any] struct{ id ID }`, `func (p Prompt[V]) Text(src Source, v V)
  string`. Entries without variables use `NoVars`. Registry declares
  `var MemoryGateSystem = define[NoVars](Entry{...})` etc. Why: a caller cannot pass the wrong
  variable type.
- **Kinds:** `system`, `message`, `suffix`, `instructions`, `tool`, `argument`, `toolResult`,
  `fragment`. `argument` entries carry `Parent` (the tool id) and `Field` (JSON name).
- **Apps:** `[]App{Studio, Space}` per entry. `headless.script.reportSuffix`,
  `headless.tool.finish_step` (+ args) and `headless.finishStep.ack` list both apps; `dbmcp.*`
  Studio; the rest Space. Each app's Settings lists its own.
- **Applies-when** field: `nextCall` (system, message, suffix, toolResult, headless tools and
  dbmcp tools/instructions) or `newSession` (`memory.mcp.*` instructions, tools, args, remember).
  Shown in Settings. Why: `memory-mcp` builds its server once per Claude session (§2.5).

### 2.2 Templates

- **Engine:** Go `text/template`, one template set per resolve holding every entry as a named
  template, so `{{template "memory.dataHygiene"}}` includes a fragment. Why: SPEC default, stdlib,
  handles the loops and conditionals of `composeRebasePrompt`/`composePrompt`.
- **Literal kind:** an entry with `NoVars` and no fragments is literal text, never parsed. Why: tool
  and argument descriptions may contain `{{` and must not need escaping.
- **Funcs:** `inc` (1-based numbering) and `join`. Nothing else. Why: what today's fmt composition
  needs; a small surface keeps templates readable.
- **Vars are Go structs** declared in `registry.go` (e.g. `RebaseVars{Repo, Onto, Remote, Review
  string; Autostash, Push bool; Stack []RebaseStackVar}`, `FinishVars{Implicit bool; Results
  []ResultVar}`). Required fields carry tag `prompt:"required"`. Example values live beside them.
- **Branch on bools and list length, never `eq` on strings.** Why: preview parts wrap string values
  (§2.3); the parts self-check catches a violation.
- **Numbers that mirror a Go constant become variables** filled from the constant (e.g.
  `MaxFactsPerChunk`, `MaxEvidenceLen`, store batch size), so text and code cannot drift.
  Implementer binds every such number found while moving text; others stay literal.
- **Defaults are byte-identical to today's output.** Migration changes no prompt text (§4 golden
  test). Why: P272-P276 own wording changes.

### 2.3 Resolved preview parts

- `RenderParts(id, vars) ([]Part, error)`; `Part{Text, Var, Value}` (same JSON shape as
  `scripts.Part`, so the frontend's existing `TextPart` mapping applies).
- Method: deep-copy vars, wrap every non-empty string leaf as `U+FDD0 name U+FDD1 value U+FDD2`
  (name = field path, e.g. `Stack.Worktree`), render, split on markers. Marker runes are stripped
  from incoming values first. Self-check: stripping markers from the wrapped render must equal the
  plain render; on mismatch return one literal part. Why: chips without trusting template authors.

### 2.4 Override store

- **File per app:** `<app home>/llm-prompts.json` (`~/.kira-studio/`, `~/.kira-space/`), written
  with `renameio.WriteFile`, mode 0600. Why: apps never share a home (P100 Part 1); a file is
  readable by the `memory-mcp` subprocess without opening the app DB, whose migrations and locks
  belong to the app process; ARCHITECTURE "Files under KIRA_HOME: atomic write (renameio)".
  Rejected: `memory.db` table (memory concern only; Studio has none), app settings DB (subprocess
  would open the app DB).
- **Shared entries are per app.** Editing `headless.script.reportSuffix` in Studio leaves Space's
  copy alone. Why: same home rule; each Settings shows what that app sends.
- **Shape:** `{"version":1,"revision":N,"overrides":{"<id>":{"text":"...","defaultHash":"<sha256 of
  default at save>","updatedAt":<unix ms>}}}`.
- **Reads:** `Store.Resolve(id)` stats the file per call and re-reads on (mtime, size) change.
  Why: running consumers see an edit on their next call; a stat is free next to a `claude` call.
- **Bad data never breaks a call.** Corrupt file: defaults for everything, `slog.Warn`, Settings
  shows an error banner. An override that no longer validates (registry changed after an upgrade):
  default used, entry flagged `invalid` with the reason. Unknown ids: ignored, kept on rewrite.
  Runtime render error of an override: default used, warn logged.
- **Default changed since edit:** `defaultHash` differs from the current default; entry flagged
  `defaultChanged`; diff tab shows both. Why: upgrades must not silently pin stale prompts unnoticed.
- **Saving the default text removes the override.** Reset is "set draft to default, Save". Why:
  ARCHITECTURE settings rule "every leaf is draft plus Save" with a reset button.
- **Conflict:** each change carries `baseHash` (hash of the effective text the client edited);
  mismatch refuses with `E_CONFLICT`. Why: ARCHITECTURE bridge conflict-guard convention.
- `Source` interface `{ Resolve(id ID) Resolved; Revision() uint64 }`. `Defaults()` is the
  registry-only source for unit tests and callers built without a store.
- **Bounds:** text 1 byte to 32 KiB; at most one override per registry id.

### 2.5 Consumers and freshness

- **Injection, no global.** Each consumer gets a `llmprompts.Source` through its existing
  options/deps struct (`memory.ServiceOptions`, `importer.ClaudeAgent`, `mcpserver.Options`,
  `claudeheadless.Options`, `scriptruns.Service`, ade `TaskBoard` deps, `dbmcp.Config`). Why:
  repo style is explicit deps; tests stay parallel-safe.
- **memory-mcp:** `memorycli.Run(args, sourcePath string)`; `RunArgvShim`
  (`apps/kira-space/internal/appwire/wire.go:54`) passes `<config.KiraSpaceHome()>/llm-prompts.json`.
  Gate and reconcile resolve per call (edit applies at once). Server instructions, tool and argument
  descriptions are built once per process (= per Claude session). Why: MCP sends instructions at
  initialize; a running session cannot pick them up anyway.
- **dbmcp (stateless HTTP):** `getServer` (`http.go:79`) returns a server rebuilt when
  `Source.Revision()` changed, held in an `atomic.Pointer`. Why: next request sees new descriptions
  without a restart.
- **claudeheadless:** shared servers cache (`mcp.go:311`) keyed by flags plus revision; per-run
  servers build fresh at `Register`.
- **Argument descriptions:** `llmprompts.InputSchema[T](src, toolID)` runs `jsonschema.For[T]` and
  sets each property's description from its `argument` entry; a property without an entry, or an
  entry without a property, panics at server build (programming error, same as `finishSchema`
  today). `jsonschema:"..."` tags are deleted.
- **TS mirrors deleted.** `runMessage.ts` loses `FINISH_STEP_SUFFIX`, `FINISH_RESULTS_*`,
  `finishStepParts`, `finishStepSuffix`, `defaultRunMessage`. `AdeRunDialog.vue` and
  `AdeStepInspector.vue` get text and parts from `LlmPromptsService.Preview` (§2.6) with real vars;
  `{repo}` `{branch}` `{worktree}` stay literal placeholders in the run dialog default message as
  today.

### 2.6 IPC (`llmprompts.Bound`, shim `bridge.LlmPromptsService` per app)

Follows `internal/prompts/bound.go` shape and ARCHITECTURE method verbs.

- `List() ([]PromptView, error)`: this app's entries. `PromptView`: `id`, `kind`, `parent`,
  `field`, `titleKey`, `purposeKey`, `usedByKey`, `applies`, `vars` (`name`, `required`,
  `example`), `fragments`, `schema` ("" when none), `defaultText`, `text` (effective), `hash`,
  `overridden`, `invalid` (reason or ""), `defaultChanged`, `updatedAt`. Plus top-level
  `storeError` ("" or the corrupt-file reason).
- `Save(LlmPromptsSaveArgs{changes: [{id, text, baseHash}]}) ([]PromptView, error)`: validates all
  first; any failure saves nothing and returns `E_BAD_REQUEST` with per-id errors in the payload
  (`{id, message, line, col}`). Text equal to default removes the override. Emits
  `kira:llmPrompts:changed`. Why: one dialog Save, all or nothing.
- `Preview(LlmPromptsPreviewArgs{id, text?, vars?}) (PromptPreview, error)`: `errors` (same shape)
  plus `parts`. `text` omitted = effective text; `vars` omitted = example vars. Settings uses it for
  live validation and preview; ADE dialogs use it with real vars. Why: one render path, no TS copy.
- Event `kira:llmPrompts:changed` (`internal/appevent`, `packages/shared/protocol/events.ts`),
  payload `{revision}`; the client invalidates its query.
- Errors through `ipcerr.T` with catalog keys `backend.llmPrompts.*.body`.

### 2.7 Validation (`validate.go`, server side, authoritative)

In order; all errors collected:

1. Text non-empty, at most 32 KiB, valid UTF-8.
2. Literal kind: done.
3. Template parses (with the whole set, so fragment references resolve); error with line and col.
4. Every `prompt:"required"` top-level field is referenced (parse-tree walk at root context).
5. Every required fragment (`RequiredFragments`, e.g. `memory.dataHygiene` in the four memory
   system prompts and finalize) is included via `{{template}}`. Why: the untrusted-data paragraph
   is the prompt-injection defence; the fragment text itself stays editable.
6. Executes against the example vars without error (catches undeclared fields: `can't evaluate
   field`) and renders non-empty.
7. A fragment edit re-validates every entry including it.

Schema-bound entries: schema not part of the payload, so nothing can change it.

### 2.8 Settings UI (both apps, shared code in `packages/workbench`)

- **Section** `Prompts`, placed just before `Advanced` (Advanced last rule). Added to each app's
  `state/settings.ts` `sections` and `SettingsDialog.vue`.
- **Draft plus Save,** like every Settings leaf. Drafts live in Pinia store
  `useLlmPromptDraftsStore` (`packages/workbench/src/state/llmPromptDrafts.ts`, id
  `llmPromptDrafts`; one concern: unsaved prompt edits and their base hashes). `SettingsShell.vue`
  gains an optional `extra` prop `{ isDirty, isValid, save(), discard() }`; footer Save runs
  `extra.save()` (prompts `Save`) then the settings patch; Cancel and close discard. Why:
  ARCHITECTURE settings rule; one Save for the whole dialog.
- **Server state** through TanStack Query (`packages/workbench/src/llmPrompts/queries.ts`):
  `useLlmPrompts()` (key `['llmPrompts']`, invalidated on the event), `useLlmPromptPreview(id, text)`
  (draft text debounced with VueUse `refDebounced`, `keepPreviousData`), `useSaveLlmPrompts()`.
  Control injected like `promptsControlKey` (`llmPromptsControlKey`).
- **Layout** (`PromptsPane.vue`): `ResizablePanelGroup`; left: list grouped by area (Memory, Agent
  runs, Rebase and review, Database MCP) with `SectionHeading`, row = title, `Badge` "Edited" /
  "Default changed" / "Invalid"; tool rows show the tool name in `font-data`. Right
  (`PromptDetail.vue`): title, purpose, where used, applies-when note, reset button (field anatomy),
  `Tabs`: Edit | Changes | Preview.
  - Edit: `PromptEditor.vue`, Monaco plain text, word wrap, via `loadMonaco`; `FieldError` lines
    from Preview errors with line and col; variables list (name in `font-data`, required marker,
    catalog description, click inserts `{{.Name}}`); fragments listed; schema in a read-only
    `CodeBlock` under a `Disclosure` for schema-bound entries.
  - Changes: `PromptDiff.vue`, Monaco diff editor, default (left, read-only) vs draft (right).
  - Preview: `VarText` over `Preview.parts` with example values; chips mark every resolved value.
  - Tool entries: description in Monaco; each argument below as a `Textarea` field with its own
    reset. Why: argument texts are one line; one Monaco per argument is heavy.
- **No shared Monaco text component exists** (`MonacoHost.vue` is Studio-only and SQL-shaped), so
  `PromptEditor.vue` and `PromptDiff.vue` are new in `packages/workbench/src/llmPrompts/`.
- Tailwind utilities only, shadcn-vue primitives (`Tabs`, `Badge`, `Button`, `Textarea`, `Field*`,
  `Alert`, `resizable`), `<script setup lang="ts">`. Identifiers `font-data`. No scoped style.
- **Copy** in the P265 catalog (`packages/theme/src/i18n/en.json`): namespace `llmPrompts.*` for
  pane chrome; per-entry `llmPrompts.entry.<id>.title|description|usedBy` for non-tool,
  non-argument entries; tool/argument entries show the tool or field name (identifier) and a shared
  kind description; variable descriptions `llmPrompts.var.<name>.description`; nav
  `llmPrompts.nav.label`. Prompt texts are LLM-facing and never translated. Keys referenced
  literally in `registry.go` so `check-catalog --unused` sees them.
- `data-testid`: `settings-section-Prompts`, `llm-prompt-row` (`data-id`), `llm-prompt-editor`,
  `llm-prompt-diff`, `llm-prompt-preview`, `llm-prompt-reset`, `llm-prompt-error`,
  `llm-prompt-badge`.

### 2.9 Guard

`internal/llmprompts/cmd/checkprompts` (Go, `go/ast`), wired into `bun run lint` (pre-commit).
Fails when, in any non-test `.go` file outside `internal/llmprompts` and `internal/flowtest`:

- a `jsonschema:"..."` struct tag exists;
- an `mcp.Tool`, `mcp.Prompt`, `mcp.PromptArgument` or `mcp.ServerOptions` literal sets
  `Description` or `Instructions` to anything but an `llmprompts` call;
- a `memory.Call` literal sets `System` to anything but an `llmprompts` call;
- any `.go`, `.ts` or `.vue` file (tests, generated bindings and `en.json` excluded) contains the
  first 48 characters of any registry default text that is at least 48 characters long, or a whole
  default shorter than that but at least 24 characters.

Why: AST rules catch new prompts by shape; the phrase scan catches copies in Go and TS.

## 3. Execution

Sequential foundation, then two streams, then one serial test-and-fix agent, then close-out.

### 3.1 F (one Sonnet, main checkout)

1. `internal/llmprompts`: `entry.go`, `registry.go` (all 85 entries, defaults copied byte-for-byte,
   vars types and examples, schemas moved from `gate.go`/`reconcile.go`/`extract.go`/
   `finalize.go`), `render.go`, `parts.go`, `validate.go`, `store.go`, `schema.go`, `bound.go`.
   Old constants stay in place for now (stream A deletes them); the phrase guard is not wired yet.
2. Golden fixtures: before any caller change, a scratch program (scratchpad, not committed) calls
   today's `composeRebasePrompt`, `composePrompt`, `composeStageMessage`, `composeReviewMessage`,
   `composeStartMessage`, `FinishStepSuffixFor`, `rememberText`, `rebaseContext` line,
   send-back line over the inputs in §4; outputs commit as
   `internal/llmprompts/testdata/golden/*.txt`.
3. Unit tests (§4).
4. Bridge: `bridge.LlmPromptsService{*llmprompts.Bound}` in both apps; store built in appwire at
   `<home>/llm-prompts.json`, added to `appcore.Deps` as `Prompts llmprompts.Source`; event channel
   both sides; Wails bindings regenerated per `docs/DEV_ENVIRONMENT.md`.
5. TS: `packages/shared/domain/llmPrompts.ts` (wire types), `createCoreControl.ts` methods
   `llmPromptsList/Save/Preview` and `onLlmPromptsChanged`, `packages/workbench/src/llmPrompts/
   queries.ts`.
6. Catalog keys: every key §2.8 names, plus `backend.llmPrompts.*` errors.
7. Test support: `IPC` channel constants and default mock answers for the three methods in both
   apps' `tests/ui/support/`.
8. Flow tests, IPC half (§4), writing contract scenario `llm-prompts` in both apps.

Commits: `feat(llmprompts): registry, templates and validation`, `test(llmprompts): golden and
unit tests`, `feat(llmprompts): override store and IPC service`, `feat(llmprompts): client
control, queries and catalog keys`, `test(llmprompts): IPC flow tests and contracts`.

### 3.2 Streams

Split confirmed: zero file overlap (table below) and no ordering dependency. A consumes only F's Go
API and `queries.ts`; B consumes only F's IPC, `queries.ts`, catalog keys, test support and the
`llm-prompts` contract files. Neither reads the other's output. Worktrees off F's last commit, each
prepared with `sh scripts/prepare-worktree.sh`. Two streams (CLAUDE.md cap). Implement only: typecheck
and lint per commit, write every planned spec, run no expensive suite.

| Owner | Files |
|---|---|
| F only (frozen after F) | `internal/llmprompts/**` except `cmd/`; `apps/*/internal/bridge/llmprompts.go`; `apps/*/internal/appcore/deps.go`; `apps/*/internal/appwire/appwire.go`; `internal/appevent/appevent.go`; Wails bindings dirs of both apps; `packages/shared/domain/llmPrompts.ts`; `packages/shared/protocol/events.ts`; `packages/workbench/src/bridge/createCoreControl.ts`; `packages/workbench/src/llmPrompts/queries.ts`; `apps/*/tests/ui/support/**`; `apps/*/tests/contract/llm-prompts.json`; `apps/*/internal/flows/llmpromptsflow/**` |
| A: caller migration | `internal/memory/{gate,reconcile,claude,service}.go`; `internal/memory/importer/{extract,finalize}.go`; `internal/memory/mcpserver/server.go`; `internal/memory/memorycli/run.go`; `internal/claudeheadless/{suffix,mcp,space,outcomes,gittool}.go`; `internal/scriptruns/preview.go` (+ service constructor file if the Source lands there); `apps/kira-space/internal/ade/{rebaseprompt,vars,review_agent,rebase,route,smartstep,runs,launches,board}.go`; `apps/kira-space/internal/appwire/wire.go`; `apps/kira-studio/internal/appwire/wire.go`; `apps/kira-studio/internal/dbmcp/{server,tools,http}.go`; `apps/kira-studio/internal/bridge/dbmcp.go`; `apps/kira-space/frontend/src/ade/v2/{board/runMessage.ts,run/AdeRunDialog.vue,workflows/AdeStepInspector.vue,queries.ts}`; Space ADE UI specs touching those dialogs; `apps/kira-space/internal/flows/{memoryflow,adeflow}/llmprompts_test.go`; `apps/kira-studio/internal/flows/dbmcpflow/llmprompts_test.go`; `apps/kira-space/tests/contract/ade-run.json`; `internal/llmprompts/cmd/checkprompts/**`; `package.json` |
| B: Settings UI | `packages/workbench/src/llmPrompts/*.vue`; `packages/workbench/src/state/llmPromptDrafts.ts`; `packages/workbench/src/components/SettingsShell.vue`; `apps/*/frontend/src/state/settings.ts`; `apps/*/frontend/src/workbench/SettingsDialog.vue`; `apps/*/frontend/src/workbench/settings/PromptsPane*.vue` (thin per-app wrappers if needed); `apps/*/tests/ui/settings-llm-prompts.spec.ts`; `packages/theme/src/i18n/en.json` (only keys B finds missing) |

Rules: a stream that needs a file outside its row stops and reports; no silent edit. A adds no
catalog keys (removing TS mirrors needs none). If A's existing test files under `internal/memory`,
`internal/claudeheadless`, `apps/kira-studio/internal/dbmcp` or `apps/kira-space/internal/ade`
need a `Source` argument, they belong to A.

**A order:** memory (Source into `ServiceOptions`, `ClaudeAgent`, `mcpserver.Options`; memorycli
path) → claudeheadless (suffix functions take Source; servers via `InputSchema`; cache by
revision) → scriptruns → ADE Go → dbmcp (rebuild on revision) → TS mirror removal and ADE dialog
Preview calls → consumer flow tests → delete old constants and `jsonschema` tags → guard and
`package.json` lint line, guard passing. Commits per group: `refactor(memory): read prompts from
llmprompts`, `refactor(claudeheadless): ...`, `refactor(ade): ...`, `refactor(dbmcp): ...`,
`refactor(ade-ui): render run message and finish suffix in Go`, `test(llmprompts): consumer flows`,
`chore(lint): guard prompts outside llmprompts`.

**B order:** drafts store → SettingsShell `extra` → `PromptEditor`/`PromptDiff` → `PromptDetail`/
`PromptsPane` → wire into both dialogs → UI specs. Commits: `feat(settings): prompt drafts and
shell extra save`, `feat(settings): prompts pane`, `feat(settings): prompts section in both apps`,
`test(settings): prompts UI specs`.

**Landing:** rebase A then B onto the chapter branch (any order; a conflict means ownership was
wrong), remove worktrees.

### 3.3 Serial test-and-fix (one Sonnet, after landing)

Runs every suite once, fixes at cause, commits per group: `bun run lint`, `bun run lint:go`,
`bun run typecheck`, `go test ./...`, `bun run test:flows:space`, `bun run test:flows:studio`,
`bun run test:ui:space`, `bun run test:ui:studio`, unit suites. Then the opt-in real `claude` rows
(manual, never hooks): `bun run test:claude:space -run TestMemoryGate`,
`-run 'TestMemoryMcpThroughClaude|TestMemoryInstallRegisters'`, `-run TestMemoryImport`,
`-run 'TestAdeHeadlessRun|TestAdeStepResults|TestAdeStageSession|TestAdeRebaseRun'`,
`-run TestSmartScriptRun`; `bun run test:claude:studio` (DB MCP and `TestSmartScriptRun`).

### 3.4 Close-out (one Sonnet)

`docs/ARCHITECTURE.md`: new "App prompts" section (registry, kinds, store file, Source injection,
freshness per consumer, guard); settings table row "LLM prompt overrides | `<home>/llm-prompts.json`
(renameio)". `docs/DEV_ENVIRONMENT.md` real `claude` table: row `internal/llmprompts/**` → memory
gate, memory MCP, memory import, ADE, smart scripts and DB MCP rows. Result section appended here.
SPEC row P271 Done. Commit `docs: P271 close-out`.

## 4. Tests

Unit tests (advanced logic only), `internal/llmprompts`:

- `validate_test.go`: table over parse error with line/col, missing required var, undeclared field,
  missing required fragment, fragment edit breaking an includer, literal kind with `{{`, empty, over
  32 KiB, invalid UTF-8. Why: several interacting rules.
- `parts_test.go`: wrapping and split, nested list fields, empty strings unchipped, marker runes in
  values stripped, self-check fallback on a string `eq`. Why: marker arithmetic.
- `store_test.go`: override resolve, external rewrite seen after stat change, corrupt file → defaults
  plus `storeError`, invalid override → default plus `invalid`, `defaultChanged`, `baseHash`
  conflict, saving default text deletes the override, unknown ids preserved. Why: cache
  invalidation with interacting rules.
- `golden_test.go`: every composed template's default render over the fixture inputs equals
  `testdata/golden/*.txt`. Inputs: rebase (single branch, stack of 3, remote, autostash, review
  repo, push on/off), step prompt (Jira on/off, Message override, Extra, Context lines, Space on,
  implicit and declared results), stage/review/start messages (read-only repo, notes capped at 2000
  runes), remember (empty and given text), finish suffix (implicit pair, declared with and without
  descriptions). Why: migration of fmt composition with branches must not change a byte.
- `registry_test.go` is not added: registry consistency (unique ids, every argument's parent
  exists, catalog keys exist) runs as `init`-time checks plus the flow tests' `List`.

New-feature tests split at the IPC boundary (same scenario, same asserted result):

| Scenario | Go flow (backend half) | UI spec (frontend half) |
|---|---|---|
| List | `llmpromptsflow` `TestList`: entry count per app (Space 61, Studio 33 per §1), `memory.gate.system` not overridden | `settings-llm-prompts.spec.ts`: rows from contract, gate row has no badge |
| Edit and preview | `TestPreview`: draft text with `{{.Missing}}` → error line 1; valid draft → parts with var chips for example values | typing in editor shows `llm-prompt-error`; Preview tab shows `var-chip` elements equal to contract parts |
| Save | `TestSave`: save gate override → `List` shows `overridden`; file holds it; event emitted | Save sends contract payload; row shows "Edited" badge |
| Invalid save | `TestSaveInvalid`: missing required fragment → `E_BAD_REQUEST`, nothing written | Save disabled while preview errors; forced contract error shown in footer |
| Reset | `TestReset`: save default text → override removed | reset button restores default, Save, badge gone |
| Conflict | `TestConflict`: stale `baseHash` → `E_CONFLICT` | contract conflict error shown, draft kept |

Studio runs the same scenarios over `dbmcp.instructions` (literal); its invalid-save case edits the
`headless.tool.finish_step` `status` argument template with an undeclared field.

Consumer flows (stream A, Go only, no UI half: effect is outside the UI):

- `memoryflow/llmprompts_test.go`: override `memory.gate.system`; in-app `Store` and a store through
  the `memory-mcp` subprocess both make the fake agent receive the override as `--system-prompt`
  (fakeagent records it, `fakeagent.go:314`).
- `adeflow/llmprompts_test.go`: override `headless.finishStep.suffix`; the fake `claude` prompt of a
  headless step ends with it.
- `dbmcpflow/llmprompts_test.go`: override `dbmcp.instructions` and the `run_query` description;
  a new MCP client session sees both, no server restart.

ADE UI specs that open `AdeRunDialog`/`AdeStepInspector` mock `Preview` with contract data from
`adeflow` (A writes the `ade-run` contract keys it needs).

## 5. Verification (orchestrator, real checks)

1. `rg -n 'jsonschema:"' --glob '*.go' --glob '!*_test.go' --glob '!internal/flowtest/**'` → none.
2. `rg -n 'gatePrompt|reconcilePrompt|extractPrompt|finalizePrompt|FinishStepSuffix|ScriptReportSuffix|RebaseReportSuffix|SpaceSuffix|spaceInstructions|composeRebasePrompt|FINISH_STEP_SUFFIX|defaultRunMessage'`
   outside `internal/llmprompts` → none.
3. Registry count: 85 entries (43 top-level, 42 arguments); `go run ./internal/llmprompts/cmd/checkprompts` passes and is in `package.json` `lint`.
4. Real callers: `rg -n 'llmprompts\.' internal/memory internal/claudeheadless internal/scriptruns apps/kira-space/internal/ade apps/kira-studio/internal/dbmcp`
   shows each consumer file of §1; `rg -n 'llmPromptsPreview' apps/kira-space/frontend/src/ade` shows both ADE dialogs.
5. UI uses the libraries: `PromptsPane` imports shadcn `Tabs`/`Badge`/resizable, queries use
   `@tanstack/vue-query`, drafts are a Pinia `defineStore`, `VarText` in the Preview tab; no
   `<style` in `packages/workbench/src/llmPrompts/`.
6. `memorycli.Run` receives the Space prompts path (`rg -n 'llm-prompts.json'`).
7. Suites in §3.3 green; real `claude` rows run and reported with spend.
8. Each discovery subagent's tool log shows real `codegraph_explore` calls (CLAUDE.md).

## 6. Decisions log (final, for the end report)

- Package `internal/llmprompts`, frontend `llmPrompts`: no clash with P246 `prompts`.
- One Go file `registry.go`, typed handles: compile-time safety, readable multi-line text.
- `text/template`, two funcs, literal kind for var-less entries: stdlib, no escaping in descriptions.
- Argument descriptions move into the registry and become editable: they are LLM-facing; P276 edits
  one place.
- Tool-result instructions in scope, data formatting and errors out: instructions steer the agent;
  formats are P273's.
- Overrides in `<app home>/llm-prompts.json`, per app: subprocess-readable, homes never shared.
- Stat-validated reads per call: edits apply on the next call with no restart.
- `memory-mcp` server texts apply to new sessions: MCP sends them once at initialize.
- dbmcp rebuilds its stateless server on revision change: new descriptions without restart.
- Bad overrides fall back to defaults and are flagged: a broken edit never breaks a run.
- `defaultChanged` flag via stored default hash: upgrades never hide a changed default.
- Draft plus one dialog Save, all-or-nothing, reset = default text: ARCHITECTURE settings rule.
- `baseHash` conflict guard: ARCHITECTURE convention.
- `memory.dataHygiene` include required: prompt-injection defence stays in place.
- Preview chips by marker wrapping with self-check: chips without trusting templates.
- Generic `Preview` IPC replaces TS mirrors: one render path.
- Monaco for entries, `Textarea` for one-line arguments: weight versus value.
- New shared `PromptEditor`/`PromptDiff`: no shared Monaco text component exists.
- Two streams (caller migration, Settings UI) after a sequential foundation: proven zero overlap; a
  Space/Studio UI split fails because the pane is shared workbench code.
- Defaults byte-identical, golden-tested: wording changes belong to P272-P276.
- Guard = Go AST rules plus default-phrase scan over Go and TS: catches new prompts and copies.
