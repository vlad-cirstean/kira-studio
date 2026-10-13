# P281 code review round 1: findings

Base: `cbc60ea4a` (`docs: P270 update architecture for P267-P269, prune open items`). Git confirms it is
the last review close-out: the commits right before it are the P269 round-2 fixes and `docs(p269):
review rounds test result`; no review findings or fix commit lands after it. Diff
`git diff cbc60ea4a..HEAD` at tip `1f1986af6`: P271-P280 plus P284 site code, 163 commits.

Scope reviewed: Go and frontend source changed since base. Skipped: generated files, lockfiles,
screenshots, `site/dist`, docs prose (except `site/.../reference/mcp-tools.md` tool names, checked
against the registered tools: match).

Areas reviewed, with one-hop callers:

- Memory ingest: `internal/memory/importer` (engine, runner, db, launcher, memdoc, writedoc, verify,
  chunk_json), `internal/memory/mcpserver/ingest.go`, `internal/memory/memorycli/ingest.go`,
  migration `0005_p274_ingest.sql`.
- Memory model and ranking: migration `0004_p272_provenance.sql`, `ids.go`, `project.go`, `applydoc.go`,
  `service.go` (`Store`, `Prepare`), `rank.go`, `hybrid.go`, `vectors.go` `groupStats`,
  `memcheck`, Space `bridge/memory.go`.
- App prompts: `internal/llmprompts` (store, render, validate), `claudeheadless/mcp.go`, ADE `vars.go`,
  Settings prompts UI (`packages/workbench/src/llmPrompts`, `state/llmPromptDrafts.ts`,
  `SettingsShell.vue`).
- Resume and quit gate: `internal/scriptruns/resume.go`, `repo.go`, `smart_run.go`, Space
  `ade/runs.go` `ResumeRun`, `repos/adetask.go` `RecoverRunning`, `internal/shell/quit.go`,
  `internal/prompts/quitgate.go`, `QuitPrompt.vue`.
- Open items: `internal/docker/imageregistry.go`, `registry.go`, `internal/toolexec/claude.go`.
- Git graph (P278): `packages/git-ui` `graphView.ts`, `packedStream.ts`, `CommitGrid.vue`.
- Site (P280, P284): `site/scripts/docsRules.ts`, `check-docs.ts`, `site/package.json` licences.
- Standing rules over new `.vue`/`.ts`: all components `<script setup lang="ts">`, no scoped
  `<style>`, no hand-rolled DOM listeners or storage, two new Pinia stores each one concern.

Severity counts: blocker 0, major 2, minor 4.

## Group A: importer runner (`internal/memory/importer`)

### A1. Verify and finalize claims reload every extracted file on each tick (major, performance)

`db.go:729-804` `claimVerify` and `claimFinalize` call `extractedIDs`, then `loadExtracted`
(`db.go:659-700`) for every extracted file of every running job until one qualifies. `loadExtracted`
reads every chunk row, unmarshals every chunk's facts JSON, and runs `Questionable` per fact.
`Questionable` (`verify.go:69-75`) calls `normalizeQuote(chunkText)` per fact, so a chunk's whole text
is lower-cased and re-split once per fact.

Path: a large job (for example 100 files of 10 chunks). Three extract workers outrun the one finalize
worker (`runner.go:495`), so finished files pile up in `extracted`. Once no chunk is pending, every
`schedule()` call (each 500 ms tick plus every `kick()`) runs `claimVerify`, which loads all queued
files and finds none to verify, and `claimFinalize`, which loads files until the first. Both run inside
`s.tx`, and `memory.db` opens with `_txlock=immediate` (`store.go:61`), so the write lock is held for
the whole scan. Result: continuous CPU on megabytes of JSON and text per tick for the whole finalize
phase, and `store_memory`, UI stores and `kira-memory` writes wait on the lock.

Fix: compute the questionable-fact count once, when a file reaches `extracted` (the last
`finishChunk`), and keep it in a new `import_files` column updated by `saveVerdicts`. Claim with
`WHERE f.state = 'extracted' AND j.state = 'running' AND verify_pending > 0` (or `= 0` for finalize)
`... LIMIT 1`, then `loadExtracted` only the claimed file. In `loadExtracted`, normalize each chunk's
text once, not once per fact.

### A2. Kira-memory doc header provenance is trusted on agent-started ingest (major, security)

`runner.go:382` and `runner.go:543` treat any `.md`/`.txt` whose first lines parse as a kira-memory doc
as `memdoc`. `memdoc.go:47-85` `finalizeDoc` applies it with `memory.Service.ApplyDoc`
(`applydoc.go:41-126`): origin, source, scope and project come from the file header; no gate, no
Claude call; an existing lineage whose id the doc lists is updated when the doc's grade is at least
the stored one. `db.go:244-265` `autoStartTx` starts an MCP job whenever its chunk count is within
300, and a memdoc has 0 chunks, so it always auto-starts.

Path: an agent calls `ingest_files` on a cloned folder with `origin: agent` or `external`. A file in it
carries a doc header `origin: user`, `scope: company`. The job starts without the user, and its facts
land as user-decided, company-wide facts: top grade in ranking (`rank.go` `gradeUser`), visible in
every project. A header can also rewrite a stored user fact whose id appears in the repository, since
`user` passes the grade guard. P274 §2.8 decided "header provenance wins"; the decision did not cover
an unattended MCP job raising its own provenance this way.

Fix: keep header provenance, but never auto-start it past the job's own trust. In `scanned`/
`autoStartTx`, when an MCP job holds a memdoc whose header origin grades above the job's origin, or
whose scope is `company` while the job's is not, leave the job `awaiting` with a reason ("Needs
confirmation in Kira Space: N kira-memory docs claim origin user"), so the user confirms in the
import view. The scan already parses the header (`isMemdoc`), so the check needs no second read.

## Group B: Space ADE resume (`apps/kira-space/internal/ade/runs.go`)

### B1. `ResumeRun` drops the resume spec when queueing fails (minor, correctness)

`runs.go:1046` clears the stuck run's launch spec (`ResumeID`) before `runs.go:1051` `queueRun`.
`queueRun` can fail before it inserts the new run: `checkNotArchiving`, `worktreeOf` (worktree
creation error), `SetupByBranch` (`runs.go:353-387`). The error reaches the user, and the stuck run is
no longer resumable, so the Claude session cannot be continued any more. Studio's
`scriptruns.Resume` restores its spec on failure (`resume.go:62`); the Space path does not.

Fix: clear the spec only after `queueRun` returns without error. The task mutex is held, and the
"latest attempt" check (`runs.go:1041-1044`) already refuses a second resume once the new run exists.

## Group C: quit gate (`internal/shell/quit.go`)

### C1. A quit request while the popup is pending does nothing (minor, correctness)

`quit.go:138-144`: `ShouldQuit` raises the popup only when `asking` flips from false. When it is
already true, it returns false and does nothing. Both apps set
`ApplicationShouldTerminateAfterLastWindowClosed: false` (`apps/kira-studio/main.go:94`,
`apps/kira-space/main.go:113`).

Path: agents run; the user presses Cmd+Q; the popup opens in a window; the user closes that window
with its frame button (only the dialog's own Cancel, Escape and close call `quitCancel`). The router
entry stays, `asking` stays true, and no window is open. Every later Cmd+Q, Dock Quit or menu Quit
is silently ignored until the user reopens a window by hand.

Fix: when `asking` is already true, call `go g.Ask(n)` again instead of nothing. `Router.Open` is a
no-op for the same id, and `RevealKind` reopens a window when none is open.

## Group D: memory project key (`internal/memory/project.go`)

### D1. A local repository at a path with whitespace gets no project key (minor, correctness)

`project.go:80-84`: without an origin remote, the key is `local:` plus the main worktree path, then
`checkProject` rejects any whitespace. A macOS path such as `/Users/me/My Projects/app` is common.
`DetectProject` fails, so `mcpserver/ingest.go:131-141` `projectOf` silently falls back to the server's
own project. Path: an agent ingests files from such a repository with `scope: project` and no
`project`; the facts are stored under a different repository's project key.

Fix: make the local key whitespace-free but stable, for example
`"local:" + url.PathEscape`-style escaping of each path segment, so `checkProject` and the SQL CHECK
accept it. In `projectOf`, fall back to the server project only when the path is not in a git
repository, not when its key was rejected.

## Group E: Docker registry link (`internal/docker/imageregistry.go`)

### E1. Opening a detail view sends local image names to Docker Hub (minor, privacy)

`imageregistry.go:75-101` `hubHasRepo` asks `hub.docker.com` whether `ns/repo` exists. `useImageRegistry`
(`packages/docker-ui/src/queries.ts:113`) runs it as soon as a container or image detail opens
(`ContainerDetail.vue:44`, `ResourceDetail.vue:62`), under the containerd store, for every implied-Hub
name. Path: a user builds `acme/billing-internal` locally and opens its container's detail; the name
goes to a third party with no user action. P277 chose the Hub check for the link rule, but not when it
fires.

Fix: show the registry button for an implied-Hub name under the containerd store without resolving
it, and run the Hub check on click: open the page on 200, show "No registry page found" on 404 or
error. The lazy, cached check stays.

## Nothing found

- `internal/memory/importer` engine control path: job create/twin dedupe, active-job cap, start,
  pause, cancel, retry, runner lock, idle exit and `tryExit` race, crash recovery, write-back target
  guard, JSON chunker.
- `internal/memory/mcpserver/ingest.go` input checks (absolute paths, counts, group kinds, schema
  enums); `ingest_status` rendering.
- Migrations `0004` and `0005`: id mapping, legacy id table, FTS and embedding carry-over, trigger
  order, CHECKs.
- Ranking: `rank.go` scoring, `hybrid.go` fusion and pools, `groupStats`.
- `service.go` `Prepare`, `applydoc.go` grade guard and stale retry (apart from A2's trust question).
- `internal/llmprompts`: store refresh, conflict hash, all-or-nothing save, include cycles, render
  fallback; user text only reaches templates as data, never as template source.
- Studio `scriptruns.Resume`: take/restore of the resume id, secret params, worktree claim release;
  `claudeheadless` passes `--resume` instead of `--session-id`.
- Space `RecoverRunning` single-statement update with resume id.
- P278 git graph: synchronous plan publish, staged restart swap, abort and corruption paths.
- `toolexec/claude.go` resolver; `memcheck` hook install.
- Site: docs lint rules and runner, Astro/Starlight/sharp/fontsource licences (MIT, Apache-2.0, OFL).
- Standing rules in new frontend code: `<script setup lang="ts">` everywhere, Tailwind only,
  shadcn primitives, TanStack Query for bridge state, `llmPromptDrafts` and `memoryUi` stores one
  concern each.
