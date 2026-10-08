# P211 plan: memory bulk import

Source: `SPEC.md` row P211 and its Requirements line; user's ask (condensed): pick a file or folder,
import starts; each file chunked to a Sonnet-friendly size; step 1 extracts atomic facts per chunk,
one clean-context agent per chunk; step 2, once every chunk of a file is done, one agent holding all
of that file's facts adds memories through the kira-memory MCP (gate, reconcile, hybrid search from
P201/P210); progress and failures visible.

Base: `v2.1-stream-F` head `03c9f30cf` (origin/v2.0 + P210). Worktree `/home/user/kira-v21-F`.
One sequential implementer: every step below builds on the previous one (migration, then MCP import
mode, then runner, then importer, then bridge, then UI). No stream split.

Discovery used `codegraph_explore` on: `memory.Service.Store`, `StoreRequest`, `validateRequest`,
`gate.go` (`runGate`, `gatePrompt`, `dataHygiene`), `reconcile.go`, `claude.go` (`CLIRunner`,
`claudeArgs`, `parseClaudeResult`, `classifyFailure`), `store.go` (`conn`, `commitFact`,
`commitInput`, `Lineage`), `model.go`, `mcpserver.Build`/`storeMemory`, `memorycli.Run`,
`runArgvShim`, `bridge/memory.go` (`MemoryService`, `service`, `CloseMemory`), `bridge/files.go`,
`shell/dialogs.go`, `appshell/dialogs.go`, `adeagent.Spec`/`Script` (the existing `--mcp-config`
precedent), `packages/workbench/src/memory/*` (`MemoryPanel`, `MemoryStart`, `AddMemoryDialog`,
`SemanticStatus`, `queries.ts`, `store.ts`, `module.ts`), `memoryControl.ts`, `memoryModule.ts`.
Then direct reads of migrations, `sqlitex.BuildDSN`, `toolexec.RunIO`, `ARCHITECTURE.md` Memory
section, `DEV_ENVIRONMENT.md` Memory section, `NOTICES.md`, `go.mod`.

Rules: `CLAUDE.md` in full (terse; shadcn-vue, Tailwind, VueUse, Pinia, TanStack Query;
`<script setup lang="ts">`; one Pinia store one concern; Conventional Commits; never
`--no-verify`; fix any red hook on the spot). Stage only P211 files; never `git add -A`, never
`git stash`. Record measurements and deviations in `docs/v2.2/plans/P211-notes.md`, committed as
they happen (resumability), folded into `SPEC.md` in the last commit.

## 1. Spike result (run while planning, CLI 2.1.293)

A throwaway stdio MCP server (one tool) was driven by `claude -p` with this plan's step-2 flags:

| Flags | Tool called | Structured output |
|---|---|---|
| `--safe-mode --setting-sources "" --strict-mcp-config --mcp-config <json> --tools "" --allowedTools mcp__spike__secret_word --permission-prompts none --json-schema …` | no | `{"word":""}` |
| same without `--safe-mode` | yes | `{"word":"PINEAPPLE42"}`, `num_turns` 3, `total_cost_usd` 0.007 |

Facts used below: `--safe-mode` disables `--mcp-config` servers too, so the step-2 agent cannot use
it. `--json-schema` works together with MCP tool use. The JSON result carries `total_cost_usd` and
`num_turns`. `--mcp-config` accepts an inline JSON string.

## 2. Decisions

**D1 File types: Markdown (`.md`, `.markdown`, `.mdx`) and plain text (`.txt`, `.text`, `.rst`,
`.adoc`).** The ask is "docs". `.rst`/`.adoc` read fine as plain text and split on blank lines.
Excluded: source code (an agent reads code directly; facts extracted from code go stale with every
commit, which a memory store with no delete cannot follow); PDF (the only fully open-source pure-Go
text extractors, `ledongthuc/pdf` and `pdfcpu`, lose reading order on multi-column and tagged
layouts; UniPDF is AGPL/commercial: declined); Office formats. Both listed in Deferred decisions.

**D2 Folder walk.** `filepath.WalkDir` from each picked root.
- Symlinks (file or dir) are never followed: cycle risk, and a link can leave the picked tree.
  A symlink with a supported extension is listed as skipped "symlink".
- Directories skipped by name: any starting with `.` (covers `.git`, `.venv`), `node_modules`,
  `vendor`, `dist`, `build`, `out`, `target`, `__pycache__`, `venv`. Hidden files skipped.
- `.gitignore` honoured (every level, nested files too), via
  `github.com/go-git/go-git/v5/plumbing/format/gitignore` (Apache-2.0, maintained, the matcher
  `go-git` itself uses). Requirement it meets: git's full pattern semantics (negation, anchoring,
  `**`, directory-only) across nested files, which a name list cannot express. Global
  `core.excludesFile` is not read. Declined: `sabhiram/go-gitignore` (unmaintained since 2021);
  shelling out to `git ls-files` (needs git and a repo; a docs folder is often neither).
- Per-file cap 256 KiB (D-cap below), checked by `Lstat` size before reading. Empty files skipped.
- Binary: a NUL byte in the first 8000 bytes (git's own heuristic). Not UTF-8 (`utf8.Valid`):
  skipped "not UTF-8 text". UTF-8 BOM stripped; CRLF and CR normalised to LF before hashing.
- Job cap 2000 importable files; the scan stops there and the job says "scan stopped at 2000 files".
- Unsupported extensions and contents of skipped dirs are counted (`ignored_count`), not listed.
  Every other skip is a file row with a reason: `too large (limit 256 KB)`, `binary`,
  `not UTF-8 text`, `empty`, `symlink`, `unchanged since import on <date>`, `same content as <rel>`.

**D3 Chunking.**
- Budget: target 3000 tokens, hard max 4000, minimum fill 1500 before a heading may start a new
  chunk, trailing chunk under 750 merges back when the sum stays under max. Reasons: extraction of
  atomic facts is dense work; recall per call drops as input grows (lost-in-the-middle), while a
  call has fixed cost (CLI spawn, system prompt, about 5 to 10 s). 3000 tokens is roughly 4 to 5
  pages, yields about 10 to 30 facts, about 1 to 3k output tokens, inside the existing 0.50 USD per
  call cap and well under Sonnet's context. Constants live in one place (`chunk.go`); the
  implementer records fact yield per chunk from the smoke run in the notes.
- Token estimate: `ceil(runes / 3)`. Claude's tokenizer is not published; any BPE library
  (`tiktoken-go`) is another model's vocabulary, so still an estimate. English averages near 4
  characters per token, so dividing by 3 over-counts and chunks land under budget, never over.
  Declined `tiktoken-go` on that requirement.
- Markdown structure: `github.com/yuin/goldmark` (MIT, pure Go, CommonMark) parses the document. The
  chunker uses its AST only for (a) headings, ATX and setext, with level and text (b) ranges that
  must not split: fenced and indented code blocks, HTML blocks (each widened to whole lines,
  including fence lines). Split candidates: the line start of every heading, and every blank line
  outside a forbidden range. Requirement no splitter library meets: heading-path breadcrumbs plus
  packing by our own token estimate (langchaingo's splitters carry no heading path and pull a large
  module).
- Plain text: split candidates are blank lines. No headings.
- Units: text between consecutive split candidates. A unit over max splits at line ends, then a line
  over max at sentence ends (`. `, `! `, `? ` followed by a space or end), then a hard rune cut.
- Packing: greedy in document order. At a heading of level ≤ 2 (any level for text with no
  level ≤ 2 headings) start a new chunk when the current one has reached minimum fill. Never exceed
  max.
- Each chunk carries `HeadingPath` (ancestor headings at its first byte, joined with ` > `) and
  `Context`: the last ≤ 200 tokens of the previous chunk, cut at a line start. Step 1 is told the
  context is for reading only, never for extraction, so overlap adds understanding without
  duplicate facts. Step 2 dedupes anyway.
- Title: first level-1 heading text, else the file name without extension.

**D4 Agents.** Both steps reuse `memory.CLIRunner` (`claude -p`, Sonnet, isolated, scrubbed env,
empty temp cwd, stdin input, `--json-schema`).
- Step 1 (`extract`): one call per chunk, today's isolation flags unchanged (`--safe-mode`,
  `--tools ""`, no MCP). Timeout 180 s, budget 0.50 USD.
- Step 2 (`finalize`): one call per file with `--mcp-config` (inline JSON) naming one stdio server
  `kira-memory` = `<Kira Space executable> memory-mcp --import-ref <fileID>`, env
  `KIRA_MEMORY_HOME=<memory.Home()>`; `--strict-mcp-config` (the user's own user-scope kira-memory
  registration must not load); `--tools ""`; `--allowedTools mcp__kira-memory__store_memory
  mcp__kira-memory__search_memories mcp__kira-memory__memory_history`; `--permission-prompts none`
  (anything else is denied); `--setting-sources ""`; `--disable-slash-commands`. No `--safe-mode`
  (spike §1). Timeout `5 min + 45 s × ceil(facts/20)`, cap 45 min. Budget
  `min(5.00, 1.00 + 0.15 × ceil(facts/20))` USD. These caps cover the outer agent only; each
  `store_memory` call inside `memory-mcp` spends through its own gate/reconcile calls (0.50 cap each).
- Import mode of `memory-mcp` (`--import-ref <uuid>`): `store_memory` ignores the agent's `author`
  and writes `author = agent`, `source = import`, `source_ref = <fileID>`. The agent cannot change
  attribution. The gate, reconcile, hash short-circuit and hybrid candidates run unchanged.
- Concurrency: up to 3 extract calls at once across the whole app, 1 finalize at a time. Finalize
  is serial so reconcile of one file sees the previous file's commits and stale-revision retries
  stay rare.
- Rate limits and transient failures: `github.com/cenkalti/backoff/v4` (MIT, already in `go.sum`
  as indirect, promote to direct). Exponential, initial 10 s, multiplier 2, max interval 2 min,
  randomisation 0.5, at most 3 retries per item, ctx-aware. A rate-limit error also sets a shared
  cooldown (`notBefore`) that every worker waits out before its next call, so 3 workers do not
  hammer a limited account. Retry classes: `ErrClaudeRateLimited`, `ErrClaudeTimeout`,
  `ErrClaudeOutput`, generic `Claude Code failed`. Fatal classes pause the whole job with the
  message: `ErrClaudeNotFound`, `ErrClaudeAuth`, `ErrClaudeOutdated`, `ErrClaudeUsageLimit`.
  `ErrClaudeBudget` fails the item, no retry.
- New error mapping in `classifyFailure`: `rate limit`, `429`, `overloaded`, `529` →
  `ErrClaudeRateLimited`; `usage limit`, `limit reached` → `ErrClaudeUsageLimit` ("Claude usage
  limit reached. Resume the import when it resets."). Order: outdated, auth, usage, rate, generic.
- Cancellation: per-job context. Pause and Cancel cancel it; `toolexec.RunIO` already kills the
  process group with a grace period, `memory-mcp` gets SIGTERM, cancels its in-flight store, and
  exits on stdin EOF.

**D5 Persistence in `memory.db` (migration 3).** The importer is part of the memory subsystem and
step 2's provenance (`memory_events.source_ref`) points at its rows; one file, one migration
sequence. Schema §4.1. Resumable from disk: every state change is one short write; chunk facts land
in the same write that marks the chunk done. Re-import idempotency: a file whose content hash
matches a `done` file of any job is skipped "unchanged"; a hash seen twice in one job is skipped
"same content as …". Memory-level dedup is the existing hash short-circuit and reconcile.

**D6 State machines.**
- Job: `scanning → awaiting → running ⇄ paused → done`; `awaiting → (discard: rows deleted)`;
  `running|paused → cancelled`; `scanning → failed` (scan error). `done` means every file is
  terminal (`done|failed|skipped|cancelled`); `RetryFailed` moves `done` back to `running`.
- File: `pending → extracting → extracted → finalizing → done`; `pending → skipped` (at
  materialise); `extracting → failed` (a chunk out of retries); `finalizing → failed` (finalize out
  of retries); `finalizing → extracted` (pause, quit); any non-terminal `→ cancelled`; `failed →
  extracting` (RetryFile: failed chunks back to `pending`, attempts reset) or `failed → extracted`
  (finalize had failed).
- Chunk: `pending → running → done | failed`; `running → pending` on pause/quit without counting
  an attempt.
- Startup recovery (`importer.Open`): chunks `running → pending`; files `finalizing → extracted`;
  jobs `running → paused` with reason "Interrupted: Kira Space closed during the import. Resume to
  continue."; jobs `scanning → failed` with "Scan interrupted. Import again.". No auto-resume
  (Deferred decision). Re-running finalize after a partial run is safe: already stored facts come
  back as `noop` (hash short-circuit) or reconcile `noop`/`update`.
- Chunks are materialised per file when extraction of that file begins (read, re-validate, hash,
  chunk, insert). A file changed since the scan is re-hashed and re-chunked then; the unchanged
  check reruns against the new hash. Extraction is file-ordered (`rel_path`), so at most 3 files
  hold chunk rows at once. A file's chunk rows are deleted when it reaches `done` or `cancelled`
  (counts and unresolved/dropped lists stay on the file row).

**D7 Step-2 counts come from the database, not the agent.** After finalize returns, the importer
counts `memory_events WHERE source = 'import' AND source_ref = fileID GROUP BY action` into
`added`/`updated`/`noop`. Only what the agent alone knows comes from its structured output:
`unresolved` (facts it gave up on after a challenge, with the gate's questions) and `dropped`
(facts it removed, with why).

**D8 Cost and time shown before start, actual cost after.** The confirm dialog shows files to
import, skipped (by reason), unchanged, chunks, estimated source tokens, estimated Claude calls and
a rough duration. No dollar estimate: per-token prices change, and a subscription login is not
billed per token. During and after the run: calls made and the API-equivalent cost Claude Code
reports (`total_cost_usd`) for extract and finalize agents, labelled "excludes memory gate checks".
Estimate constants (`estimate.go`): 12 facts per chunk, 30 s per extract call, finalize
`20 s + 25 s × ceil(facts/20)`; calls = chunks + files + 2 × ceil(facts/20) per file. The
implementer replaces these with smoke-run measurements (notes).

**D9 Step-2 input cap.** Before finalize, if the facts JSON estimate exceeds 80k tokens the file
fails with "Too many facts (N) for one pass. Split the file." With the 256 KiB cap this needs over
about 3 facts per 100 source tokens; recorded so it never silently truncates.

**D10 Security.** Imported documents are untrusted. Step 1 has no tools. Step 2 has only the three
memory tools; the worst an injected document can do is store false memories, every one of them
attributed `agent` via `import` with the file path in its history. Both prompts include
`dataHygiene`. Secrets: step 1 omits them, the gate challenges them, step 2 drops challenged facts.
ARCHITECTURE gets this paragraph (§13).

## 3. Flow

1. UI: Import button menu, Import files… (multi-select, filter) or Import folder….
2. `MemoryImportService.Create({paths})` inserts a `scanning` job and scans in a goroutine; the job
   moves to `awaiting` with estimates; `kira:memory:import` fires.
3. UI opens the confirm dialog for that job. Start, or Discard.
4. Engine: extract workers pull `pending` chunks (materialising the next file when needed);
   finalize worker pulls `extracted` files; each result is written, an event fires.
5. Job reaches `done`; summary in the job view; memories appear through the existing
   `kira:memory:changed` watcher (the `memory-mcp` child writes through another connection).

## 4. Storage (`internal/memory`)

### 4.1 `migrations/0003_import.sql` (register Version 3, name `import`)

- Rebuild `memory_events` (SQLite cannot alter a CHECK): create `memory_events_v3` with the same
  columns, `source CHECK (source IN ('mcp', 'ui', 'import'))`, new `source_ref TEXT`, table CHECK
  `((source = 'import') = (source_ref IS NOT NULL))`; `INSERT … SELECT` every old row; `DROP`;
  `ALTER TABLE … RENAME TO memory_events`; recreate `memory_events_lineage`, `_memory`, `_previous`;
  add `memory_events_source_ref ON memory_events(source_ref) WHERE source_ref IS NOT NULL`. No
  table references `memory_events`, so the drop is safe with `_foreign_keys=1`.
- `import_jobs(id TEXT PK, roots TEXT NOT NULL /* JSON array */, base TEXT NOT NULL, state TEXT
  NOT NULL CHECK (state IN ('scanning','awaiting','running','paused','done','cancelled','failed')),
  reason TEXT NOT NULL DEFAULT '', truncated INTEGER NOT NULL DEFAULT 0, ignored_count INTEGER NOT
  NULL DEFAULT 0, est_tokens INTEGER NOT NULL DEFAULT 0, est_chunks INTEGER NOT NULL DEFAULT 0,
  calls INTEGER NOT NULL DEFAULT 0, cost_usd REAL NOT NULL DEFAULT 0, created_at TEXT NOT NULL,
  started_at TEXT, finished_at TEXT, dismissed_at TEXT)`.
- `import_files(id TEXT PK, job_id TEXT NOT NULL REFERENCES import_jobs(id) ON DELETE CASCADE,
  path TEXT NOT NULL, rel_path TEXT NOT NULL, kind TEXT NOT NULL CHECK (kind IN
  ('markdown','text')), size INTEGER NOT NULL, content_hash TEXT NOT NULL DEFAULT '', state TEXT
  NOT NULL CHECK (state IN ('pending','skipped','extracting','extracted','finalizing','done',
  'failed','cancelled')), reason TEXT NOT NULL DEFAULT '', title TEXT NOT NULL DEFAULT '',
  chunk_count INTEGER NOT NULL DEFAULT 0, est_tokens INTEGER NOT NULL DEFAULT 0, fact_count
  INTEGER NOT NULL DEFAULT 0, finalize_attempts INTEGER NOT NULL DEFAULT 0, added INTEGER NOT NULL
  DEFAULT 0, updated INTEGER NOT NULL DEFAULT 0, noop INTEGER NOT NULL DEFAULT 0, unresolved TEXT
  NOT NULL DEFAULT '[]', dropped TEXT NOT NULL DEFAULT '[]', cost_usd REAL NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL, UNIQUE (job_id, rel_path))`; indexes `(job_id, state)` and
  `(content_hash) WHERE state = 'done'`.
- `import_chunks(file_id TEXT NOT NULL REFERENCES import_files(id) ON DELETE CASCADE, idx INTEGER
  NOT NULL, heading_path TEXT NOT NULL DEFAULT '', context TEXT NOT NULL DEFAULT '', text TEXT NOT
  NULL, tokens INTEGER NOT NULL, state TEXT NOT NULL CHECK (state IN ('pending','running','done',
  'failed')), attempts INTEGER NOT NULL DEFAULT 0, error TEXT NOT NULL DEFAULT '', facts TEXT NOT
  NULL DEFAULT '[]', cost_usd REAL NOT NULL DEFAULT 0, PRIMARY KEY (file_id, idx))`.

### 4.2 Go changes

- `model.go`: `SourceImport = "import"`; `Event.SourceRef *string` (`json:"sourceRef"`),
  `Event.SourceLabel string` (`json:"sourceLabel,omitempty"`, the file's `rel_path`).
- `service.go`: `StoreRequest.SourceRef string`; `validateRequest` accepts `SourceImport` only with
  a non-empty `SourceRef` (≤ 64 runes), rejects `SourceRef` for other sources; `commit` passes it.
- `store.go`: `commitInput.SourceRef`; the `memory_events` insert writes it (NULL when empty);
  `Lineage` selects `e.source_ref` and `COALESCE(f.rel_path, '')` via `LEFT JOIN import_files f ON
  e.source = 'import' AND f.id = e.source_ref`. New exported `func (s *Store) DB() (*sql.DB,
  error)` (wraps `conn`) for the importer subpackage, doc: "for internal/memory subpackages sharing
  memory.db".

## 5. MCP import mode (`internal/memory/mcpserver`, `memorycli`)

- `mcpserver.Build(svc *memory.Service, opts Options)`; `type Options struct{ ImportRef string }`.
  `RunStdio(ctx, svc, opts)`. In import mode `storeMemory` builds `StoreRequest{Author:
  memory.AuthorAgent, Source: memory.SourceImport, SourceRef: opts.ImportRef}` whatever `in.Author`
  says. Update `server_test.go` callers; extend `TestStoreSearchHistoryOverMCP` with one import-mode
  store asserting the event has `source = import`, the ref, and `author = agent` despite
  `author: "user"` in the call (the attribution guarantee, D4).
- `memorycli.Run(args)`: `flag.NewFlagSet("memory-mcp", ContinueOnError)` with `--import-ref`;
  `uuid.Parse` it when set; bad flag or ref → message on stderr, exit 2.

## 6. Runner (`internal/memory/claude.go`)

- `Call` gains `MCPConfig string`, `AllowedTools []string`, `Timeout time.Duration` (0 = 120 s),
  `Budget string` (empty = `"0.50"`).
- `claudeArgs`: when `MCPConfig != ""`, omit `--safe-mode` and add `--mcp-config <json>
  --allowedTools <each>` (comment: safe mode disables `--mcp-config` servers, spike in P211). All
  other flags unchanged.
- `type Result struct{ Output json.RawMessage; CostUSD float64; Turns int }`;
  `func (r *CLIRunner) RunResult(ctx, Call) (Result, error)`; `Run` becomes a wrapper returning
  `.Output` (the `Runner` interface and its fakes stay unchanged). `claudeResult` parses
  `total_cost_usd`, `num_turns`.
- `ErrClaudeRateLimited`, `ErrClaudeUsageLimit` plus `classifyFailure` rows (D4); extend the
  existing `TestCLIRunnerErrorMapping` table with those rows only.

## 7. Importer package `internal/memory/importer` (new)

Imports `memory`, `memory/migrations` (indirectly via Store), goldmark, go-git gitignore, backoff,
`golang.org/x/sync/semaphore`. No Wails, no app packages.

- `scan.go`: `Scan(ctx, roots []string, caps Caps) (ScanResult, error)`; `Caps{MaxFileBytes
  256<<10, MaxFiles 2000}`; `ScanResult{Base string; Files []Candidate; Skipped []Skip; Ignored
  int; Truncated bool}`; `Candidate{Path, Rel, Kind, Size}`. Base = the folder, or the common
  parent of picked files. Gitignore: `gitignore.ReadPatterns` over an `osfs` rooted at each root
  (or the folder walk's own per-dir read, whichever the package API supports without global
  config), `gitignore.NewMatcher`.
- `textfile.go`: `ReadText(path string, max int64) (text string, hash string, skipReason string,
  err error)`: size check, read, NUL sniff, `utf8.Valid`, BOM strip, newline normalise, SHA-256 hex.
- `tokens.go`: `EstimateTokens(s string) int`.
- `chunk.go`: `type Chunk struct{ Index int; HeadingPath, Context, Text string; Tokens int }`;
  `ChunkMarkdown(src string, b Budget) ([]Chunk, string /*title*/)`; `ChunkText(src string, b
  Budget) []Chunk`; `Budget{Target 3000, Max 4000, MinFill 1500, MinTail 750, Context 200}` as
  `DefaultBudget`.
- `db.go`: all SQL for jobs/files/chunks; one function per transition (`insertJob`, `setJobState`,
  `insertFiles`, `materialise`, `claimChunk`, `finishChunk`, `failChunk`, `releaseChunk`,
  `claimFinalize`, `finishFile`, `failFile`, `recoverInterrupted`, `cancelJob`, `retryFile`,
  `retryFailed`, `doneHashExists`, `countOutcomes`, `listJobs`, `jobDetail`). Each a single
  `BEGIN IMMEDIATE` transaction.
- `engine.go`: `type Engine`; `Open(store *memory.Store, opts Options) (*Engine, error)` runs
  `recoverInterrupted`; `Options{Agent Agent; Extractors int /*3*/; Backoff func()
  backoff.BackOff; OnChange func(); Now func() time.Time}`. Methods: `Create(ctx, paths)`,
  `Start`, `Pause`, `Resume`, `Cancel`, `Discard`, `Dismiss`, `RetryFailed` (job id), `RetryFile`
  (file id), `Jobs`, `Job`, `Close`. One scheduler goroutine; `wake` channel; extract slots via
  `semaphore.Weighted(Extractors)`, one finalize slot; per-job `context.CancelFunc` map; shared
  rate-limit cooldown (`notBefore` under a mutex). Errors: `ErrNotFound`, `ErrInvalidState`
  (`memory.ErrInvalid`-wrapped messages safe to show). `Close` cancels everything, waits, and
  leaves rows as Open's recovery expects (pause reason "Kira Space closed").
- `agent.go`: `type Agent interface{ Available() error; Extract(ctx, ExtractInput) (ExtractOutput,
  error); Finalize(ctx, FinalizeInput) (FinalizeOutput, error) }`. `ClaudeAgent{Runner
  *memory.CLIRunner; Executable string; Home string}`.
- `extract.go`: `extractPrompt`, `extractSchema`. Input `{"document":{"path","title"},
  "chunk":{"index","count","headingPath"},"context","text"}`. Output `{"facts":[{"fact",
  "evidence","section","unresolved"}]}`. Prompt rules: `dataHygiene`; atomic, one claim each;
  standalone only where the text itself makes it certain, otherwise keep wording and put what is
  missing in `unresolved` ("which service 'it' is"); durable knowledge only (decisions,
  conventions, configuration, names, ownership, relationships, constraints, reasons); skip
  navigation, tables of contents, boilerplate, examples copied verbatim, time-bound chatter;
  never extract from `context`; never invent; omit secrets; `evidence` a quote of at most 200
  characters; at most 40 facts. Go validates: trim, drop empty, drop facts over
  `memory.MaxFactLen`, truncate evidence, cap 40.
- `finalize.go`: `finalizePrompt`, `finalizeSchema`, `mcpConfig(exe, home, fileID string) string`.
  Input `{"document":{"path","title","chunks"},"facts":[{"id":"<chunk>.<n>","chunk","section",
  "fact","evidence","unresolved"}]}`. Output `{"unresolved":[{"fact","questions":[…]}],
  "dropped":[{"fact","why"}]}`. Prompt rules: `dataHygiene`; the facts come from one document,
  split into chunks, so merge duplicates and overlap; resolve `unresolved` references from other
  facts of the document; drop a fact still ambiguous (report in `unresolved` with the open
  question) or not durable (report in `dropped`); write each reason as "Stated in <path>, <section>:
  "<evidence>"" (≤ 2000 characters); call `store_memory` with at most 20 items per call; on a
  challenge answer the questions as `clarifications` only from the document's facts, never from
  assumption; when the document cannot answer, leave the fact out and list it in `unresolved` with
  the gate's questions; `search_memories` is optional context, `store_memory` already reconciles;
  stop when every fact is stored, unresolved or dropped.
- `estimate.go`: `Estimate(files) Estimate{Files, Chunks, Tokens, Calls, Seconds}` (D8).

Engine loop details:
- Extract item: wait cooldown; `Agent.Extract` under `backoff.RetryNotify` (`WithMaxRetries(…, 3)`,
  `WithContext`); classify with `errors.Is`; fatal → `pauseJob(reason)`; budget →
  `failChunk`; out of retries → `failChunk` and file `failed` with "Chunk i of n: <err>"; ctx
  cancelled → `releaseChunk`. Success → `finishChunk(facts, cost)`; when the file's last chunk
  finishes, file `extracted`.
- Finalize item: `claimFinalize` (file `finalizing`, `finalize_attempts++`); D9 check; `Agent.
  Finalize`; same retry/classify; success → `countOutcomes`, `finishFile` (counts, lists, cost,
  delete chunks); ctx cancelled → back to `extracted`.
- Job `done` check after each terminal file transition; `finished_at` set; event fires.
- Start/Resume first call `Agent.Available()` (locates `claude`) and refuse with its message.

## 8. Kira Space Go

- `internal/shell/wails.go`: `func (d *Dialogs) OpenMultipleFiles(title, filterName, filterPattern
  string) ([]string, error)` using `OpenFile().AttachToWindow(...).CanChooseFiles(true).SetTitle(…)
  .AddFilter(…).PromptForMultipleSelection()` (Wails v3 beta.21 API; confirm in the module source).
- `apps/kira-space/internal/bridge/files.go`: `Dialogs` gains `OpenFiles(req OpenFilesRequest)
  ([]string, error)`; `OpenFilesRequest{Title, FilterName, FilterPattern}`.
  `appshell/dialogs.go` implements it. Update any Space test fake of `Dialogs`.
- `bridge/memory.go`: `MemoryService` gains unexported `importer() (*importer.Engine, error)`, lazy
  like `service()`, with `importer.ClaudeAgent{Runner: memory.NewCLIRunner(), Executable:
  memoryExecutable(), Home: memory.Home()}` and `OnChange: s.emitImport`. `CloseMemory` closes the
  engine first. Replace `emitSemantic`'s hand coalescing with a small `coalescer` type in
  `bridge/coalesce.go` used by both channels (250 ms), so the pattern is not copied.
- `bridge/memoryimport.go` (new bound service): `type MemoryImportService struct{ mem
  *MemoryService; dialogs Dialogs }`. Methods: `Choose({kind: "files"|"folder"})
  (MemoryImportChoice{Canceled bool; Paths []string})`, `Create({paths})`, `Jobs()`,
  `Job({id})`, `Start/Pause/Resume/Cancel/Discard/Dismiss/RetryFailed({id})`,
  `RetryFile({fileId})`. Validation: 1 to 100 paths, absolute, exist → `ipcerr.BadRequest`.
  Errors through the existing `memoryErr` plus importer's not-found/invalid-state mapping.
  `ChannelMemoryImport = "kira:memory:import"`.
- `main.go`: register `application.NewService(bridge.NewMemoryImportService(memorySvc,
  dialogsSvc))`. Regenerate bindings with `wails3 task common:generate:bindings`.

## 9. Frontend

- `packages/shared/domain/memoryImport.ts` (new): zod `importJobSchema` (id, roots, base, state,
  reason, truncated, ignoredCount, estimate {files, chunks, tokens, calls, seconds}, progress
  {filesDone, filesTotal, chunksDone, chunksTotal}, totals {added, updated, noop, unresolved,
  failedFiles, skippedFiles}, calls, costUsd, createdAt, startedAt, finishedAt),
  `importFileSchema` (id, relPath, kind, size, state, reason, title, chunkCount, chunksDone,
  factCount, added, updated, noop, unresolved [{fact, questions}], dropped [{fact, why}], costUsd),
  `importJobDetailSchema` {job, files}, `importChoiceSchema`. `domain/memory.ts`: event `source`
  enum adds `import`, `sourceRef` nullable, `sourceLabel` optional. `protocol/events.ts`:
  `memoryImport: 'kira:memory:import'`.
- `packages/workbench/src/memory/module.ts`: `MemoryControl` gains `memoryImportChoose(kind)`,
  `memoryImportCreate(paths)`, `memoryImportJobs()`, `memoryImportJob(id)`, `memoryImportAction(
  action, id)` for start/pause/resume/cancel/discard/dismiss/retryFailed, `memoryImportRetryFile(
  fileId)`, `onMemoryImport(cb)`. `apps/kira-space/frontend/src/bridge/memoryControl.ts` implements
  them over `@bindings/memoryimportservice.js`, zod at the edge.
- `packages/workbench/src/memory/import/importQueries.ts` (TanStack): `useImportJobs()` key
  `['memory','import','jobs']`; `useImportJob(id)` key `['memory','import','job',id]`;
  `useImportChoose`, `useImportCreate`, `useImportAction`, `useImportRetryFile` mutations
  invalidating `['memory','import']`; `useImportChangeSync()` invalidates on `onMemoryImport`.
- `import/importStore.ts` (Pinia, import UI only): `view: 'memory' | 'imports'`, `selectedJobId`,
  `confirmJobId`, `expandedFileId`.
- Components (`<script setup lang="ts">`, Tailwind utilities, shadcn-vue primitives):
  - `ImportMenu.vue`: `TooltipIconButton` (`cloud-upload`, "Import documents") opening a
    `DropdownMenu`: Import files…, Import folder…, separator, Show imports. After a non-cancelled
    choice: `create`, then `confirmJobId = job.id`.
  - `ImportConfirmDialog.vue`: shadcn `Dialog`. Scanning spinner text while `scanning`; then
    counts, skipped by reason (collapsible list), "N other files ignored", truncation note,
    chunks, about N tokens, about N Claude calls, about N min, note "Each file: one Claude call
    per chunk, then one that stores its facts. Runs in the background; you can pause." Buttons
    Start, Discard. Start → `view = 'imports'`, `selectedJobId`.
  - `ImportStatus.vue`: panel row under `SemanticStatus` when a job is `running`/`paused`:
    "Importing 12 / 40 files" (or "Paused: reason") + `Progress`; click → `view = 'imports'`.
  - `ImportView.vue` (main area): left column job list (state `Badge`, base path, date, progress);
    right `ImportJobDetail.vue`.
  - `ImportJobDetail.vue`: header actions by state (Pause, Resume, Cancel with `ConfirmDialog`,
    Retry failed, Dismiss); reason `Alert` when paused/failed; summary line (added, updated,
    already known, unresolved, failed files, skipped files, calls, cost label D8); file list
    virtualised with `@tanstack/vue-virtual` (`useVirtualizer`; up to 2000 rows).
  - `ImportFileRow.vue`: rel path, state `Badge`, `chunksDone/chunkCount`, counts, reason; Retry
    for `failed`; expandable unresolved (fact + questions) and dropped (fact + why) lists.
- `MemoryPanel.vue`: add `ImportMenu` in the header and `ImportStatus` under `SemanticStatus`;
  call `useImportChangeSync()`; selecting a memory row sets `view = 'memory'`.
- `MemoryStart.vue`: render `ImportView` when `view === 'imports'`; event line shows `via import
  (<sourceLabel>)` for import events. Mount `ImportConfirmDialog` when `confirmJobId` is set (in
  `MemoryPanel.vue`, where the other dialogs mount).

## 10. Commits (in order; each passes the pre-commit hook)

1. `feat(memory): import provenance in memory events` — §4 (migration 3, model, service, store,
   `Store.DB`), `migration_test` case (§11).
2. `feat(memory): import mode for kira-memory MCP server` — §5.
3. `feat(memory): agent calls with MCP tools in Claude runner` — §6.
4. `feat(memory): document scan for bulk import` — `scan.go`, `textfile.go`, `scan_test.go`;
   `go.mod` adds go-git (gitignore package only imported).
5. `feat(memory): structure-aware chunker` — `tokens.go`, `chunk.go`, `chunk_test.go`; goldmark.
6. `feat(memory): import engine with resumable state` — `db.go`, `engine.go`, `agent.go`
   (interface only), `estimate.go`, `engine_test.go`; backoff direct.
7. `feat(memory): extract and finalize agents` — `extract.go`, `finalize.go`, `ClaudeAgent`;
   `smoke_test.go` (`claudesmoke` tag).
8. `feat(space): memory import bridge and multi-file picker` — §8.
9. `feat(space): bulk import in Memory module` — §9.
10. `test(space): memory import UI spec` — §11 Playwright.
11. `docs: P211 memory bulk import` — §13; delete this plan and the notes file.

## 11. Tests (CLAUDE.md bar)

- `chunk_test.go` (several interacting rules): one table test. Cases: heading path across nested
  levels; split preferred at a level ≤ 2 heading once minimum fill is reached, not before; a
  fenced block (backticks and tildes, longer fence) never split even across a blank line inside;
  a setext heading recognised; an oversized paragraph split at lines, an oversized line at
  sentences, a sentence-free line hard-cut; no chunk over max; small tail merged; context is the
  previous chunk's tail cut at a line start and empty for chunk 0; plain text splits on blank lines
  only; title from first H1 or file name.
- `engine_test.go` (state machine, concurrency, resume; `-race`): fake `Agent` scripted per call;
  real `memory.Store` in `t.TempDir()`; finalize fake stores through `memory.Service.Store` with
  `SourceImport` and a fake `memory.Runner` (accept all), so `countOutcomes` is real. Cases:
  happy path (2 files × 3 chunks, finalize sees facts in chunk order, counts match events); a
  transient chunk error retried then succeeds (zero-delay `Backoff` option), a permanent one fails
  the file with the chunk reason while the other file completes, `RetryFile` reruns only the
  failed chunk; `ErrClaudeAuth` pauses the job with its message and no further calls, `Resume`
  finishes; pause mid-extract releases the in-flight chunk without counting an attempt; recovery:
  rows forced to `running`/`finalizing`, a new `Open` resets them, `Resume` completes without
  re-extracting done chunks; unchanged skip: second job over the same file is `skipped` with no
  agent calls; cancel marks remaining files `cancelled` and deletes their chunks; concurrency: a
  blocking fake records at most 3 concurrent `Extract` and 1 `Finalize`.
- `scan_test.go` (interacting walk rules): one tree in `t.TempDir()` covering hidden dir, skipped
  dir name, nested `.gitignore` with a negation, symlink to file and to dir (not followed), binary,
  non-UTF-8, too large, empty, unsupported extension (counted), file cap truncation.
- Migration: one test that builds a version-2 `memory.db` holding an event, migrates, and finds the
  row intact and an `import` event insertable (data-preserving table rebuild). No other storage
  tests.
- `claude_test.go`: new rows in the existing error-mapping table only.
- `server_test.go`: the import-mode attribution assertion (§5).
- `smoke_test.go` (`//go:build claudesmoke`, not CI): `TestMain` re-executes the test binary as
  `memory-mcp` when `KIRA_TEST_MEMORY_MCP=1` (calls `memorycli.Run`), so `ClaudeAgent.Executable` is
  `os.Executable()`. Imports `testdata/smoke/` (two short Markdown files; one names a service in its
  first section and refers to it only as "it" in a later section forced into another chunk by a
  small test budget). Asserts job `done`, both files `done`, at least one `add` event with
  `source = import`, and no stored fact containing a bare unresolved "it" subject (manual read of
  the output in the notes, not a string assertion). Records calls, cost, durations in notes.
- Playwright `apps/kira-space/tests/ui/memory-import.spec.ts` against the mock runtime: choose
  folder → confirm dialog with estimate → Start → job view with one `done`, one `failed` (reason
  shown, Retry calls `RetryFile`), one `skipped`; paused job shows reason and Resume. Mock entries
  in `support/mockRuntime.ts` and `support/ipcChannels.ts`.
- No tests for: estimate arithmetic, `textfile.go` alone, bridge methods, zod schemas, dialogs.

## 12. Verification the orchestrator runs before accepting

- `go build ./...`; `go test -race ./internal/memory/... ./apps/kira-space/internal/bridge/`;
  `bun run typecheck`; `bun run lint`; `bun run test:unit`; the two memory Playwright specs.
- Real callers, by grep: `goldmark.` in `importer/chunk.go`; `gitignore.` in `importer/scan.go`;
  `backoff.` in `importer/engine.go`; `useVirtualizer` in `ImportJobDetail.vue`; `"--mcp-config"`
  in `memory/claude.go`; `"--import-ref"` in `memorycli/run.go`; `SourceImport` in
  `mcpserver/server.go`; `importer.Open(` in `bridge/memory.go`; `NewMemoryImportService(` in
  `apps/kira-space/main.go`; `PromptForMultipleSelection` in `internal/shell/wails.go`;
  `ImportView` imported by `MemoryStart.vue`; `ImportMenu` by `MemoryPanel.vue`.
- `go test -tags claudesmoke ./internal/memory/importer/ -run Smoke -v` passes here (authenticated
  `claude` on `PATH`); notes hold its calls, cost, timings and the stored facts.
- Server-tag app run (DEV_ENVIRONMENT recipe): import a folder of 3 to 5 Markdown files; confirm
  dialog; progress; quit mid-run, relaunch, job shows "Interrupted", Resume completes; memory
  history shows "via import (<path>)"; re-import the same folder: all "unchanged".
- Step-2 isolation check (notes): put a canary instruction in a temporary user `CLAUDE.md`
  (`$HOME/.claude/CLAUDE.md` in a throwaway `HOME` that still holds credentials, or the real one
  backed up and restored) and confirm the finalize agent does not follow it. If it does, record it
  as a Known open item; do not reintroduce `--safe-mode` (it removes the MCP server).
- Confirm a non-allowed MCP tool is denied under `--permission-prompts none` (spike server with a
  second tool), result in notes.

## 13. Docs

- `ARCHITECTURE.md` "Memory MCP server and module": new bullets "Bulk import (P211)": flow, file
  types and walk rules, chunk budget and estimate, two steps and their flags (why no safe mode in
  step 2), import mode of `memory-mcp` and forced attribution, tables and state machines, recovery,
  unchanged skip, concurrency and backoff, counts from events, security paragraph (D10). Stack
  table rows: goldmark, go-git `plumbing/format/gitignore`, `cenkalti/backoff/v4`. Known open
  items: anything the isolation check finds; re-import of a changed document never retracts facts
  removed from it (memories are never deleted), only if the user keeps D-retract's default.
- `DEV_ENVIRONMENT.md` Memory section: import smoke command, `KIRA_TEST_MEMORY_MCP` re-exec.
- `NOTICES.md`: entry only for a dependency shipping a `NOTICE` file (check goldmark, go-git,
  backoff module roots).
- `SPEC.md`: P211 row Done; "P211 result" section (P210's shape: decisions taken, measurements,
  verification, deviations, unverified). Delete this plan and `P211-notes.md`.

## 14. Deferred decisions (user's; recommended default in bold)

1. File types: **Markdown and plain text (`.md .markdown .mdx .txt .text .rst .adoc`)**; add
   source code; add PDF via `ledongthuc/pdf` (layout-poor text).
2. Per-file cap: **256 KiB** (about 85k tokens, about 28 chunks); 1 MiB (needs a hierarchical
   step 2 for very fact-dense files, D9).
3. Chunk size: **3000 target / 4000 max tokens, 200-token read-only context**; smaller (1500)
   for higher recall at about twice the calls.
4. Concurrency: **3 extract agents, 1 finalize agent**; 1/1 for a tight subscription limit; 5/1.
5. Budgets: **extract 0.50 USD per call; finalize `min(5, 1 + 0.15 × batches)` USD**.
6. `.gitignore`: **honoured**; ignored.
7. After an app restart: **job paused as interrupted, user clicks Resume**; auto-resume on launch.
8. Unresolved facts: **listed per file with the gate's questions**; plus an "Add manually" button
   prefilling Add memory (follow-up phase).
9. Changed document re-import (D-retract): **imports the new version in full; facts removed from
   the document stay stored** (memories are never deleted); mark old import facts for review.
10. Cost display: **API-equivalent cost reported by Claude Code, outer agents only, labelled**;
    hide cost entirely.

## 15. Risks

- Finalize duration on large files (tens of `store_memory` calls, 5 to 20 s each): bounded by the
  timeout formula; progress is per file, so a long finalize looks stalled. Mitigation: file row
  shows "Storing facts (N)" with elapsed time.
- Gate over-challenge on document facts whose reason is "Stated in <path>": shows up as many
  unresolved facts in the smoke run. If so, adjust the finalize prompt's reason format, not the
  gate; record in notes.
- `claude` error text for rate and usage limits is matched by substring; unknown wording falls to
  the generic retry class, which still backs off. Record any real message seen.
- `memory.db` write contention between the engine and `memory-mcp` children: short transactions,
  `busy_timeout` 5000, immediate locks; same model as today's app plus MCP.
