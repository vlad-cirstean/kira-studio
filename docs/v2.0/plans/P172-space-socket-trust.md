# P172: Space git socket trust (prepare script, git path, pairing identity)

Source: P168 Part 17 F5, F7. Stream B. Kira Space, its VS Code extension, `packages/git-ipc`,
`packages/git-core`, `packages/git-ui` (comment only), `packages/shared/domain/git.ts`, docs.
No Kira Studio file.

User decision (final): `kiraSpace.worktree.prepareScript` and the git path are writable only from
Kira Space itself. A paired socket client never writes either. A client may still create a
worktree; Space runs the script it already holds. The client cannot choose, change or supply what
runs. No client-echoed sha256 counts as approval.

## 1. Current behavior (read from source)

### Writers of the prepare script

| Writer | Path | Reaches |
|---|---|---|
| Paired socket client (VS Code extension, or any same-user process) | `repoSettings.set` over `git.sock`: `gitsock.Server.handleConn` (`server.go:201`) calls `Router.ForConn(...).Request` directly | `gitrpc/settings.go:92` `handleRepoSettingsSet` → `toModel` maps `WorktreePrepareScript` (`settings.go:60`) → `Registry.RepoSettingsSet` → `storage/repos/gitreposettings.go:119` |
| Space native graph mount (git-ui inside Space) | `repoSettings.set` over the Wails `git` stream: `bridge/gitstream.go:208` `ServeGitStream` | Refused already: `guardRepoSettingsSet` (`gitstream.go:181`) rejects any patch with `WorktreePrepareScript` or `WorktreeBasePath` |
| Space ADE repo settings (`frontend/src/ade/v2/repos/AdeRepoDetail.vue:33-36`) | Wails binding `AdeTaskService.UpdateRepo` (`bridge/adetask.go:500`) → `ade.TaskBoard.UpdateRepo` (`ade/repoconfig.go:51`) → `deps.SetRepoSettings` = `gitRouter.SetRepoSettings` (`main.go:470`, in-process Go call, `gitrpc/settings.go:124`) | Store directly. No socket, no gitrpc request dispatch |
| VS Code extension migration | `extension.ts:177` sends `repoSettings.set` with every `repoSettingKeys()` leaf the user set in `settings.json` | `repoSettingKeys()` includes `kiraSpace.worktree.prepareScript` (`git-core/settings/schema.ts:131`, `source: 'repo'`) |

git-ui never writes the prepare script in either host. `RepoSettingsDialog.vue` does not surface
it, and `WorktreeDialog.vue` only reads it. The dialog header's claim that it is "edited from
`WorktreeDialog.vue`" is false.

### Writers of the git path

| Writer | Path |
|---|---|
| Paired socket client | `settings.setGitPath` (`gitrpc/handlers.go:292`, `settings.go:134`) → `Deps.SetGitPath` (`main.go:578`) → `repositories.Settings.Set(Git.GitPath)` |
| Space Settings dialog (`frontend/src/workbench/settings/GitPane.vue:150`) | Wails `SettingsService.Set` (`bridge/settings.go:28`), in-process |
| Space native graph mount | Refused: not in `allowedMethods` (`gitstream.go:90`); `hostHandlers.ts:479` also refuses locally |
| VS Code extension | Only caller: one-time migration of legacy `kiraSpace.git.path` (`extension.ts:189-191`). `proxyHandlers.ts:625` throws for a webview call |

### Readers that run the script

- `worktree.prepare` (`gitrpc/worktree.go:87`) → `RepoEntry.RunPrepare` (`gitsession/worktree.go:461`).
  Order: claim slot, read stored script, compare sha256 of stored text to client `scriptSha256`
  (mismatch: `ScriptChanged`), verify path is a worktree of this repo, spawn. The sha is the only
  gate. With a client-writable store, a client writes a script, hashes it, and runs it.
- ADE worktree setup (`ade/setup.go:276-313`, `runSetup` `:329`) runs the stored script on branch
  creation and Retry setup. No sha check. In-process, Space's own action.

### Key answer: does Space's own UI share the socket path?

No. Both Space-owned writers are in-process Wails bindings (`AdeTaskService.UpdateRepo` →
`Router.SetRepoSettings`, `SettingsService.Set`). The native git-ui mount uses the Wails stream and
already refuses both writes. Every connection that dispatches through `Router.ForConn(...).Request`
is therefore a non-owner: a paired socket client or the native mount. No per-connection
distinction is needed. Enforce at the gitrpc request layer for all connections; keep the Go method
`Router.SetRepoSettings` (not a wire method) as the only write path for the prepare script.

### Dead or false claims

- `prepareScriptApprovedSha` exists nowhere in code. Claimed in `gitrpc/contract.go:78-81`,
  `git-ipc/src/contract.ts:89-91`, `git-ipc/src/validate.ts:71-73`, `git-core/src/settings/schema.ts:126-130`
  (plus the description text "any edit here requires re-approving it"), and noted as absent in
  `bridge/gitstream.go:107`.
- `docs/ARCHITECTURE.md:2853` calls the script "explicitly approved (sha256-pinned)".
- `docs/ARCHITECTURE.md:2689` says contract version 41. Code is 42.

### Pairing (F7)

- `hello.client.id`/`label` are client-asserted (`gitsock/handshake.go:111-112`). `hello.client.pid`
  is decoded and ignored.
- No peer credential check. Trust rests on the 0700 parent dir and 0600 socket (`server.go:113-118`).
- `Broker.answer` (`pairing.go:221`) on Approve resolves every other queued request with the same
  client id as Approved and hands each the same minted token (F6 design). A same-user process that
  dials with VS Code's client id (`vscode-<machineId>`, `connection.ts:121-125`) while a real VS
  Code window waits gets a valid token from the user's one click, unseen.
- The dialog (`GitPairingDialog.vue`) shows only the client-asserted label.
- The extension stores its token in `context.secrets`, shared by every window of one install
  (`connection.ts:38,349,433`).

## 2. Decisions

### D1. Prepare script: refuse on every gitrpc connection (decided by user, design here)

- `handleRepoSettingsSet` refuses any patch carrying `kiraSpace.worktree.prepareScript` with
  `E_READ_ONLY`, message `gitrpc: repoSettings.set: kiraSpace.worktree.prepareScript is set in Kira
  Space only`. Whole patch refused, nothing written, no `repoSettings.changed` emitted.
- Keep `WorktreePrepareScript` in Go `RepoSettingsPatchWire` only so presence is detectable (Go
  `json.Unmarshal` drops unknown keys silently; a silent drop would report success). Doc comment
  says so. `toModel` stops mapping it.
- TS: `RepoSettingsPatch = Partial<Omit<RepoSettingsSnapshot, 'kiraSpace.worktree.prepareScript'>>`
  so no typed client compiles a write. Snapshot keeps the leaf (read side unchanged).
- `Router.SetRepoSettings` (in-process, ADE) keeps writing it. It is not reachable from the wire.
- Native mount guard (`guardRepoSettingsSet`) stays as is: `WorktreeBasePath` still needs it, and
  the prepare-script half becomes defence in depth. Update its comment only.
- `WorktreeBasePath` stays client-writable on the socket. Out of the user's decision: it pre-fills
  a dialog path and runs nothing.

### D2. `worktree.prepare`: keep `scriptSha256` as a staleness guard, not approval

The store is now host-written only, so what runs is always a Space-authored script. The client
names a repo and a worktree path; it cannot choose the text. `scriptSha256` stays because it still
earns its keep: it refuses a run when Space changed the script after the VS Code dialog showed it,
so the VS Code user never runs text they did not see. Removing it would cost a contract change for
a weaker UX. Rewrite every comment that calls it approval (`gitsession/worktree.go:439-448`,
`gitrpc/wire.go:753-755`, `contract.ts:2222-2226`, `gitprepare/doc.go:19`). No behavior change, so
no new test; existing `ScriptChanged` tests stay.

### D3. Git path: delete `settings.setGitPath` from the contract (decided by user, design here)

No legitimate wire caller remains: the native mount refuses it and the extension's migration is
its only caller. Delete the method end to end rather than keep a method that always refuses.
Contract bump 42 → 43 (one bump for D1's type narrowing and D3's removal). The extension's
migration drops the git-path leg: when a legacy `kiraSpace.git.path` is set, show one
`vscode.window.showInformationMessage` naming the value and pointing at Kira Space Settings → Git,
then mark migration done. The migration also filters `kiraSpace.worktree.prepareScript` out of
its patch; otherwise D1 refuses the whole patch and the migration retries forever.

### D4. F7, recommended and in scope

1. **Approve admits only the presented request.** On Approve, siblings with the same client id
   resolve `PairingAborted` (close, no frame; the client backs off and redials) and get no token.
   Deny is unchanged: it still purges siblings as Denied and starts the cooldown (the safe
   direction). A real sibling VS Code window redials, reads the token the approved window stored in
   the shared `context.secrets`, and connects with no prompt. If its redial beats that store, it
   enqueues afresh and is prompted on its own. Approving it rewrites the row's hash, and that
   window stores its token into the same shared secret. Last writer wins in both places, so
   windows converge. This retires F6's token sharing; F6's original race (each window minting
   against one row) cannot recur, because one decision now mints exactly one token for one
   connection.
2. **Peer credentials at accept.** `Server.handleConn` reads the peer's uid and pid from the
   kernel before the handshake: Linux `SO_PEERCRED` (`unix.GetsockoptUcred`), macOS
   `LOCAL_PEERCRED` (`unix.GetsockoptXucred`, uid) plus `LOCAL_PEERPID` (`unix.GetsockoptInt`).
   Use `golang.org/x/sys/unix` (already in `go.mod` as indirect; becomes direct). Read the fd via
   `(*net.UnixConn).SyscallConn().Control`. A uid other than `os.Getuid()`, or a failed
   lookup, closes the connection with no frame (fail closed). Other platforms: build-tagged stub
   returns an error, so the connection closes. Space ships macOS only (`ARCHITECTURE.md:2660`);
   Linux covers dev and CI.
3. **Show the kernel-reported process in the pairing dialog.** Resolve the peer pid to an
   executable path with gopsutil (`process.NewProcess(pid).Exe()`, already a dependency, used
   by `internal/metrics`). Lookup failure still prompts, with the executable shown as unknown
   (fail visible, not silent). Carry `PeerPID`/`PeerExe` on `gitsock.PairingRequest` →
   `bridge.GitPairingRequest` (`peerPid`, `peerExe`) → `gitPairingRequestSchema` →
   `GitPairingDialog.vue`. The dialog marks the label as client-reported, e.g. "Says it is: <label>",
   and shows "Process: <exe> (pid <n>)" from the kernel. Tailwind utilities, no new primitive.

Together these meet the row's acceptance: a process replaying VS Code's client id is never admitted
by another window's approval, and its own prompt names its real executable.

### D5. F7, not recommended

- **Per-launch secret** (a random value in a 0600 file the client must present): every same-user
  process can read it, and other users are already blocked by the 0700 dir. No gain. Not planned.

### D6. F7, open user decisions (not in this plan; nothing half-built toward them)

1. **Bind a paired token to the peer's identity on every reconnect**, not only at pairing. Today a
   token is a bearer secret: any same-user process holding it connects. Options: (a) store the
   pairing-time executable path on `git_clients` and require a match (breaks on any VS Code
   update or relocation that changes the path); (b) on macOS, require the peer's code signature
   to match the one recorded at pairing (team ID via the Security framework; needs cgo or a
   library, and rules out unsigned forks unless allowed per row); (c) none: the token sits in VS
   Code's keychain-backed `context.secrets`, and a same-user process able to read that can also
   inject into VS Code itself.
2. **Is a same-user process in the threat model** beyond "the user sees an honest prompt"? The
   answer decides between D6.1 (a)/(b) and (c).

Recommendation for the orchestrator: after this plan lands, record D6 as `P172 Part 2` in
`SPEC.md`, or as a `Known open items` entry if the user picks (c). Step 5 below adds the
Known-open-items entry describing the bearer-token limit either way; delete it if Part 2 resolves it.

### Not in scope

- `capabilities.runPrepareScript: isWorkspaceTrusted()` and the extension manifest: P178 decides.
  This plan changes no workspace-trust plumbing.
- Letting Space's native git-ui run `worktree.prepare` (now safe, since the script is host-only).
  Not asked; stays refused at layer one.

## 3. Steps (one commit each, in order)

Fast checks per commit: `go build ./...`, `go vet`, the touched Go packages' tests, `bun run lint`
and typecheck for touched TS packages. Pre-commit hook must pass clean; no `--no-verify`.

### Step 1. `feat(space)!: refuse prepare-script writes from git socket clients`

- `apps/kira-space/internal/gitrpc/settings.go`: `handleRepoSettingsSet` validate closure returns
  `ipcerr.New("E_READ_ONLY", …)` when `p.Patch.WorktreePrepareScript != nil`. `toModel` drops the
  field. `SetRepoSettings` doc: the only prepare-script writer, in-process, never wire-reachable.
- `apps/kira-space/internal/gitrpc/wire.go`: `RepoSettingsPatchWire.WorktreePrepareScript` doc
  comment (decoded only to refuse). `WorktreePrepareParams` doc (D2).
- `apps/kira-space/internal/gitsession/worktree.go`: `RunPrepare` doc step 3 (D2 wording).
- `apps/kira-space/internal/gitprepare/doc.go`: line 19 wording (staleness guard).
- `apps/kira-space/internal/bridge/gitstream.go`: `allowedMethods` and
  `repoSettingsSetTouchesRestrictedField` comments: drop the `prepareScriptApprovedSha` sentence;
  state that the Router refuses the prepare script on every connection and this guard keeps it as
  defence in depth plus `WorktreeBasePath`.
- `apps/kira-space/internal/bridge/gitstream_classification_coverage_test.go`: comment only.
- `apps/kira-space/internal/gitrpc/contract.go`: rewrite the G25 history note's
  `prepareScriptApprovedSha` sentence (`:78-81`) to "the prepare script is written only in-process
  by Kira Space (P172); `repoSettings.set` refuses it".
- `packages/git-ipc/src/contract.ts`: `RepoSettingsPatch` → `Partial<Omit<…, 'kiraSpace.worktree.prepareScript'>>`;
  rewrite the leaf doc (`:85-92`) and `worktree.prepare` doc (`:2222-2226`) per D1/D2.
- `packages/git-ipc/src/validate.ts`: rewrite `:69-73` history sentence.
- `packages/git-core/src/settings/schema.ts`: comment `:126-130` and the description string
  (drop "any edit here requires re-approving it"; say it is set in Kira Space's repo settings).
- `packages/git-ui/src/components/dialogs/RepoSettingsDialog.vue`: header comment (`:6-8`): the
  leaf is read-only in git-ui and set in Kira Space.
- `apps/kira-space-vscode/src/extension.ts`: `migrateLegacySettings` skips
  `kiraSpace.worktree.prepareScript` when building the patch (and from the "anything to migrate"
  check), with a one-line comment why.
- Tests (`apps/kira-space/internal/gitrpc/settings_test.go`), via `ForConn(...).Request` like the
  existing tests:
  - prepare script alone → `E_READ_ONLY`; stored value unchanged; no `repoSettings.changed`
    delivered to a second connection.
  - prepare script plus an allowed leaf (`graph.pageSize`) → `E_READ_ONLY`; neither leaf written.
  - `Router.SetRepoSettings` with a prepare script writes it and fans out `repoSettings.changed`
    (the host path still works).
- Test (`apps/kira-space/internal/gitsock/settings_test.go`): over a real socket with a paired
  client, `repoSettings.set` with the prepare script → `E_READ_ONLY`, then `worktree.prepare` with
  any sha → `NotConfigured` (nothing stored, nothing spawned). This pins the acceptance end to end
  on the socket path.

### Step 2. `feat(space)!: remove settings.setGitPath from the git socket contract`

- `apps/kira-space/internal/gitrpc/handlers.go`: delete the `settings.setGitPath` entry
  (`:292-294`) and `Deps.SetGitPath` (`:29-33`); fix the `requestHandler` comment (`:157`).
- `apps/kira-space/internal/gitrpc/settings.go`: delete `handleSettingsSetGitPath`.
- `apps/kira-space/internal/gitrpc/wire.go`: delete `SettingsSetGitPathParams`.
- `apps/kira-space/internal/gitrpc/handle.go`: `handleCall` comment drops `settings.setGitPath`.
- `apps/kira-space/internal/gitrpc/contract.go`: `ContractVersion = 43` plus a P172 history entry
  naming both changes (prepare-script patch leaf refused, `settings.setGitPath` removed).
- `apps/kira-space/main.go`: delete the `SetGitPath` wiring (`:578-581`).
- `apps/kira-space/internal/bridge/gitstream.go`: `allowedMethods` comment: two refused methods
  remain (`worktree.prepare`, `worktree.cancelPrepare`); method counts updated to match the real
  dispatch table (count it, do not guess).
- `apps/kira-space/internal/bridge/gitstream_test.go`: drop `settings.setGitPath` from
  `writeMethods`; fix its comment.
- `apps/kira-space/internal/gitrpc/settings_test.go`: delete `TestHandleSettingsSetGitPath` and
  `_NotWired`. Add: `ForConn(...).Request("settings.setGitPath", …)` → `E_UNKNOWN_METHOD`
  (pins that no connection can set the git path).
- `packages/git-ipc/src/contract.ts`: delete the `settings.setGitPath` method.
- `packages/git-ipc/src/validate.ts`: `CONTRACT_VERSION = 43` plus history entry; delete the
  `'settings.setGitPath': true` entry (`:270`).
- `packages/git-ipc/src/rpc.test.ts`: drop the `settings.setGitPath` handler entry.
- `apps/kira-space/frontend/src/repo/git/hostHandlers.ts`: delete the `refuseLocally` entry
  (`:479-482`).
- `apps/kira-space-vscode/src/proxyHandlers.ts`: delete the throwing entry (`:621-629`).
- `apps/kira-space-vscode/src/extension.ts`: migration's git-path leg becomes the D3 information
  message; update the function doc comment (`:120-130`).
- Grep for any literal `42` contract assertion in tests (`rg -n "\b42\b"` in the files listing
  `ContractVersion`/`CONTRACT_VERSION`) and fix.

### Step 3. `fix(space): pairing approval admits only the presented request`

- `apps/kira-space/internal/gitsock/pairing.go`: `answer` on Approve mints one token for the head
  only; siblings get `PairingAborted`, no token. Deny path unchanged. Rewrite the `approvedToken`,
  `Approve`/`Deny` and `answer` comments (F6 sharing removed, P172 reason).
- `apps/kira-space/internal/gitsock/handshake.go`: comments at `:154-157` (F6 wording).
- `apps/kira-space/internal/gitsock/pairing_test.go`: replace
  `TestBroker_ApproveResolvesEveryOtherQueuedRequestFromTheSameClientWithTheSameToken` with: Approve
  on the head → head Approved with a token; a same-client sibling → `PairingAborted`,
  `TakeApprovedToken` false; a different-client request stays queued. Keep the Deny-purges-siblings
  test.

### Step 4. `feat(space): read git socket peer credentials and show them when pairing`

- New `apps/kira-space/internal/gitsock/peercred_linux.go`, `peercred_darwin.go`,
  `peercred_other.go` (`//go:build !linux && !darwin`, returns an error): `peerCred(nc net.Conn)
  (peer, error)` with `peer{UID int; PID int}`. A non-`*net.UnixConn` returns an error.
- New `apps/kira-space/internal/gitsock/peer.go`: `peerExe(pid int) string` via gopsutil, `""` on
  failure.
- `apps/kira-space/internal/gitsock/server.go`: `handleConn` calls `peerCred` before
  `runHandshake`; uid mismatch or error closes with no frame and a `slog.Warn`. Pass
  `Peer{PID, Exe}` in `handshakeDeps`.
- `apps/kira-space/internal/gitsock/handshake.go`: `handshakeDeps.Peer`; `Broker.Request` call
  passes it.
- `apps/kira-space/internal/gitsock/pairing.go`: `Request(clientID, label string, peer Peer, …)`;
  `PairingRequest.PeerPID`/`PeerExe`. Update every caller (tests included).
- `apps/kira-space/internal/bridge/gitclients.go`: `GitPairingRequest.PeerPID`/`PeerExe`
  (`peerPid`, `peerExe`) in `toWireSnapshot`.
- `packages/shared/domain/git.ts`: `gitPairingRequestSchema` gains `peerPid: z.number()`,
  `peerExe: z.string()`.
- `apps/kira-space/frontend/src/workbench/GitPairingDialog.vue`: label shown as client-reported;
  kernel-reported process line; `peerExe === ''` reads "unknown executable".
- `go.mod`: `golang.org/x/sys` moves from indirect to direct (`go mod tidy`).
- Test (`apps/kira-space/internal/gitsock/server_test.go` or `integration_test.go`, real socket):
  the test process dials the server with an unknown token; the broker's pending
  `PairingRequest` carries `PeerPID == os.Getpid()` and `PeerExe` equal to `os.Executable()`
  after `filepath.EvalSymlinks` on both. This guards the per-platform syscall plumbing, the part
  easy to get wrong. The uid comparison itself is a single `if`, so it gets no dedicated test.
- Update every existing `handshake_test.go`/`pairing_test.go` call site for the new `Request`
  signature (zero `Peer` is fine there).

### Step 5. `docs: record P172 socket trust model`

`docs/ARCHITECTURE.md`:
- Pairing paragraph (`:2671-2686`): kernel peer credentials (uid check, pid, executable shown in
  the prompt); the label is client-reported; one Approve admits one connection; siblings redial and
  reuse the shared stored token.
- Contract version paragraph (`:2688-2689`): 43, since P172.
- `gitprepare` paragraph (`:2849-2858`): replace "explicitly approved (sha256-pinned)" with: the
  script is written only by Kira Space in-process (ADE repo settings); `repoSettings.set` refuses
  it on every gitrpc connection; `worktree.prepare`'s sha256 is a staleness guard.
- Native graph layers (`:3317-3339`): refused methods are `worktree.prepare`/`cancelPrepare` only;
  `settings.setGitPath` no longer exists; drop "no human-approval gate anywhere"; use the real
  method counts from step 2. Update layer two's list (`settings.setGitPath` gone).
- Known open items: one entry for D6 (a paired token is a bearer secret, not bound to the peer's
  identity on reconnect; delete when a P172 Part 2 resolves it).
- Grep the doc for any other `setGitPath`, `prepareScriptApprovedSha`, `sha256-pinned` and fix.

Phase end: run the full Go suite for `apps/kira-space/...`, `bun run test` for `packages/git-ipc`,
`packages/git-core`, `packages/git-ui`, `apps/kira-space-vscode`, and the Space typecheck/lint.
Real VS Code host checks (migration message, sibling-window redial) need a real VS Code host,
which the sandbox lacks. Record that in the result section; do not claim it verified.

## 4. File ownership (Stream B)

| File | Step |
|---|---|
| `apps/kira-space/internal/gitrpc/settings.go` | 1, 2 |
| `apps/kira-space/internal/gitrpc/settings_test.go` | 1, 2 |
| `apps/kira-space/internal/gitrpc/wire.go` | 1, 2 |
| `apps/kira-space/internal/gitrpc/handlers.go` | 2 |
| `apps/kira-space/internal/gitrpc/handle.go` | 2 |
| `apps/kira-space/internal/gitrpc/contract.go` | 1, 2 |
| `apps/kira-space/internal/gitsession/worktree.go` | 1 (comment) |
| `apps/kira-space/internal/gitprepare/doc.go` | 1 (comment) |
| `apps/kira-space/internal/bridge/gitstream.go` | 1, 2 (comments) |
| `apps/kira-space/internal/bridge/gitstream_test.go` | 2 |
| `apps/kira-space/internal/bridge/gitstream_classification_coverage_test.go` | 1 (comment) |
| `apps/kira-space/internal/bridge/gitclients.go` | 4 |
| `apps/kira-space/internal/gitsock/settings_test.go` | 1 |
| `apps/kira-space/internal/gitsock/pairing.go`, `pairing_test.go` | 3, 4 |
| `apps/kira-space/internal/gitsock/handshake.go`, `handshake_test.go` | 3, 4 |
| `apps/kira-space/internal/gitsock/server.go`, `server_test.go` or `integration_test.go` | 4 |
| `apps/kira-space/internal/gitsock/peercred_{linux,darwin,other}.go`, `peer.go` (new) | 4 |
| `apps/kira-space/main.go` | 2 |
| `apps/kira-space/frontend/src/repo/git/hostHandlers.ts` | 2 |
| `apps/kira-space/frontend/src/workbench/GitPairingDialog.vue` | 4 |
| `apps/kira-space-vscode/src/extension.ts` | 1, 2 |
| `apps/kira-space-vscode/src/proxyHandlers.ts` | 2 |
| `packages/git-ipc/src/contract.ts`, `validate.ts`, `rpc.test.ts` | 1, 2 |
| `packages/git-core/src/settings/schema.ts` | 1 |
| `packages/git-ui/src/components/dialogs/RepoSettingsDialog.vue` | 1 (comment) |
| `packages/shared/domain/git.ts` | 4 |
| `go.mod` | 4 (one line) |
| `docs/ARCHITECTURE.md` | 5 |
| `docs/v2.0/plans/P172-space-socket-trust.md` | this plan, result section |

### Overlap with concurrent streams

- P174 (Stream A: Studio Go adapters, dbmcp, grid, console) and P175 (Stream C: Studio API client,
  cookie jar): no shared source file. Kira Studio does not import `@kira/git-ipc` or `gitrpc`
  (checked), so the contract bump does not touch Studio.
- Possible shared files, not source conflicts:
  - `go.mod`: step 4 changes one line (`x/sys` indirect → direct). If Stream A also edits
    `go.mod`, rebase resolves by keeping both edits, then `go mod tidy`.
  - `docs/ARCHITECTURE.md`: step 5 touches only the Kira Space git sections and adds one Known
    open items entry. A rebase conflict there is textual only.
  - `packages/shared/domain/git.ts`: Space git domain only; neither Studio phase names it.
- No ordering dependency on Stream A or C.
