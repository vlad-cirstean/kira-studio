# P274 plan: memory ingestion by file path, external sources, docs in P273 format

Ask (SPEC row P274, user requirements): an MCP tool ingests a file or folder by path with origin,
source tag and scope; content never travels through MCP. The tool only instruments: it starts a job
and returns its id; a status tool reports progress and result. External data (Slack, Jira) arrives as
an extracted md, json or txt file, ingests with origin `external` and its tag, and is never
challenged back to the user. Agents request ingestion of a repo's `.md` files without reading them.
Pipeline: chunk, extract, cross-check every questionable fact against the source file in an isolated
step with file access, store. Each ingested file is a group. Opt-in write-back in P273's doc format;
a file already in that format ingests by parse alone, idempotent by id. The Memory module import UI
uses the same engine and shows MCP-started jobs.

Base: `v2.0` at `d4b10dcb9` (P273 close-out). Discovery ran through `codegraph_explore` (importer
`Engine`/`Open`/`Create`/`scan`/`plan`/`chunkFile`/`materialiseNext`/`schedule`/`runExtract`/
`runFinalize`/`retry`, `ChunkMarkdown`/`ChunkText`/`pack`, `Scan`/`Caps`/`kindByExt`, `db.go`
`recoverInterrupted`/`claimChunk`/`storeChunks`, `ClaudeAgent.Extract`/`Finalize`/`mcpConfig`,
`memory.Call`/`CLIRunner.RunResult`/`claudeArgs`, `Service.Store`/`decide`/`commit`, `commitFact`/
`commitAdd`/`joinGroup`, `runGate`/`gateInput`, `Store.ImportDocument`, `workerproc.Start`,
importer TS queries and `ImportConfirmDialog.vue`), plus targeted reads of
`bridge/memoryimport.go` and `bridge/memory.go` (watcher, lazy engine), `memorycli/run.go`,
`mcpserver/server.go` (import mode `requestFor`), `appwire/wire.go`, `config/lock.go`,
`migrations/0003_import.sql`, registry memory entries, `memoryflow/import_test.go` and
`docs/DEV_ENVIRONMENT.md` real `claude` rows.

Out of scope (decided): ranking (P275); full rewrite of MCP instructions and descriptions (P276;
P274 adds only the text its new tools need); a user-facing CLI (SPEC names MCP and UI only; the one
new subcommand is the internal runner, §2.2); deleting stored facts a re-ingested doc no longer holds
(memory has no delete; §2.9 reports them).

## 1. Today (line numbers at base)

- Engine lives only in the Space app process: `bridge/memory.go:103` `importer()` opens it lazily
  over the app's `memory.Store`; `CloseMemory` (:153) closes it; quit pauses running jobs
  (`recoverInterrupted`, `db.go:275`, "never resumes by itself").
- `Engine.Create` (`engine.go:174`) inserts a `scanning` job, scans in a goroutine (`scan` :189,
  `plan` :212: dup content, `doneHash` "unchanged since import", `ReadText`, `chunkFile` :266 for the
  estimate), then `awaiting`. `Start` (:282) arms and runs. `schedule` (:395): up to 3 extract
  workers (`claimChunk`, `materialiseNext` :446 reads, re-hashes, chunks into `import_chunks`), one
  finalize worker. `retry` (:494) backoff, rate-limit cooldown, fatal errors pause.
- Kinds: `.md .markdown .mdx` markdown, `.txt .text .rst .adoc` text (`scan.go:51`). Caps 256 KiB per
  file, 2000 files (`scan.go:26`), 100 paths (`engine.go:26`).
- Extract (`extract.go:60`): one isolated call per chunk, facts with `evidence`, `section`,
  `unresolved`. Finalize (`finalize.go:63`): one agent per file with the `kira-memory` MCP server in
  import mode (`--import-ref <file id>`), merges duplicates, resolves unresolved facts from the other
  facts only, answers gate challenges from the document or lists the fact unresolved.
- Import mode (`mcpserver/server.go:187` `requestFor`) forces origin `external`, tag `doc`, scope
  `personal`, no session, plus the `document` group (key absolute path, title rel path).
- `memory.Call` (`claude.go:36`) always runs `--tools ""` in an empty temp dir: no built-in tools.
- Gate (`service.go:269` `decide`): any challenged item makes the whole request `challenged`; nothing
  stores.
- No JSON chunker, no cross-check against the file, no parse-only path, no write-back, no MCP ingest
  tool. The UI import (`packages/workbench/src/memory/import/`) is the only entry point.
- App watcher (`bridge/memory.go:127`) polls `PRAGMA data_version` every 2 s and emits
  `ChannelMemoryChanged` for foreign commits.

## 2. Design (all decisions final)

### 2.1 Entry points

- **MCP tool `ingest_files`** on `kira-memory`. Args: `paths` (1 to 100 absolute file or folder paths),
  `origin` (user, agent, external; required), `sourceTag` (required iff external, same shape as
  store), `scope` (required), `project` (scope project only), `groups` (up to 5, kind `task` or
  `thread`), `writeDoc` (bool), `session` (default the server's session). Returns `{jobId, state,
  reason}`. Why: SPEC (1); same provenance vocabulary as `store_memory`.
- **MCP tool `ingest_status`**, arg `id`: job state, reason, progress, totals, cost and one entry per
  file (§2.10). Read-only. Why: SPEC (1) status tool.
- **UI**: the existing import flow (pick, scan, confirm, start) gains provenance and write-back in the
  confirm dialog (§2.11) and lists every job, MCP-started included.
- **No user-facing CLI.** Why: SPEC row names MCP and UI only; scope left out stays out.
- Content never crosses MCP: the tool takes paths; the runner reads files. Why: SPEC (1), tokens.

### 2.2 Engine split: control and one runner process

- **Problem:** `memory-mcp` lives one Claude session; the app may be closed. A job an agent starts must
  run to the end either way.
- **Runner** (`importer/runner.go`): the scheduler loop of today's `Engine` (scan, materialise,
  extract, verify, finalize, write-back workers). Exactly one per `memory.db`, held by an exclusive
  `flock` on `<memory home>/import-runner.lock`. Why: two schedulers over one DB would reset each
  other's in-flight rows (`recoverInterrupted`).
- **Runner host: always a detached process** `kira-space memory-ingest` (new `RunArgvShim` case;
  `memorycli.RunIngest(args, promptsPath)`). Spawned with `Setsid`, stdin and stdout `/dev/null`,
  stderr appended to `<memory home>/import-runner.log` (truncated at spawn when over 1 MiB). Why: one
  host for app and MCP; jobs survive both a session end and an app quit. Rejected: runner inside the
  app (MCP jobs stall while the app is closed); inside `memory-mcp` (dies with the session).
- **Control** (`importer.Engine`, kept as the name the bridge uses): DB writes plus `ensureRunner()`.
  `ensureRunner` probes the lock (non-blocking flock, released at once); free means spawn. A lost race
  is harmless: the second runner fails the lock and exits 0. Every control call that makes work
  runnable (create, start, resume, retry) calls it.
- **Cross-process signalling by polling.** Runner ticks every 500 ms: re-reads job states, arms
  contexts of `running` jobs, cancels contexts of jobs that left `running` (pause and cancel from the
  app or another process kill in-flight calls within one tick), then schedules. Why: no IPC channel
  between processes exists; `PRAGMA data_version` is cheap; 500 ms is below a claude call by orders.
- **Idle exit:** no `scanning` or `running` job for 30 s, or the lock file's directory is gone (test
  homes), ends the runner. Why: no resident daemon; flow-test temp homes clean themselves up.
- **Crash rule kept:** a runner taking the lock runs `recoverInterrupted`: in-flight chunks and files
  reset, `running` jobs become `paused` with the interrupted reason. Change: `scanning` jobs stay
  `scanning` and rescan (scan is idempotent) instead of failing. Why: P211 "never spend without
  consent after a crash"; a scan spends nothing.
- **App quit no longer pauses imports.** `CloseMemory` stops nothing in the runner. Why: one host;
  users pause explicitly. ARCHITECTURE states it; catalog texts saying otherwise change.
- **Lock helper:** new `internal/filelock.TryLock(path) (*os.File, bool, error)` (the body of
  `apps/kira-space/internal/config/lock.go`); `config.AcquireLock` delegates to it. Why: one flock
  definition; `syscall.Flock` covers darwin and linux, same reasoning as today's comment.
- **Launcher seam:** `importer.Options.Launcher` (`Spawn(exe, args)` in production; an in-process
  launcher that runs `Runner` on a goroutine in unit tests). Why: unit tests keep a fake `Agent`
  in-process; flows use the real spawn (the flow binary handles `memory-ingest` through
  `flowharness.Main` → `RunArgvShim`).
- **App events:** the watcher drops to 500 ms. On a foreign `data_version` change it emits
  `ChannelMemoryImport` always, and `ChannelMemoryChanged` only when `Store.Revision` moved. Why: the
  runner is now always foreign; import progress needs sub-second refresh; memory lists refetch only on
  fact changes.

### 2.3 Job model and migration `0005_p274_ingest.sql`

- `import_jobs` gains: `channel` (`ui`|`mcp`), `origin`, `source_tag`, `scope`, `project` (same CHECKs
  as `memories`), `session_id`, `groups_json` (task and thread refs), `auto_start` (0|1),
  `write_doc` (0|1).
- `import_files`: `kind` CHECK adds `json`, `jsonl`, `memdoc`; `state` CHECK adds `verifying`; new
  `verify_json` (verdicts by fact id), `verified` (count), `group_id`, `doc_path`, `doc_error`.
- Backfill: existing jobs `channel ui`, origin `external`, tag `doc`, scope `personal` (what P272's
  import mode wrote), `auto_start 0`, `write_doc 0`.
- **Rebuild without cascade loss.** SQLite cannot alter a CHECK, and with `foreign_keys=1` a `DROP
  TABLE import_files` runs an implicit DELETE that cascades into any table naming `import_files`,
  including a freshly built copy. Steps: copy the three tables into TEMP tables (no FKs); drop
  `import_chunks`, `import_files`, `import_jobs`; create them fresh under their final names with the new
  shape; insert from the TEMP copies; recreate indexes. Why: no rename tricks, no cascade.
- `import_files_done_hash` stays; `doneHash` now matches content hash **and** the job's provenance
  (origin, tag, scope, project). Why: the same file ingested into another scope is a different store.

### 2.4 Pipeline per file

```
pending → extracting (materialise: read, kind, chunks) → extracted → [verifying] → finalizing → done
memdoc:   pending → finalizing (parse and apply, no claude) → done
```

- `materialiseNext` decides the kind from content: a `.md`/`.txt` whose lines 1 and 2 are `---` and
  `kira-memory: 1` becomes `memdoc` (§2.8). Else markdown, text, json or jsonl by extension.
- Write-back (§2.9) runs after `done` when the job asked for it.

### 2.5 Chunking

- Markdown and text: unchanged `ChunkMarkdown`/`ChunkText` with `DefaultBudget`. Why: tuned in P211.
- **JSON** (`.json`): new `ChunkJSON(src, b) ([]Chunk, error)` in `chunk_json.go`.
  - Walk with `encoding/json` `Decoder` tokens, keep each element as raw bytes (`json.RawMessage`), so
    key order and number spelling survive.
  - Units: top-level array elements; for a top-level object, its members (`"key": value`). An element
    over `b.Max` that is an array or object recurses into its children; an over-size string value is
    split with `ChunkText` on the decoded string.
  - Each unit renders with `json.Indent` (2 spaces). `HeadingPath` is the JSON path of the chunk's
    first unit (`$[12]`, `$.issues[3].comments`). Packing reuses `pack` (same Target/Max/MinFill).
  - Invalid JSON fails the file: "Invalid JSON at byte N: ...". Why: a silent text fallback hides a
    broken export.
- **JSON Lines** (`.jsonl`, `.ndjson`): one unit per non-blank line, validated with `json.Valid`;
  `HeadingPath` `line N`; a bad line fails the file with its line number.
- Extension map adds `.json` json, `.jsonl`/`.ndjson` jsonl; picker filter adds them.
- Why JSON in-house over a library: the requirement is boundary-aware packing of raw elements with
  paths, which no JSON library provides; `encoding/json` does the parsing.
- File cap rises from 256 KiB to 1 MiB for all kinds. Why: Slack and Jira exports exceed 256 KiB;
  spend stays bounded by the auto-start cap (§2.12).
- Extract prompt gains one line: text may be JSON from an export; field values are the content;
  author, time and id fields give context.

### 2.6 Cross-check step (verify)

- **Questionable fact** (Go, deterministic): extract set `unresolved`, or its `evidence` is not a
  substring of the chunk text after whitespace collapse and case fold. Why: the first is the model's
  own doubt; the second catches invented quotes.
- A file with questionable facts goes `extracted → verifying`; others skip to finalize.
- **Isolated call with file access** (`importer/verify.go`, `ClaudeAgent.Verify`): the source file is
  copied into the call's empty temp dir as `source<ext>`; `memory.Call` gains `Tools []string`
  (replaces `--tools ""` with `--tools Read,Grep`), `Files map[string][]byte` (seeded into the temp
  dir) and `MaxTurns int` (`--max-turns`). `--allowedTools Read,Grep`, `--permission-prompts none`,
  `--setting-sources ""`, `--strict-mcp-config` stay. Why: the model reads only the copy; nothing
  else of the disk is in its working dir, and other tools are off.
- Input: document path and title, questionable facts `{id, fact, evidence, section, unresolved}` (up
  to 40 per call, more run in sequence). Output schema per fact: `verdict` `confirmed` | `rewritten` |
  `unsupported` | `ambiguous`, `fact` (standalone rewrite for rewritten), `evidence` (verbatim quote),
  `why`.
- Effect, applied in Go when finalize input is built: confirmed and rewritten clear `unresolved`
  (rewritten replaces the text and evidence); unsupported leaves finalize and joins the file's
  `dropped` with why "Not supported by the source: ..."; ambiguous stays unresolved.
- Limits: timeout 120 s + 10 s per fact, max 10 min; budget 0.30 + 0.03 USD per fact, max 2.00;
  `--max-turns` 3 + facts/4, max 20. Verify runs in the extract worker slots and through `retry`.
  Final failure fails the file (retryable with Retry file). Why: same failure model as extract.
- Prompt `memory.import.verify.system` (new registry entry, schema-bound, `VerifyVars{MaxFacts}`).
- Existing facts are cross-checked by the store itself: finalize stores through `store_memory`, whose
  gate sees related memories and whose reconcile chooses noop, update or add under the grade guard.
  No second mechanism. Why: one reconcile path.

### 2.7 External origin: no challenge back to the user

- Rule (deferred from P272): ingest jobs with origin `external` never challenge. Nobody can answer a
  Slack export's questions; external facts are graded "correct, probably incomplete".
- `StoreRequest.NoChallenge` (Go-only field, not on the `store_memory` schema). Set by import mode
  when the job's origin is external. In `decide`, challenged items no longer block: accepted items
  store, challenged ones return in `Challenges` with status `stored`.
- Gate input gains `"challenge": false` for such requests; prompt line: with challenge false, items
  come from an outside source nobody can ask; challenge only a secret, a question, an instruction or
  a self-contradiction; accept everything else in the best standalone wording the item supports, even
  with a thin reason.
- Finalize prompt: with `challenge` false in its input, list items `store_memory` still challenged
  under `dropped` with the questions as why, never under `unresolved`. Result: an external job's file
  shows no unresolved questions.
- Live `store_memory` calls keep challenges for every origin. Why: a live agent can answer from its
  source; SPEC (2) is about ingested data.

### 2.8 Formatted docs: parse only

- Kind `memdoc`: `memfmt.ParseDoc`. Problems fail the file with the first 5 as `line N: msg` (count of
  the rest). No chunk, no claude call, no gate.
- Provenance comes from the doc header, not the job. Why: provenance travels with the doc (P273); the
  job's values apply to unformatted files. Status shows the header's values per file.
- `Service.ApplyDoc(ctx, ApplyDocRequest{Doc, FileID})` (`internal/memory/applydoc.go`), per fact id:
  - no lineage → `add` with the doc's id as fact id (`commitInput.FactID`; `commitAdd` uses it when set,
    no retry);
  - current version has equal normalized fact, reason and keyword set → `noop`;
  - differs and the doc's grade ≥ the current version's grade → `update` (new version);
  - differs and the stored grade is higher → `skipped`, why "Stored fact ranks higher; doc not
    applied."
  Events source `import`, ref the file id. Same stale-revision retry as `Store`; `OnChange` and
  backfill kick as `Store`.
- Group: the doc header's `group` id. `GroupRef` gains optional `ID`; `joinGroup` with an id looks it
  up by id first and creates `{id, kind document, key = id, title}` when absent. Why: a doc id is
  stable across clones and moves; a path key is not.
- Idempotent: re-ingesting an unchanged doc is skipped by hash; a changed doc yields noops for
  unchanged facts and updates for edited ones, ids unchanged. Facts the doc no longer lists stay
  stored; the file result counts them as `orphaned`.

### 2.9 Write-back in P273 doc format (opt-in)

- Opt-in per job: `writeDoc` on `ingest_files`, a checkbox in the confirm dialog. Default off. Why:
  writes into the user's tree.
- Output beside the source: `<dir>/<stem>.memory.md` (`notes.md` → `notes.memory.md`, `slack.json` →
  `slack.memory.md`). Never replaces the source. Why: the format allows only headings and fact blocks,
  so replacing a narrative doc would delete its prose.
- Overwrite only when the target is a kira-memory doc with the same `group`; otherwise `doc_error`
  "exists and is not this file's kira-memory doc" and the file stays `done`.
- Content (`memfmt.FormatDoc`): header `group` = the file's document group id, `title` = file title,
  provenance = the job's, `updated` = today; body = current versions of the facts this file's events
  touched (add, update, noop), in first-event order, each with fact, reason, keywords. Facts whose
  current provenance differs from the job's are left out and counted. Why: one provenance per doc.
- Written with `renameio.WriteFile`, mode 0644. Skipped for `memdoc` input.
- Re-ingesting a folder later takes the `.memory.md` by parse (cheap, idempotent) and skips the
  unchanged source by hash.

### 2.10 Provenance, groups and session of ingested facts

- Import mode reads the job through `Store.ImportProvenance(ctx, fileID)` (replaces
  `ImportDocument`): path, rel path, origin, tag, scope, project, session, job groups, `NoChallenge`.
  The server forces these on every item, as P272 forced external/doc/personal.
- Groups per fact: the file's `document` group (key absolute path, title rel path; SPEC (4)), the job's
  `task`/`thread` groups, the automatic `request` group, and `session` when set.
- Session: the requesting Claude session for MCP jobs (argument, else server env); none for UI jobs.
  Why: P272 defines session as the session that added the fact.
- Project for scope `project` without `project`: `DetectProject` of the first path's directory, else
  the server's own project, else invalid. Why: the docs' repo is the project, not the agent's cwd.
- UI jobs default to external/doc/personal until the confirm dialog sets the chosen values at Start.

### 2.11 UI (`packages/workbench/src/memory/import/`)

- `ImportConfirmDialog.vue`: provenance block before the estimate: Origin `SecondaryTabs` (User,
  External; default External); source tag `Input` shown for External (default `doc`, shape-checked);
  scope and project through a new shared `ScopeField.vue` extracted from `AddMemoryDialog.vue`
  (ToggleGroup plus Popover/Command project combobox), used by both. `Checkbox` "Write a kira-memory
  doc beside each file". Start disabled while the tag or project is invalid. Agent origin not offered:
  the UI speaks as the user (P272).
- `ImportView.vue` list and `ImportJobDetail.vue` header: channel `Badge` (Agent for `mcp`, with
  session id in a tooltip), origin and scope badges (reuse `labels.ts` `ORIGIN_LABEL`/`SCOPE_LABEL`).
  Awaiting MCP jobs show the existing Start and Discard plus the reason.
- `ImportFileRow.vue` and the selected-file section: kind label (Parsed for memdoc, JSON), verified
  count, dropped with why, document group id (`font-data`, copy), written doc path or doc error.
- Queries: `useStartImport` mutation (start with args); the generic action mutation keeps pause,
  resume, cancel, discard, dismiss, retry.
- Tailwind utilities, shadcn-vue primitives, `<script setup lang="ts">`, catalog keys under
  `memory.import.*`.
- `data-testid`: `import-origin`, `import-source-tag`, `import-scope`, `import-project`,
  `import-write-doc`, `import-job-channel`, `import-job-origin`, `import-job-scope`,
  `import-file-kind`, `import-file-verified`, `import-file-group`, `import-file-doc`.

### 2.12 Limits and failure modes

| Case | Behaviour |
|---|---|
| Relative, missing or unreadable path | `ingest_files` refuses with the path; nothing created |
| More than 100 paths | refused (existing cap) |
| More than 5 active MCP jobs (scanning, awaiting, running, paused) | refused: "Too many ingest jobs; wait or cancel one in Kira Space" |
| Same roots and provenance as an active job | returns that job's id (idempotent call) |
| Estimate over 300 chunks | MCP job stops at `awaiting`, reason "Needs confirmation in Kira Space: N chunks, about M calls"; the user starts it in the UI. Why: an agent must not spend without consent |
| File over 1 MiB, binary, gitignored, over 2000 files | skipped or truncated with reason (existing scan rules) |
| Invalid JSON or JSON line | file failed with byte or line |
| `memdoc` format problems | file failed, first 5 problems |
| Too many facts for one finalize | file failed "Split the file" (existing) |
| Claude missing, logged out, usage limit | job paused with reason (existing fatal rule) |
| Runner spawn fails | job failed with "Cannot start the import runner: ..." |
| Runner crash | next runner pauses the job as interrupted; status shows it |
| Write-back target is a foreign file | file done, `doc_error` set |

### 2.13 MCP text output

- `ingest_files` text: `job <id> <state>`, then registry text `memory.mcp.ingest.started` ("Ingestion
  runs in the background. Do not read these files. Call ingest_status with this job id for progress.")
  or `memory.mcp.ingest.awaiting` with the reason.
- `ingest_status` text: line 1 `job <id> <state> files <done>/<total> chunks <done>/<total> added N
  updated N noop N dropped N unresolved N failed N skipped N cost <usd>`, `reason: ...` when set; then
  one line per file: `<rel> <state> <kind> group <kg_id> added N updated N noop N verified N dropped N
  unresolved N[ doc <path>][ reason: ...]`. Structured output carries the same plus up to 50 stored
  fact ids per file. Why: one line per entity greps; fact ids let the agent call `memory_context`.

### 2.14 Registry edits (`internal/llmprompts/registry.go` only)

- New tool `memory.mcp.tool.ingest_files` + args `paths`, `origin`, `sourceTag`, `scope`, `project`,
  `groups`, `groups.kind`, `groups.key`, `groups.title`, `writeDoc`, `session`.
- New tool `memory.mcp.tool.ingest_status` + arg `id`.
- New system `memory.import.verify.system` (schema-bound, `VerifyVars`).
- New tool results `memory.mcp.ingest.started`, `memory.mcp.ingest.awaiting`.
- `memory.mcp.instructions`: one paragraph: content files go by path through `ingest_files`, never
  read and pasted; use `ingest_status`; external sources first go to a file.
- `memory.gate.system`: challenge-false rule (§2.7). `memory.import.extract.system`: JSON line (§2.5).
  `memory.import.finalize.system`: step 4 uses the input `provenance` (server enforces), step 5
  challenge-false rule; input gains `provenance` and `challenge`.
- Texts follow `CLAUDE.md` "Communication style". Count +17 (76 → 93 if it holds); implementer
  recounts and updates `llmpromptsflow` `TestList`; `checkprompts` passes.

## 3. Execution

One sequential Sonnet implementer, main checkout. Why: the runner split, migration, verify state,
`ApplyDoc`, import-mode provenance, MCP tools and bridge all touch `engine.go`/`db.go`/`types.go`,
`registry.go` and `en.json` and feed each other in order. The only isolated piece (JSON chunker, about
150 lines) does not repay a stream's worktree and merge cost; no split passes the zero-overlap and
no-ordering rule. Typecheck and lint per commit; no expensive suites until §3.2.

### 3.1 Order and commits

0. Probe (scratchpad, not committed): real `claude -p` (haiku, temp HOME per `docs/DEV_ENVIRONMENT.md`,
   `--max-budget-usd 0.05`) with this plan's verify argv: `--safe-mode --tools Read,Grep --allowedTools
   Read,Grep --max-turns 4 --permission-prompts none --json-schema ...`, cwd a temp dir holding
   `source.md`. Record: the model can Read and Grep `source.md`; a Read of an absolute path outside
   cwd is denied. If `--safe-mode` blocks built-in tools, drop it for tool calls only (as MCP calls do)
   and record why in `claudeArgs`' comment. Append the finding to this plan's result section.
1. `internal/filelock`, `config.AcquireLock` delegate; `0005_p274_ingest.sql`, `migrations/embed.go`;
   `types.go` (job and file fields, kinds, `verifying`), `db.go` reads and writes them; migration test.
   Commit `feat(memory): ingest job model and migration 5`.
2. `runner.go` (lock, recover, 500 ms tick, arm/disarm by DB state, idle exit), `launcher.go` (spawn,
   in-process), `engine.go` as control (`Create(CreateArgs)`, `Start(id, StartArgs)`, ensureRunner,
   scan moved to the runner, auto-start cap, active-job cap, idempotent create, provenance-aware
   `doneHash`), `memorycli.RunIngest`, `wire.go` case `memory-ingest`; `engine_test.go` moves to the
   in-process launcher. Commit `feat(memory): import runner process shared by app and MCP`.
3. `chunk_json.go` + `chunk_json_test.go`, `scan.go` kinds, `chunkFile`. Commit `feat(memory): JSON
   and JSON Lines chunking`.
4. `claude.go` `Call.Tools/Files/MaxTurns` + `claudeArgs`, `verify.go`, `Agent.Verify`, verify state in
   `db.go`/`runner.go`, questionable detection, finalize input applying verdicts, registry verify entry
   and `VerifyVars`, en.json catalog keys. Commit `feat(memory): cross-check questionable facts against
   the source file`.
5. `service.go` `NoChallenge`, `gate.go` challenge flag, `applydoc.go`, `store.go` (`FactID` on add,
   `GroupRef.ID` in `joinGroup`, `ImportProvenance`), `mcpserver` import mode reads job provenance,
   runner memdoc path, registry gate/finalize/extract edits, `service_test.go` ApplyDoc table. Commit
   `feat(memory): parse-only ingest of kira-memory docs and external no-challenge rule`.
6. `importer/writedoc.go` (+ `Store.DocumentFacts`), runner step after done. Commit `feat(memory): write
   ingested files back as kira-memory docs`.
7. `mcpserver` `ingest_files`/`ingest_status` (+ schema enums, text output), `memorycli.Run` builds an
   `importer.Engine` control for the server (spawn launcher, `memoryExecutable` equivalent via
   `os.Executable`), registry tool entries, `server_test.go`. Commit `feat(memory-mcp): ingest by path
   and job status`.
8. Bridge (`memoryimport.go` `Start(MemoryImportStartArgs)`, `Create` sets channel ui; `memory.go`
   watcher 500 ms and event split, engine as control), Wails bindings regen, `@shared/domain/
   memoryImport.ts`, `memoryControl.ts`, `module.ts`, `importQueries.ts`, `ScopeField.vue` extraction,
   dialog, view, detail, row, `labels.ts`, en.json, `ipcChannels.ts`, `mockRuntime.ts`. Commit
   `feat(memory-ui): ingest provenance, agent jobs and written docs`.
9. Flow tests, contracts, UI specs, real `claude` test edits (§6), `llmpromptsflow` count. Commit
   `test(memory): ingest by path flows and UI specs`.

### 3.2 Serial test-and-fix (one Sonnet, after 3.1)

`bun run lint`, `bun run lint:go`, `bun run lint:claude`, `bun run typecheck`, `go test ./... -count=1`,
`bun run test:flows:space`, `bun run test:ui:space`, `bun run test:unit`, `bun run test:visual:space`
(import views change; update baselines when the diff is only the new fields). Then real `claude` (§6).
Fix at cause; commit per group. Check no runner process outlives the suites
(`pgrep -f '^.*memory-ingest$'` empty 35 s after).

### 3.3 Close-out (one Sonnet)

`docs/ARCHITECTURE.md` "Memory MCP server and module": runner process and lock, app quit no longer
pauses, ingest tools, JSON chunking, verify step and isolation flags, external no-challenge rule,
parse-only memdoc and `ApplyDoc`, write-back, limits table, migration 5. `docs/DEV_ENVIRONMENT.md`:
"Memory import" row command gains `TestMemoryIngest`; runner log path. Result section here. SPEC P274
Done. Commit `docs: P274 close-out`.

## 4. File ownership (single implementer)

| Area | Files |
|---|---|
| Lock | `internal/filelock/filelock.go`, `apps/kira-space/internal/config/lock.go` |
| Schema | `internal/memory/migrations/{embed.go,0005_p274_ingest.sql}`, `internal/memory/importer/migrate_test.go` (or `store_test.go`) |
| Importer | `internal/memory/importer/{types,db,engine,runner,launcher,scan,chunk_json,verify,extract,finalize,agent,writedoc,estimate}.go`, `{engine,chunk_json,runner}_test.go` |
| Memory core | `internal/memory/{claude,service,gate,store,applydoc,model}.go`, `internal/memory/service_test.go` |
| MCP | `internal/memory/mcpserver/{server,server_test}.go`, `internal/memory/memorycli/run.go`, `apps/kira-space/internal/appwire/wire.go` |
| Prompts | `internal/llmprompts/registry.go`, `packages/theme/src/i18n/en.json` |
| Bridge, TS | `apps/kira-space/internal/bridge/{memory,memoryimport}.go`, Space Wails bindings, `packages/shared/domain/memoryImport.ts`, `apps/kira-space/frontend/src/bridge/memoryControl.ts`, `packages/workbench/src/memory/{module,labels}.ts`, `packages/workbench/src/memory/import/importQueries.ts` |
| UI | `packages/workbench/src/memory/{ScopeField,AddMemoryDialog}.vue`, `packages/workbench/src/memory/import/{ImportConfirmDialog,ImportView,ImportJobDetail,ImportFileRow,ImportStatus}.vue`, `importFormat.ts` |
| Tests | `apps/kira-space/internal/flows/memoryflow/{ingest_test.go,import_test.go,testdata/*}`, `apps/kira-space/internal/flows/llmpromptsflow/llmprompts_test.go`, `apps/kira-space/tests/contract/memory-import.json`, `apps/kira-space/tests/ui/{memory-ingest,memory-import}.spec.ts`, `apps/kira-space/tests/ui/support/{ipcChannels,mockRuntime}.ts`, `apps/kira-space/tests/claude/{memory_import_test,memory_ingest_test,main_test}.go`, Space visual baselines touching imports |
| Docs | `docs/ARCHITECTURE.md`, `docs/DEV_ENVIRONMENT.md`, this plan, `docs/v2.5/SPEC.md` |

A needed file outside this table: edit it and name it in the commit body.

## 5. Tests

Unit (advanced logic only):

- `chunk_json_test.go` `TestChunkJSON`: table over top-level array and object, nested recursion of an
  over-size element, over-size string split, paths in `HeadingPath`, raw key order and number spelling
  kept, budget packing (no chunk over `Max`), JSON Lines with a blank line, invalid JSON byte and bad
  line number. Why: chunker with several interacting rules.
- `runner_test.go` `TestOneRunnerPerStore`: two runners on one temp home, only one takes the lock; the
  loser exits; after the winner's idle exit a new one takes over and `recoverInterrupted` pauses a
  `running` job. `TestPauseFromControlCancelsInFlight`: in-process runner, fake agent blocking in
  Extract, control in another `Engine` instance sets pause → the call's context cancels within two
  ticks, chunk back to `pending`. Why: concurrency and cross-process ordering.
- Migration test `TestMigration5KeepsImports`: seed a v4 store with a job, two files and chunks, an
  import event; open → rows, chunks and facts JSON intact, backfilled provenance, `PRAGMA
  foreign_key_check` empty, new kinds and `verifying` accepted. Why: rebuild with a cascade hazard.
- `service_test.go` `TestApplyDocDecisions`: one doc over a store with existing lineages: add with the
  doc id, noop on equal text, update on edited reason, update on keyword change, skipped on higher
  stored grade, orphan count; second apply all noop; group created with the doc's `kg_` id. Why:
  decision structure with interacting rules.
- Existing `engine_test.go` moves to the in-process launcher and keeps its cases. No unit tests for
  path validation, caps, questionable detection or text output (single-condition guards).

New-feature split at the IPC boundary (same scenario, same asserted result; contracts in the import
contract file `apps/kira-space/tests/contract/memory-import.json`):

| Scenario | Go flow (`memoryflow/ingest_test.go`) | UI spec |
|---|---|---|
| Agent ingests an external export | `TestMcpIngestExternal`: fakeagent drives `memory-mcp` `ingest_files` with a `slack.json` (two messages) and `notes.md`, origin external, tag slack, scope company, group thread; runner spawns; `ingest_status` until `done` → totals, per-file group ids; `Recent` facts external/slack/company with session; `Context` lists document, thread, session groups; `MemoryImport.Jobs()` lists it with channel `mcp`; contracts `MemoryImportService.Jobs#mcp`, `MemoryImportService.Job#mcp` | `memory-ingest.spec.ts`: imports view shows the job with Agent, External Slack and Company badges; detail lists both files with kind JSON and Markdown, group ids and counts equal to the contract |
| UI import with provenance and write-back | `TestImportProvenanceWritesDoc`: `Create`, `Start` with origin user, scope project `github.com/acme/billing`, writeDoc → `done`; `billing.memory.md` exists, `memfmt.ParseDoc` has no problems, header provenance user/project, its fact ids equal the stored ones; contract `args:MemoryImportService.Start#provenance`, `MemoryImportService.Job#writeDoc` | `memory-import.spec.ts`: confirm dialog: pick User, Project, choose the key, tick write-back, Start → sent args equal the contract; detail shows the doc path |
| Formatted doc ingests by parse | `TestImportFormattedDocParsesOnly`: testdata doc in P273 format → job `done`, `calls` 0, stored ids equal the doc's, group id equals header `group`; edit one reason, ingest again → 1 update, rest noop, same ids; contract `MemoryImportService.Job#memdoc` | `memory-import.spec.ts`: file row shows kind Parsed and the counts of the contract |
| Questionable facts cross-checked | `TestImportVerifiesQuestionableFacts`: extract emits one unresolved fact and one with a quote absent from the text; fake verify (system key "cross-check") answers rewritten and unsupported; the finalize input (fakeagent stdin capture) holds the rewritten fact, not the unsupported one; file `verified` 2, `dropped` lists the unsupported fact; contract `MemoryImportService.Job#verified` | `memory-import.spec.ts`: selected file shows verified 2 and the dropped fact with its why |

Backend-only (no new UI state; P272 grade-guard precedent):

- `TestExternalIngestNeverChallenges`: gate fake challenges one of two items under `challenge: false`;
  the other stores; the file lists the challenged one under dropped, none unresolved.
- `TestIngestAwaitsOverChunkCap`: a large fixture over the cap stays `awaiting` with the reason;
  `Start` from the bridge runs it.
- `TestIngestIdempotentCall`: same `ingest_files` call twice returns one job id.
- `TestRunnerOutlivesApp`: start a held job from the bridge, `CloseMemory`, release the hold → job
  reaches `done` (runner is its own process).
- Existing `import_test.go` flows move to the runner (Start args, events) and keep their cases.

## 6. Real `claude` rows (opt-in, after 3.2)

Changes touch `internal/llmprompts/**`, the memory gate, importer, MCP server and memorycli, so run the
prompt registry row plus the new test:
`bun run test:claude:space -run 'TestMemoryGate|TestMemoryMcpThroughClaude|TestMemoryInstallRegisters|TestMemoryImport|TestMemoryIngest|TestAdeHeadlessRun|TestAdeStepResults|TestAdeStageSession|TestAdeRebaseRun|TestSmartScriptRun'`
and `bun run test:claude:studio`.

Test edits:

- `TestMemoryImport`: fixture gains one ambiguous sentence so a verify call runs for real (Read/Grep
  on the copy); assert the file reaches `done`, `verified` ≥ 1, facts carry the job provenance.
- New `TestMemoryIngestThroughClaude` (`memory_ingest_test.go`): claude, with only `kira-memory`,
  is told to ingest a temp repo's `docs/` folder and a small `slack.json` (origin external, tag
  slack, scope project) and to poll `ingest_status` until done; assert the job is `mcp`, done, facts
  external/slack/project with the temp repo's key, and claude's transcript never called Read on the
  files. The test binary must handle the `memory-ingest` argument the same way it handles
  `KIRA_TEST_MEMORY_MCP` for `memory-mcp`.
- Report spend per run (import and ingest are their own lines).

## 7. Verification (orchestrator, real checks)

1. `rg -n 'ingest_files|ingest_status' internal/memory/mcpserver internal/llmprompts/registry.go` shows
   tools, schema and registry entries.
2. `rg -n 'ChunkJSON' internal/memory/importer --glob '!*_test.go'` shows the caller in `chunkFile`.
3. `rg -n 'memfmt\.ParseDoc|ApplyDoc|memfmt\.FormatDoc' internal/memory --glob '!*_test.go'` shows
   runner (parse), service (`ApplyDoc`) and `writedoc.go` (format) callers.
4. `rg -n '"memory-ingest"' apps/kira-space/internal/appwire/wire.go`; `rg -n 'RunIngest' apps internal`.
5. `rg -n 'syscall.Flock' internal apps` → only `internal/filelock`.
6. `rg -n 'NoChallenge' internal/memory` → `service.go` and `mcpserver/server.go`.
7. `rg -n 'Tools:' internal/memory/importer/verify.go` shows `Read`, `Grep`; `claudeArgs` emits
   `--max-turns` only when set.
8. Migrate a copy of a v4 fixture with import rows (`sqlite3`): chunk count unchanged,
   `PRAGMA foreign_key_check` empty.
9. UI libraries: `ScopeField.vue` used by `AddMemoryDialog.vue` and `ImportConfirmDialog.vue`;
   `useStartImport` in `importQueries.ts` uses TanStack; no `<style` in `packages/workbench/src/memory/`.
10. Registry count equals `TestList`; `go run ./internal/llmprompts/cmd/checkprompts` passes.
11. By hand once: app closed, real `claude` with `kira-memory` calls `ingest_files` → a
    `memory-ingest` process appears, job completes, the process exits about 30 s later.
12. Suites in §3.2 green; real `claude` rows run and reported.
13. This planner's and every discovery subagent's tool logs show real `codegraph_explore` calls.

## 8. Decisions log (final)

- MCP `ingest_files` plus `ingest_status`, paths only: SPEC (1); content costs no tokens.
- No user-facing CLI: SPEC names MCP and UI; scope left out stays out.
- One runner per store, always a detached `memory-ingest` process under a flock: jobs outlive sessions
  and the app; two schedulers would corrupt in-flight rows.
- Control and runner talk through the DB, polled every 500 ms: no IPC exists between processes.
- Runner exits after 30 s idle or when its home disappears: no daemon, clean test homes.
- Crash still pauses running jobs; scans resume: no unconsented spend, scans cost nothing.
- App quit no longer pauses imports: one host for every job.
- `internal/filelock` shared with `config.AcquireLock`: one flock definition.
- Migration rebuilds via TEMP copies: avoids the DROP TABLE cascade into chunk rows.
- Done-hash skip scoped by provenance: another scope is another store.
- JSON chunker in-house over `encoding/json` raw elements, JSON Lines per line: boundary packing with
  paths has no library; parsing is stdlib.
- Invalid JSON fails the file: a silent fallback hides broken exports.
- File cap 1 MiB: exports exceed 256 KiB; the chunk cap bounds spend.
- Questionable = model's `unresolved` or evidence not in the chunk: model doubt plus invented quotes.
- Verify in an empty temp dir with a copy of the source, Read and Grep only, turn and cost caps: file
  access without the rest of the disk.
- Existing facts cross-checked by the store's own gate and reconcile: one reconcile path.
- External ingest never challenges; challenged items drop with why: nobody can answer an export; live
  `store_memory` keeps challenges.
- Memdoc by parse only, header provenance wins, ids from the doc, grade guard applies: SPEC (5),
  provenance travels with the doc.
- Doc group keyed by its `kg_` id: stable across clones and moves.
- Facts missing from a re-ingested doc stay and are counted: memory has no delete.
- Write-back opt-in, beside the source as `<stem>.memory.md`, never replacing it: the format would
  delete prose.
- Write-back holds only facts with the job's provenance: one provenance per doc.
- Facts carry the requesting session for MCP jobs: P272's session meaning.
- Project from the first path's repo: the docs' repo is the project.
- MCP jobs over 300 chunks wait for the user; at most 5 active MCP jobs; repeated call returns the
  same job: no unbounded agent spend.
- Status as one line per job and per file plus fact ids in structured output: grep-friendly, enough
  for `memory_context`.
- Shared `ScopeField.vue` for add and import dialogs: no duplicate scope picker.
- One sequential implementer: shared files and an ordered chain; the JSON chunker alone does not repay
  a stream.

## Result

### Commit 0 probe (2026-10-13)

Real `claude` 2.1.296, haiku, temp `HOME`, cwd a temp dir holding `source.md`, no credential read by the probe:

- `--safe-mode --tools Read,Grep --allowedTools Read,Grep --max-turns 6 --permission-prompts none`: Grep and Read of
  `source.md` work. A Read of an absolute path outside cwd is **not** denied: it returned the file's content.
  The plan's argv does not isolate.
- Adding `--restricted` (confines file tools to the working directories; also drops code-running tools): Grep of
  `source.md` works, the outside Read lands in `permission_denials`, the call reports DENIED.
- `--restricted` with `--safe-mode` and `--permission-mode dontAsk`: same denial.
- Decision: verify argv is `--restricted --tools Read,Grep --allowedTools Read,Grep --max-turns N
  --permission-prompts none` (`--safe-mode` kept off for the tool call, as MCP calls do). `claudeArgs` comment
  records why. Cost per probe call under 0.002 USD.
- Variadic flags (`--tools`, `--allowedTools`) swallow a trailing prompt argument; the call sends the prompt on
  stdin, as `memory.Call` already does.
