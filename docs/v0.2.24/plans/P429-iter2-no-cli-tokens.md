# P429 iter2: no CLI tokens, no attachments

Second pass on `docs/v0.2.24/SPEC.md` row P429. Base: `ac9f479af` (`chapter/v0.2.24-stream-e`). Plans against current
tree, on top of P429 iter1 and R1-F8 (`f4ebe75fe` on `chapter/v0.2.24`).

User decision (binding, verbatim): "the app must NEVER touch credentials/tokens belonging to a CLI it drives (az, gh,
jira CLI, etc.). It may only run the CLI and read its output (JSON)."

One sequential Sonnet implementer. No stream split: Go contract change, bridge, generated bindings, contract
fixtures, frontend and UI specs form one dependency chain (fixtures come from Go flows; UI specs read fixtures;
bindings come from bridge types).

## Discovery

`codegraph_explore`: 14 calls (13 answered from the main checkout's index; 1 refused, worktree not indexed). Queries
covered: azure `CommentCapabilities`/`PostChangeRequestComment`/`accessToken`/`uploader`; githost `NewComment`/
`Attachment`/`AttachmentMarkdown`; github `CommentCapabilities`/runner `buildEnv`/discovery `gh auth status`; jira
`CommentCapabilities`/`PostIssueComment`/runner/status; fakeaz `invoke`/upload/`Violations`; fakehost `PostedComment`;
`HostViewService` compose/`PostComment`/`HostViewAttachments`/`openTarget`; appwire `Build`; `CommentComposer.vue`/
`queries.ts`/`attachments.ts`; conventiontest `scan`/`checkCall`; usermcp `headerTransport`; docker endpoint. Worktree
line numbers then checked by Read/Grep (main has moved `hostview.go`, `hostviewcompose.go` since `ac9f479af`).

## Audit: CLI credential paths

Rule test per path: does Kira read, request, store or send a credential a driven CLI owns? Run-and-parse is fine.

- **Azure (`az`): violates. Removed by this plan.**
  - `internal/githost/azure/comment.go:98-118` `accessToken` runs `az account get-access-token --resource
    499b84ac-…` and returns the token.
  - `internal/githost/azure/upload.go:69,112` sends it as `Authorization: Bearer` on Kira's own `net/http` client
    (upload, cleanup DELETE).
  - Fine: `discovery.go:263` `az account show --query user.name` (account name only); runner env is `os.Environ`
    passthrough.
- **GitHub (`gh`): clean.**
  - All host calls run `gh` (`internal/githost/github/runner.go:132-141`); `cmd.Env = buildEnv(os.Environ())` appends
    hygiene vars only (`:70-80`), never reads or sets `GH_TOKEN`/`GITHUB_TOKEN`.
  - `discovery.go:201` runs `gh auth status --hostname <h>` without `--show-token`; output parsed for account only
    (`:222`).
  - No `net/http`, no `os.Getenv`, no config file reads. "token" appears only in user-facing reason strings
    (`errors.go`).
- **Jira (`acli`): clean.**
  - `internal/issuetracker/jira/runner.go:22` env is `os.Environ` passthrough.
  - `status.go:90` runs `jira auth status`; parsed for site and account only.
  - Comment body goes via a 0600 temp file (`comment.go:41`), not argv.
  - Op log records redacted argv, stderr only on error (`internal/oplog/toolrunner.go:34,44`).
  - Settings step `space.settings.cliTools.step.loginToken` is a copy-only command the user runs in their own terminal
    (`CliToolsPane`). Kira never reads the token file. Keep.
- **Other driven CLIs (listed, not in this phase's fix scope):**
  - `git` (`gitclient`, `gitprepare`, `memcheck`): askpass broker relays user-typed answers; never logged or
    persisted.
  - `claude` (harness, headless, `mcpinstall`, `usermcp`).
  - `curl` (hooks shim), `sandbox-exec`, `/usr/bin/log`, `caffeinate`, `getconf`, `xcode-select`, user shell
    (terminal, preconnect), `docker info` (tests only).
- **Flags for user decision (touch another CLI's stored credentials; propose v0.2.25 phases, not fixed here):**
  - `internal/harness/claude/usermcp.go:61-75,102-113,191-216` reads `~/.claude.json` `mcpServers`. `listTools`
    sends their stored `headers` (e.g. `Authorization`) itself through `headerTransport`. Run setup copies raw entries,
    secrets included, into a 0600 `--mcp-config` file (caller `apps/kira-space/internal/ade/runs.go:798`).
  - `internal/docker/endpoint.go:117` reads `~/.docker/config.json` for `currentContext` only; file can hold `auths`.
    Engine reached via Docker SDK with context TLS material, not the CLI.
  - Orchestrator: raise both with the user; add SPEC rows only on their call.

## Decisions

- **No comment attachments on any host.** Azure upload needs a bearer token Kira would have to take from `az`
  (forbidden). `gh` and `acli` have no comment-attachment command. Consistent UX: no attach affordance at all for
  every provider (no button, no drop zone, no paste handling, no hint text). Composer is text only.
- Window-level dragover/drop `preventDefault` in `HostViewWindow.vue` stays, so a stray drop never navigates the
  webview and never inserts a file path into the textarea.
- Remove every staging/attachment type, field, i18n key, binding and test helper. No unused scaffolding.
- Capabilities shrink to reply kinds. `githost.CommentCapabilities` struct goes; interface method becomes
  `ReplyKinds(r Repo) []string`. `issuetracker.CommentCapabilities` and its interface method go (issue composer has
  no reply kinds).
- Subsumes R1-F8 (`f4ebe75fe`: `Attachments.Forget` in `openTarget`, sweep inside `Take`). Both sites disappear.
- Single-post guard (`composeKeyPosting`) survives, moved off `HostViewAttachments` onto `HostViewService`.

## Steps

### 0. Rebase

`git rebase chapter/v0.2.24` (tip carries `f4ebe75fe`, `cfbae8a0b`). This plan file is the only stream-e commit
past `ac9f479af`, so it applies clean. Re-read every file below after rebase; line numbers here are from
`ac9f479af`.

Expected conflict files if rebase is skipped or later work lands first: `internal/bridge/hostview.go`,
`internal/bridge/hostviewcompose.go`, `packages/theme/src/i18n/en.json` (main added kibana keys),
`docs/v0.2.24/SPEC.md`, `docs/ARCHITECTURE.md`. `P434-review-round1.md` is already dropped on main (`cfbae8a0b`);
its "checked and clean" Azure token note needs no edit.

### 1. Go contract (commit: `refactor!: drop comment attachments from host contracts`)

All paths under `apps/kira-space/`.

- `internal/githost/comment.go`: delete `MaxAttachments`, `MaxAttachmentBytes`, `MaxAttachmentTotalBytes`,
  `Attachment`, `markdownEscaper`, `AttachmentMarkdown`, `NewComment.Attachments`, `CommentCapabilities` struct.
  `ChangeRequestComments` interface: replace `CommentCapabilities(r Repo) CommentCapabilities` with
  `ReplyKinds(r Repo) []string`. `NewComment{Body, ReplyTo}` stays.
- `internal/githost/azure/upload.go`: delete file (`uploader`, `newUploader`, `attachmentURL`, `uniqueName`,
  `upload`, `remove`, `transportStatus`, `azureHTTPS`, `reasonAttachSignIn`).
- `internal/githost/azure/comment.go`: delete `devopsResource` (:14), `uploaded`, attachment branch and cleanup
  (:38-74), `isImage`, `accessToken` (:98-118). `ReplyKinds` returns `{ThreadComment, ThreadCode}` (same values the
  old struct held). Keep text post via `p.Comment` and reply via `invoke pullRequestThreadComments`
  (`parentCommentId: 1`). Drop now-unused imports (`slog`, `strings`).
- `internal/githost/azure/provider.go`: delete `Options.HTTP` (:19-20), `uploader` field, `newUploader(o.HTTP)`
  (:50), `net/http` import.
- `internal/githost/github/comment.go`: method becomes `ReplyKinds` returning `{ThreadCode}`. Delete attachment
  refusal (:26-28) and the `AttachmentsReason` i18n key use; drop i18n import if unused.
- `internal/issuetracker/comment.go`: delete `CommentCapabilities` struct and interface method. `IssueComments` keeps
  `PostIssueComment` only.
- `internal/issuetracker/jira/comment.go`: delete `CommentCapabilities` (:18-24), i18n import if unused.
- Keep (read side, not upload): `jira/adf.go:346` `[attachment: name]` rendering; `jira/client.go:25` `-attachment`
  field exclusion.
- `internal/flowharness/fakeaz/upload.go`: delete file.
- `internal/flowharness/fakeaz/fakeaz.go`: delete `uploads`/`noToken`/`uploadCode` (:106-108), their init (:118),
  `SetTokenUnavailable` (:136-137), `SetUploadStatus` (:139-140), case `account get-access-token` (:272-273). Any
  future token call then fails as unsupported and shows in `Violations()`.
- `internal/flowharness/fakehost/fakehost.go`: delete `PostedAttachment`, `PostedComment.Attachments` (:497-517);
  `CommentCapabilities` (:519-524) becomes `ReplyKinds` returning `{ThreadComment, ThreadReview, ThreadCode}`;
  delete attachment loop (:553-558) and unused `crypto/sha256`/`encoding/hex` imports.
- Grep `CommentCapabilities|AttachmentMarkdown|MaxAttachment|azure.Options{.*HTTP` across `apps/kira-space`; zero
  hits after.

### 2. Bridge (commit: `refactor!: drop attachment staging from host view bridge`)

- `internal/bridge/hostviewcompose.go`: delete `stagedAttachmentTTL`, `maxAttachmentName`, `allowedAttachmentExt`,
  `imageExtType`, `HostViewStageArgs`, `HostViewStaged`, `HostViewDiscardArgs`, `HostViewPostArgs.AttachmentIDs`,
  `stagedAttachment`, `windowStage`, `HostViewAttachments` and all methods (`stage`, `sweep`, `uniqueName`, `Put`,
  `Take`, `Drop`, `Forget`), `SanitizeAttachmentName`, `megabytes`, `StageAttachment`, `isImageType`,
  `DiscardAttachment`, every `errStage*`, compose keys `DuplicateAttachment`, `FileContent`, `FileEmpty`,
  `FileName`, `FileTooLarge`, `FileType`, `LimitCount`, `LimitTotal`, `UnknownAttachment`.
  - `HostViewCompose` keeps `MaxBodyBytes`, `ReplyKinds` only.
  - `changeRequestCompose(replyKinds []string)`; `issueCompose()` takes no argument.
  - `validatePost`: empty check is body-only; drop count, unsupported and duplicate checks.
  - `resolveCompose`: drop `s.Attachments == nil` check.
  - `PostComment`: no `Take`/`Drop`. `postChangeRequest` builds `githost.NewComment{Body, ReplyTo}`.
  - Single-post guard: `HostViewService` gets `postMu sync.Mutex` and `posting map[string]bool` (lazy init under
    lock). `beginPost(key)` refuses with `composeKeyPosting` when set; `endPost(key)` deletes the entry. No
    window-close cleanup needed: entry never outlives a post.
- `internal/bridge/hostview.go`: delete `Attachments *HostViewAttachments` field (:60) and the `Forget` call in
  `openTarget` (R1-F8). Compose calls: `issueCompose()` (:314-317), `changeRequestCompose(w.ReplyKinds(l.repo))`
  (:354-358).
- `internal/bridge/hostviewcompose_test.go`: delete (only `TestSanitizeAttachmentName`).
- `internal/appwire/appwire.go:275`: drop `Attachments: &bridge.HostViewAttachments{}`.
- `main.go:172`: drop `wired.HostView.Attachments.Forget` from `OnWindowClosing`.
- Regenerate bindings: `wails3 task common:generate:bindings` (see `docs/DEV_ENVIRONMENT.md`). Commit generated
  output with this step.

### 3. Flow tests and contracts (commit: `test: P429 comments are text only`)

- `internal/flows/githostflow/comments_test.go`:
  - Forge: drop staging (step 2) and attachment post / consumed-file steps (3-5), duplicate-ids guard, Forget and
    staged guards. Keep post, reply, unknown thread, refetch, breaker, single-post guard. Compose assertion: exactly
    `{MaxBodyBytes, ReplyKinds}`.
  - Azure (:237-341): keep text post and reply through `fakeaz`. Drop `HTTP: az.Transport()`, token, upload, 413,
    cleanup and PAT steps, `PostComment#azureSignIn` contract. Keep `az.Violations()` empty assertion; it now proves
    no `get-access-token` call.
  - GitHub, Issue: drop Stage refusal and `AttachmentsReason` assertions.
  - Delete `hcStage`, `hcPNGBytes`, `hcB64` once unused.
- Contract fixtures (`apps/kira-space/tests/contract/`): hand-delete stale keys first (`KIRA_CONTRACT=write` only
  merges): in `host-view-comments.json` `StageAttachment#png`, `args:HostViewService.StageAttachment`,
  `PostComment#azureSignIn`. Then run `KIRA_CONTRACT=write go test ./apps/kira-space/internal/flows/githostflow
  ./apps/kira-space/internal/flows/...` to regenerate compose blocks in `host-view-comments.json`
  (`args:PostComment`, `PostComment#azure`), `host-view.json` (`ChangeRequest#azure/forge/github`),
  `issue-view.json` (`Issue#ok`). Grep fixtures for `attachment|attachmentIds|replyKinds` to confirm no stale field.

### 4. Frontend (commit: `refactor!: text-only comment composer`)

Under `apps/kira-space/frontend/src/`.

- `hostview/CommentComposer.vue`: remove `Item`/`items`, `stage`/`discard`, `busy`, `failed`, `readyIds`, `done`,
  attachment names in `preview`, `unsupportedReason`, `addFile`/`addFiles`, `useDropZone`, `useFileDialog`, paste
  listener, `remove`, drop overlay, attach `TooltipIconButton` (`icon="attach"`, `comment-attach`), attachment list,
  `notice` ref, `Spinner`, `card`/`root` template ref, now-unused imports (`useEventListener`, `useDropZone`,
  `useFileDialog`, `useTemplateRef`). `submit` sends no `attachmentIds`. Keep `formatBytes` (cap display). `canPost`
  = `!pending && !overCap && body.trim() !== ''`. Header comment: one line, text-only composer.
- `hostview/attachments.ts`: delete.
- `hostview/queries.ts`: delete `useStageAttachment`, `useDiscardAttachment` (:115-127), `PostVars.attachmentIds`
  (:51).
- `hostview/wire.ts`: `HostViewCompose` keeps `maxBodyBytes`, `replyKinds`; delete `HostViewStaged`.
- `bridge/index.ts`: delete `HostViewStaged` import (:87), `hostViewStageAttachment`, `hostViewDiscardAttachment`
  (:233-240), `attachmentIds` (:245).
- `HostViewWindow.vue`: no change (drop cancel stays).

### 5. i18n (`packages/theme/src/i18n/en.json` only; same commit as step 4)

- Delete `space.hostView.compose.{attach, attachments, drop, staging, tooMany, type, tooLarge, total}`.
- Delete `backend.space.hostView.compose.{duplicateAttachment, fileContent, fileEmpty, fileName, fileTooLarge,
  fileType, limitCount, limitTotal, unknownAttachment}`.
- Delete whole `backend.space.gitHost.comment` (:1294-1298) and `backend.space.issueTracker.comment` (:1427-1431).
- `backend.space.hostView.compose.empty.body`: "Write a comment or attach a file first." becomes "Write a comment
  first."
- Keep `space.settings.cliTools.step.loginToken`.
- `bun run check-catalog --unused` (or repo's catalog script) must report none of the above as orphaned or missing.

### 6. UI specs (commit: `test: text-only composer UI`)

- `apps/kira-space/tests/ui/host-view-comments.spec.ts`: delete drop/picker/paste/client-limits/GitHub-reason tests
  (:58-133). Add one test: for forge, GitHub and issue composers, `comment-attach` has count 0; a synthetic file
  drop and a file paste onto the composer leave body unchanged, no `comment-attachment` row, no drop overlay. Post
  test: assert request payload has no `attachmentIds`. Issue test: `comment-attach` `toBeDisabled` becomes
  `toHaveCount(0)`.
- `tests/ui/support/hostView.ts`: delete `stagedPng`, `stageSnap`, `discardSnap`; keep `sendFiles` only if the new
  test uses it.
- `tests/ui/support/ipcChannels.ts:14-15`, `tests/ui/support/mockRuntime.ts:38-39`: delete stage/discard channels.

Flow test and UI spec assert one contract: compose is `{maxBodyBytes, replyKinds}`, post carries `{body, replyTo}`,
Azure post never asks `az` for a token.

### 7. Enforcement: guard G5 (commit: `test: G5 guard against CLI credential access`)

Cheap and fits the existing AST scan in `internal/conventiontest/conventions_test.go` (`scan`/`checkCall`, path flag
like `inAdapters`). Add `inHostAdapters` for non-test `.go` files under `apps/kira-space/internal/githost/` and
`apps/kira-space/internal/issuetracker/`. Flag:

- string literal containing `get-access-token` or `--show-token`;
- adjacent `"auth", "token"` elements in one composite literal (`gh auth token`);
- literal containing `hosts.yml`, `.config/gh`, `.azure/`, `azureProfile`;
- literal equal to `Authorization` or starting `Bearer `;
- literal naming `GH_TOKEN`, `GITHUB_TOKEN`, `GH_ENTERPRISE_TOKEN`, `AZURE_DEVOPS_EXT_PAT`, `JIRA_API_TOKEN`;
- import of `net/http`;
- call to `os.Getenv`, `os.LookupEnv`, `os.UserHomeDir`, `os.UserConfigDir`.

`os.Environ()` passthrough stays allowed. Message names rule and points at ARCHITECTURE "CLI credentials: never
touched". No `permanentExemptions` entry. Before committing step 7, confirm it fires: temporarily re-add one
`get-access-token` literal, see G5 fail, revert. No dedicated unit test (guard is itself a test). Scope excludes
`usermcp`/`docker` on purpose: flagged above for user decision; widening G5 there would fail on current code.

### 8. Docs (commit: `docs: CLI credentials rule, P429 iter2`)

- `CLAUDE.md`, add bullet after the open-source-libraries bullet:
  `- **Never touch a credential a driven CLI owns** (gh, az, acli, …): no token commands, config reads, or auth
  headers. Run the CLI, read its output. Facts in docs/ARCHITECTURE.md "CLI credentials: never touched".`
- `docs/ARCHITECTURE.md`:
  - `:1236` guard list G1-G4 becomes G1-G5; add one line for G5.
  - `:2017` `ChangeRequestComments` line: drop attachments wording; name `ReplyKinds`.
  - Comments (P429) section `:2111-2117`: rewrite. Drop `StageAttachment`/`DiscardAttachment`, staged-files line,
    attachment-links line, Azure attachments paragraph, drop zone/picker/paste wording. Keep one-post guard (now on
    `HostViewService`), window drop cancel, tests line. Add: composer is text only on every host.
  - New section before `## Renderer security surface` (~:3046):

    ```
    ## CLI credentials: never touched

    Kira drives gh, az and acli but never touches their credentials. It runs the CLI and reads its output (JSON or
    text). No token commands, no reads of CLI config or credential files, no auth headers on Kira's own HTTP.

    - gh: runner passes os.Environ through plus hygiene vars; never reads GH_TOKEN or GITHUB_TOKEN.
      `gh auth status --hostname` is parsed for the account name only.
    - az: env passthrough. `az account show --query user.name` only.
    - acli: env passthrough. `jira auth status` parsed for site and account only. Comment body goes through a 0600
      temp file.
    - Setup steps are copy-only commands the user runs in their own terminal.
    - Consequence: comments carry no attachments (no driven CLI uploads one; Azure would need a bearer token).
    - Guard G5 (internal/conventiontest) fails on token commands, credential env names, CLI config paths, auth
      headers, net/http and os.Getenv under githost/ and issuetracker/.
    ```
  - Known open items `:3295-3299`: replace the three attachment entries (Jira, GitHub, Azure az login) with one:
    "Comments carry no attachments (P429). Kira never touches a CLI's credentials, and none of gh, az, acli uploads
    a comment attachment. Add files on the host." Delete "Drag and drop is unverified". Edit "Comment posting is
    checked against documentation only": drop the Azure upload response.
- `docs/DEV_ENVIRONMENT.md:471`: delete the P429 attachment / `get-access-token` line.
- `docs/v0.2.24/SPEC.md` P429 row: title unchanged (`:15`). Replace Result (`:72`) with:
  "Post comments and replies on PRs and issues with a Markdown composer. No attachments on any host (user decision,
  iter2): Kira never touches a CLI's credentials, and no driven CLI uploads a comment attachment. Narrows the spec
  lines on attachments and drag and drop. Live acli post unverified (Known open items)."
  This drops the old "stored Atlassian token (v0.2.25)" follow-up, which the rule forbids. Remove any other SPEC
  cross-reference to that follow-up.

## Verification

Per commit (hook): typecheck, lint, Go vet/build.

Once after step 8:

- `go test ./apps/kira-space/internal/flows/githostflow ./apps/kira-space/internal/bridge ./internal/conventiontest`,
  then same with `-count=2` (fixture stability; `KIRA_CONTRACT` unset).
- `bun run test:flows:space`.
- `bun run lint`, `bun run lint:go`, `bun run lint:dead` (knip: no orphan export from deleted helpers),
  `bun run typecheck`.
- Bindings regenerated and committed: `git status` clean after rerunning the generator.
- Grep, zero hits outside docs and G5 itself: `get-access-token`, `StageAttachment`, `attachmentIds`,
  `HostViewAttachments`, `AttachmentMarkdown`, `comment-attach"` (except spec asserting count 0).
- Targeted UI first: `host-view-comments.spec.ts`, `issue-view.spec.ts`, `host-view*.spec.ts`.
- Then one full `bun run test:ui:space` run. After a fix, rerun failing and code-sharing specs only.

## Out of scope

- `usermcp` header use and `~/.docker/config.json` read (flagged above; user decides).
- Attachment upload via any host REST API (forbidden by rule).
