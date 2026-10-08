# P224 plan: remove speech to text

User decision, verbatim: "Remove speech to text completely". P216's dictation goes; P218 (engine swap) is
cancelled. Keep what embeddings share: `internal/memory/modelstore`, `internal/memory/workerproc`, the
`memory-embed` worker, `coalescer`, shadcn `Popover`/`Progress`.

Discovery: `codegraph_explore` (stt worker/client/dictation, modelstore and workerproc callers, workbench
dictation components and queries), plus `git diff 45d3445b2 26ec93700` (P216's own file list) and grep for
the parts the index lacks (`apps/kira-space`, P221 on `v22-fix-C`).

## 0. Preconditions

- **Runs after P221 lands.** P221 (`v22-fix-C`, not merged yet) adds `DictationModelSection.vue`, rewrites
  `MicButton.vue`, adds dictation tests to `settings-memory.spec.ts` and edits the same ARCHITECTURE section.
  Rebase `v22-fix-F` onto the chapter branch once P221 is merged, then implement. Never edit P221 files on
  this branch before that.
- P223 lives on `v22-fix-E`. On merge, its SPEC row goes above P224 (table order = number order).
- P218 leftovers, outside any commit: `/home/user/kira-studio` (branch `v2.0`) holds the benchmark agent's
  uncommitted `go.mod`/`go.sum` (sherpa-onnx-go), `internal/memory/stt/bench_test.go`,
  `internal/memory/stt/testdata/`. Orchestrator discards them once that agent stops:
  `git -C /home/user/kira-studio checkout -- go.mod go.sum` and remove the two untracked paths. No
  `P218-measurement.md` exists today; if one appears on any branch, delete it in commit 5.
- `docs/v2.2/plans/P218-plan.md` is committed on this branch: delete in commit 5.

## 1. Inventory and action

### Go (commit 2)

| Path | Action |
|---|---|
| `internal/memory/stt/` (all 15 tracked files incl. `transcript/`, `smoke_test.go`) | delete package |
| `apps/kira-space/internal/bridge/dictation.go` | delete (`DictationService`, `ChannelMemoryDictation`, `DictationStreamName`, `ServeDictationStream`, `CloseDictation`, `glossary`, `topKeywords`; all dictation-only) |
| `apps/kira-space/internal/appshell/stream.go` | delete `RegisterDictationStream`; `RegisterGitStream` stays |
| `apps/kira-space/main.go` | drop `memstt` import, `memory-stt` case in `runArgvShim` and its doc lines (62, 67), `dictationSvc` (203), `CloseDictation` (299), `application.NewService(dictationSvc)` (332), `RegisterDictationStream` (376); line 88 comment: "21 bound services plus the git and dictation stream registrations" becomes 20 services plus the git stream; recount bound services against the list |
| `internal/memory/modelstore/modelstore.go` | package comment: "shared by the embedding and speech workers" becomes "used by the embedding worker"; add `RemoveRetired` (section 2) |
| `go.mod`, `go.sum` | `go mod tidy`: drops `github.com/gen2brain/malgo` (direct, only `capture_malgo.go` used it). whisper.cpp is cgo glue, no module. `go-huggingface` stays (modelstore). Any other line tidy removes: confirm with `go mod why -m` it was speech-only |
| `internal/shell/security.go`, `security_test.go` | **keep** `PermissionMicrophone: PermissionDeny`: predates P216, a webview hardening default, not dictation |

No migration, no settings key: dictation never wrote to `memory.db` or `kira-space.db` (grep of
migrations and settings models: zero hits). Nothing to drop.

### Frontend (commit 1)

| Path | Action |
|---|---|
| `packages/workbench/src/memory/dictation/` (`MicButton.vue`, `DictationStatusLine.vue`, `store.ts`, `useDictation.ts`) | delete dir |
| `packages/workbench/src/memory/settings/DictationModelSection.vue` (P221) | delete |
| `apps/kira-space/frontend/src/workbench/settings/MemoryPane.vue` (P221) | drop the import and `<DictationModelSection />` |
| `packages/workbench/src/memory/settings/modelDownloads.ts` (P221) | only `semantic` remains: drop `ModelKind` and the `kind` parameter, one controller (D3); update `SemanticModelSection.vue` calls |
| `packages/workbench/src/memory/MemoryPanel.vue` | drop dictation imports, `SEARCH_DICTATION_ID`, `dictationStatus`, `dictation`, `dictating`, `showSearchAddon`, `:readonly`, `<MicButton>`, `<DictationStatusLine>`; addon back to `v-if="query"` with the clear button unconditional inside it (pre-P216 shape). Remove `useDictationStatus` from the queries import; drop `computed` only if P221's semantic hint no longer needs it (it does: keep) |
| `packages/workbench/src/memory/AddMemoryDialog.vue` | drop dictation imports, `dictation`, `textInput`, `DICTATION_ID`, `dictating`, `ref="textInput"`, `:readonly`; the counter row back to `<span class="self-end text-kira-sm text-muted-foreground" data-testid="add-memory-count">`; drop `useTemplateRef` from the vue import if unused |
| `packages/workbench/src/memory/queries.ts` | delete `DICTATION_KEY`, `useDictationStatus`, `useInstallDictationModel`, `useRetryDictation` |
| `packages/workbench/src/memory/module.ts` | delete `DictationFrame`/`DictationStatus` import, `DictationHandlers`, `DictationSession`, the five `dictation*`/`onDictation` members of `MemoryControl` |
| `packages/shared/domain/dictation.ts` | delete |
| `packages/shared/protocol/events.ts` | delete `memoryDictation` and its comment |
| `apps/kira-space/frontend/src/bridge/memoryControl.ts` | delete `DictationService` binding import, dictation schema import, `Stream` import (git uses it elsewhere, not here), `DictationHandlers`/`DictationSession` type imports, `openDictation`, and the five control members |
| `apps/kira-space/tests/ui/memory-dictation.spec.ts` | delete |
| `apps/kira-space/tests/ui/support/dictationStreamMock.ts` | delete |
| `apps/kira-space/tests/ui/support/ipcChannels.ts` | delete lines 197-201 (`dictationStatus`, `dictationInstall`, `dictationRetry`, `memoryDictation`) |
| `apps/kira-space/tests/ui/support/mockRuntime.ts` | delete the three `DictationService.*` FQN rows (174-176) and the default `dictationStatus` response (277-278) |
| `apps/kira-space/tests/ui/settings-memory.spec.ts` (P221) | delete the `dictation()` helper and its three tests; header comment drops "and speech"; drop `MB` if unused |

`Popover`, `Progress`, `TooltipIconButton` stay: other callers exist. After commit 2, regenerate bindings
(`wails3 task common:generate:bindings`, per `docs/DEV_ENVIRONMENT.md`); `dictationservice.js` must vanish
from `apps/kira-space/frontend/bindings/` (gitignored).

Commit order matters for the hooks: frontend first (stops importing `@bindings/dictationservice.js` while
the Go service still exists), Go second.

### Build and packaging (commit 4)

| Path | Action |
|---|---|
| `scripts/fetch-whisper.sh` | delete |
| `apps/kira-space/build/darwin/Taskfile.yml` | revert P216: drop the `deps: fetch:whisper` block and its comment, `EXTRA_TAGS: '{{.EXTRA_TAGS}}'`, `CGO_CFLAGS`/`CGO_LDFLAGS` back to `"-mmacosx-version-min=14.0"`, delete the `fetch:whisper` task |
| `apps/kira-space/build/darwin/Info.plist`, `Info.dev.plist` | delete `NSMicrophoneUsageDescription` key and string (nothing else captures audio; no entitlement carries `audio-input`) |
| `apps/kira-space/.gitignore` | delete `build/whisper` |
| `scripts/verify-packaging.sh` | delete the S13 block; S10: drop `--exclude-dir=build` and the "`build` dirs hold fetched third-party sources (P216's whisper.cpp checkout)" sentence, unless a run shows a hit in another fetched `build` dir (then keep the exclude and name that dir in the comment) |
| `docs/pending-changes/.github__workflows__pr.yml.patch` | delete (P216-only; dir becomes empty) |
| local `apps/kira-space/build/whisper/` | `rm -rf` in the worktree (untracked) |

### Docs (commit 5)

- `docs/ARCHITECTURE.md`: delete the Stack table row "Local speech to text (P216 ...)"; delete the speech
  bullets in "Memory MCP server and module" (from "Speech to text (P216)" to "macOS needs
  `NSMicrophoneUsageDescription`"), moving the one shared fact (`workerproc` owns worker lifecycle,
  `modelstore` owns download, SHA-256 check and manifest; embed uses both) into the semantic-search
  bullets; add one bullet: the speech model dir is deleted at startup (section 2). After P221: line
  "`MemorySetupHint` and the mic popover only link there" drops the mic popover. Delete both dictation
  Known open items. Keep the webview-permissions table row (microphone deny is unrelated).
- `docs/DEV_ENVIRONMENT.md`: delete the "Speech to text (P216)" bullet.
- `docs/PACKAGING.md`: delete the "whisper.cpp (P216)" paragraph.
- `NOTICES.md`: grep shows no whisper.cpp, Silero, malgo or miniaudio entry (P216 never added one).
  Nothing to remove; re-grep to confirm.
- `docs/v2.2/SPEC.md`: P216 result section becomes one line: "Removed in P224 (user dropped speech to
  text)." Add a P224 result section. P224 row Done.
- Delete `docs/v2.2/plans/P218-plan.md` (and `P218-measurement.md` if one exists by then).
- `CLAUDE.md`, `README.md`: no speech mention (checked).

## 2. Stored model cleanup (commit 3)

Users who downloaded the model keep 191 MB under `<memory home>/models/whisper-small.en-q5_1-5359861/`
(`memory.Home()`, default `~/.kira-memory`). Add to `modelstore`:

```go
// retired are model ids no feature loads any more; RemoveRetired deletes their directories.
var retired = []string{"whisper-small.en-q5_1-5359861"} // P216 speech model, removed in P224

func RemoveRetired(home string) error
```

`os.RemoveAll(ModelDir(home, id))` per id, errors joined (`errors.Join`); a missing dir is not an error.
Call it from Kira Space `main.go` right after `memorySvc` is built, in a goroutine, logging
`slog.Warn(..., "scope", "memory")` on error. Not in `memory-mcp`: Space alone suffices, and one caller
keeps it simple. No unit test (one `RemoveAll` loop, below this repo's test bar). Commit:
`feat(memory): delete the retired speech model at startup`.

## 3. Commits

1. `feat(memory)!: remove dictation from the Memory module` (frontend, section 1 table "Frontend"), footer
   `BREAKING CHANGE: memory dictation and its speech model download are gone.`
2. `refactor(memory): remove the speech to text backend` (Go table, `go mod tidy`).
3. `feat(memory): delete the retired speech model at startup`.
4. `build(space): drop the whisper.cpp build and microphone usage string`.
5. `docs: remove speech to text` (ARCHITECTURE, DEV_ENVIRONMENT, PACKAGING, SPEC, P218 plan deletion).

Every commit passes the pre-commit hook normally; no `--no-verify`.

## 4. Verification

Leftover greps (run from repo root; historical chapters excluded):

```sh
X=':!docs/v1*' ; Y=':!docs/v2.0' ; Z=':!docs/v2.1' ; S=':!docs/v2.2/SPEC.md' ; P=':!docs/v2.2/plans/P224-plan.md'
git grep -n -i -E 'whisper|dictation|malgo|memory-stt|silero|ggml|MicButton|sttsmoke|fetch-whisper' -- . "$X" "$Y" "$Z" "$S" "$P"
git grep -n -E '\bstt\b|memory/stt|memstt' -- . "$X" "$Y" "$Z" "$S" "$P"
git grep -n -i -E 'microphone|speech' -- . "$X" "$Y" "$Z" "$S" "$P"
```

Expected: first grep hits only the `retired` id in `modelstore.go` and the ARCHITECTURE cleanup bullet;
second none; third only `internal/shell/security.go`, `security_test.go` and the ARCHITECTURE
webview-permissions row. Plus: `grep -c malgo go.sum` is 0; `ls apps/kira-space/frontend/bindings/**/dictationservice*`
finds nothing after regeneration.

Build, lint, tests:

- `go mod tidy` leaves no diff; `go mod verify`.
- `go build ./...`; `go build -tags server ./apps/kira-space`; `CGO_ENABLED=0 go build ./internal/memory/...`.
- `go vet ./internal/memory/... ./apps/kira-space/...`.
- `go test -race ./internal/memory/... ./apps/kira-space/internal/bridge/ ./apps/kira-space/internal/appshell/ ./internal/shell/`.
- `bun run lint:go` (golangci-lint, untagged; the `--build-tags whisper` run no longer exists).
- `wails3 task common:generate:bindings` (Space), then `bun run typecheck`, `bun run lint`,
  `bun run lint:dead` (knip: no orphan export left in `queries.ts`, `module.ts`, `modelDownloads.ts`),
  `bun run test:unit`.
- `bun run test:ui:space` full suite once at phase end; `memory-module`, `memory-import`,
  `settings-memory` must pass. Test count drops by the 8 `memory-dictation` and 3 settings dictation tests.
- `sh scripts/verify-packaging.sh`: S13 gone, S10 clean; only the known unrelated "debug hooks in
  packaged bundle" finding from a local test `dist` may remain.
- Manual, optional: with `KIRA_MEMORY_HOME` pointing at a temp home holding
  `models/whisper-small.en-q5_1-5359861/x`, start Space (`wails3 task dev`): the dir is gone, the
  embedding model dir is untouched.

Not verifiable here: macOS build and `codesign` (unchanged risk shape; the darwin Taskfile reverts to its
pre-P216 form).

## 5. Deferred decisions (defaults in bold)

- D1 Speech model on disk: **delete at Space startup via `modelstore.RemoveRetired`**; alternative leave it
  and document a manual `rm`.
- D2 Keep the `retired` list: **keep indefinitely** (one line, harmless); alternative drop after the next
  release.
- D3 `modelDownloads` store with one kind: **drop the `kind` parameter**; alternative keep a one-member
  `ModelKind` union.
- D4 `modelstore` and `workerproc` packages: **keep as separate packages** (embed already depends on them;
  folding back into `embed` is churn with no gain).
- D5 Webview `PermissionMicrophone: Deny`: **keep** (pre-P216 hardening).
- D6 S10 `--exclude-dir=build`: **revert** unless a run shows another fetched `build` dir needs it.
