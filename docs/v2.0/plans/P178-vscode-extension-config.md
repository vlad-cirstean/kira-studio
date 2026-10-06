# P178: VS Code extension decisions (workspace trust, credential prompts, config ownership)

Source: P168 Part 23 F11, F9 (server half). Row: `docs/v2.0/SPEC.md` "P178 VS Code extension
decisions". Stream A, one sequential implementer. Kira Space, its VS Code extension,
`packages/git-ipc`, `packages/git-core`, `packages/git-ui`, docs. No Kira Studio file.

User decisions (final):

1. Manifest declares `capabilities.untrustedWorkspaces: { supported: false }`. Delete the dead
   workspace-trust plumbing. P172 already made the prepare script and git path Space-written only.
2. Credential prompts open in Kira Space only. The extension shows nothing; no `credential.cancel`.
3. Audit the extension for other config, setting, migration or prompt UI; move each to Space only
   or keep with a stated reason.

**Blocked on P173.** P173 (Stream C, `docs/v2.0/plans/P173-space-git-contract.md`) is mid-flight
and touches the same files (see "Overlap with P173"). Start only after P173's last commit is on the
chapter branch. Rebase this branch onto it first. Bump the contract from P173's landed number.

## 1. Current behavior (read from source at `2ab0304`)

### Workspace trust (F11)

- `apps/kira-space-vscode/package.json`: no `capabilities` key. VS Code then disables the extension
  in Restricted Mode, so `vscode.workspace.isTrusted` is always `true` while extension code runs.
- `extension.ts:347-349` (comment), `:427` `isWorkspaceTrusted: () => vscode.workspace.isTrusted`.
- `proxyHandlers.ts:89-95` (dep field + doc), `:206`, `:251-254`
  `runPrepareScript: isWorkspaceTrusted()`.
- Test stubs: `proxyHandlers.test.ts:48,228,416,492`, `testing/stubHost.ts:32`.
- `onDidGrantWorkspaceTrust`: zero hits in the repo. Nothing to delete there.
- `capabilities.runPrepareScript` is not dead as a field. Space's native host sends `false`
  (`frontend/src/repo/git/hostHandlers.ts:209`) because the native stream refuses `worktree.prepare`
  at layer one (`bridge/gitstream.go`). `WorktreeDialog.vue:57-61,227,391,427` reads it. Only the
  VS Code value's trust derivation is dead.

### Credential prompt path today

- `gitaskpass.Broker.WithOp` (`internal/gitaskpass/broker.go:161`) relays each askpass prompt to a
  `Prompter`. The one production `Prompter` is `gitsession.repoPrompter` (`gitsession/remote.go:87`),
  which calls `Conn.AskCredential` (`gitsession/conn.go:159`). That emits `credential.request` on the
  op's own connection and waits on answer, op ctx, or `c.done`. Broker bound: 120 s
  (`gitaskpass.DefaultTimeout`).
- Three `Conn` kinds reach it:
  - **Socket client** (`gitsock/server.go:252` `NewConn(..., clientID, label, nil)`): event goes over
    `git.sock` to the extension. `extension.ts:563-586` serialises prompts into
    `ports/credentialPrompt.ts` (`createInputBox`), aborts on leaving `connected`
    (`connectionLifetime`, `:357`, `:638-639`), answers with `credential.provide`.
  - **Native stream** (`bridge/gitstream.go`, one `Conn` per repo workspace tab): event reaches
    `frontend/src/repo/git/transport.ts:143`, queued in `state/gitCredential.ts`, shown by
    `workbench/GitCredentialDialog.vue` (always mounted in `App.vue:76`).
  - **ADE board** (`ade/board.go:149`, one `Conn`): `handleEmit` `case "credential.request"`
    (`board.go:215`) calls `deps.OnCredential` → `bridge.AdeTaskCredentialRequested`
    (`bridge/adetask.go:71`) → `EmitFocused(kira:adetask:credential)` → `ade/queries.ts:94` enqueues
    into the same `gitCredential` store. Answer: `AdeTaskService.ProvideCredential`.
- `EmitFocused` (`internal/shell/wails.go:55`) sends to `app.Window.Current()` only and drops the
  event when that is nil. With Space in the background or windowless, an ADE prompt is lost and git
  waits the full 120 s.
- Pairing precedent (`gitsock/pairing.go`): `notify.PendingQueue` + `notify.OrderedEmitter`
  snapshot, broadcast on `kira:git:pairing`, hydrated on window mount (`state/gitClients.ts`
  `hydrateThenSubscribe`). A request held with no window open shows when a window next mounts. It
  never brings a window forward.
- Space keeps running with zero windows (`main.go:267`
  `ApplicationShouldTerminateAfterLastWindowClosed: false`); Dock click reopens
  (`shell.AttachReopen` → `shell.ReopenWindows`). `shell.WindowRegistry` has `Count`, `Keys`,
  `Focus(key)` (Show + UnMinimise + Focus, safe from any goroutine).
- `packages/git-core/src/ports/credentialPrompt.ts`: port's only implementer is the extension's.

### Extension config/settings/prompt audit (full list)

| # | Item | Where | Stored by | Verdict |
|---|---|---|---|---|
| A1 | Credential input box, queue, abort-on-disconnect | `extension.ts:352-357,563-586,636-640`; `ports/credentialPrompt.ts`; git-core port | none | Move to Space (decision 2). Delete. |
| A2 | Legacy settings migration (`migrateLegacySettings`) + `kiraSpace.git.path` info message | `extension.ts:90-209,367` | writes Space's `git_repo_settings` over the socket | Delete. Writes Space-owned config from a client; `kiraSpace.worktree.prepareScript` already skipped (P172). One-shot G18 leg; the socket refuses `repoSettings.set` after Step 5 anyway. Orphan `globalState` flag left in place: inert, deleting it needs its own migration code. |
| A3 | `readRawSettings` of every `SETTINGS` key from `settings.json` | `extension.ts:79-88,340-343,684-706` | VS Code `settings.json` (keys undeclared: manifest has no `contributes.configuration`) | `source: 'repo'` keys: delete the read. Their values are ignored by git-ui (it reads `repoSettings.get`); app.init's `SettingsSnapshot` holds only `workbench.tree.indent`. Keep reading `source: 'host'` keys (`workbench.tree.indent`): a VS Code fact mirrored for layout. |
| A4 | Extension log level from `kiraSpace.log.level` in `settings.json` | `extension.ts:343`, `ports/logger.ts` | VS Code `settings.json`, undeclared key | Keep a VS Code-native control, drop the setting. Use `vscode.LogOutputChannel` (`createOutputChannel(name, { log: true })`); VS Code's own "Developer: Set Log Level…" governs it. Library over hand-rolled level filter. This log is the extension host's own process log: VS Code-specific. |
| A5 | Per-repo `kiraSpace.log.level` leaf + RepoSettingsDialog "Diagnostics" section (shown only off `'kira'`) | git-core `schema.ts:88-95`; contract `RepoSettingsSnapshot`; Go `wire.go:569,597`, `settings.go:29,59`, `model/gitreposettings.go`, `repos/gitreposettings.go:62,117`; `RepoSettingsDialog.vue` | Space `git_repo_settings` | Delete leaf and section. No reader anywhere: Go only round-trips it; Space uses app-wide `advanced.gitLogLevel`; the extension read `settings.json` (A4), not this. |
| A6 | Repository settings dialog in the VS Code webview (gear `repo-settings-button`, `RepoSettingsDialog.vue`: page size, scope, auto-stash, stash, base candidates, GitHub, pull strategy) | git-ui `AppToolbar.vue:461`, `App.vue:2060`; writes `repoSettings.set` over the socket | Space `git_repo_settings` | Move to Space only. Hide under VS Code via a new capability; refuse `repoSettings.set` from socket clients server-side. Space edits these in its native graph's same dialog and ADE repo detail. |
| A7 | Display section `dateFormat` in RepoSettingsDialog (VS Code/harness only) | `RepoSettingsDialog.vue`, `PersistedViewState.dateFormat` | VS Code webview state | Unreachable once A6 hides the dialog. **User decision U2** (§3). |
| A8 | Worktree base path / prepare script in VS Code | `WorktreeDialog.vue` reads both | Space | Keep read-only use. Pre-fill and script display read Space config; no write path (P172 + A6 refusal). |
| A9 | WorktreeDialog "run prepare script" first-run confirmation | `WorktreeDialog.vue` | session-only | Keep. Confirms an op the user started in that window, like every other git-ui op dialog. Approval of *what* runs is Space's (P172). |
| A10 | git-ui op dialogs (checkout, stash, reset, force push, stack, …) | git-ui | none | Keep. Operation UI, not config. |
| A11 | `showConnectionStatus` messages, pairing "waiting for approval in Kira Space" | `extension.ts:710-758` | none | Keep. Reports this window's own connection. Approval already lives in Space. |
| A12 | `openRepository` quick pick + result messages | `extension.ts:760-803` | none | Keep. Picks among this window's VS Code workspace folders. |
| A13 | Diff toolbar, review comment, review marking messages | `diffToolbar.ts`, `reviewComments.ts`, `reviewMarking.ts` | Space (comments/marks) via ops | Keep. Feedback on an editor action in VS Code. |
| A14 | Pairing token (`context.secrets`), client id (`globalState`), review session (`workspaceState`) | `connection.ts`, `extension.ts:442` | VS Code | Keep. VS Code-side identity and per-window view state. |
| A15 | Manifest `colors`, `keybindings`, `commands`, `menus`, views | `package.json` | VS Code | Keep. VS Code theming/command surface. |

**Criterion.** Config stored by Kira Space (kira.db: repo settings, app settings, prepare script,
git path) is edited only in Kira Space, and every prompt that answers a Space-held operation
(credentials, pairing) opens only in Kira Space. The extension keeps UI that acts on, or reports,
something VS Code itself owns: its editors and diffs, its workspace folders, its connection, its
own log, its secrets/state, and confirmation of an op the user just started in that window.

## 2. Decisions

### D1. Manifest and trust plumbing

- `package.json`: `"capabilities": { "untrustedWorkspaces": { "supported": false, "description":
  "Kira Space runs git operations, and Kira Space's repository prepare script, for this
  workspace's folders." } }`.
- Delete `isWorkspaceTrusted` (dep, field, docs, stubs). VS Code sends
  `capabilities.runPrepareScript: true` as a constant. Comment: the extension only runs in a trusted
  workspace (manifest); Space runs only the script it stores (P172). Field stays in the contract:
  the native host still sends `false`.
- Real-host check (extension stays disabled until trust is granted, then activates) is P180's.

### D2. One Space credential relay for every Space-held prompt that has no window of its own

New package `apps/kira-space/internal/gitcred` (stdlib + `internal/notify` + `gitaskpass`):

- `Relay` holds pending prompts in a `notify.PendingQueue[*entry]` and publishes snapshots through
  `notify.OrderedEmitter[Snapshot]` (pairing's exact pair; no new mechanism).
- `Prompt` wire shape: `{ requestId, source, repoLabel, prompt, masked }`. `source` is the
  connection's client label (a VS Code client label, or `"Kira Space ade"`). `repoLabel` is
  `filepath.Base(Summary.Root)`, falling back to `filepath.Base(Summary.GitDir)` for a bare repo.
  Never logged; same handling as today's payload.
- `Ask(ctx, source string, req gitaskpass.Request) (string, bool)`: mint id (crypto/rand 16 bytes,
  as `newCredentialRequestID`), enqueue, emit, call `onAdded`, select on answer / ctx; every exit
  removes the entry and emits. Returns `("", false)` for every unanswered outcome (contract of
  `gitaskpass.Prompter`).
- `Provide(requestID string, secret *string) bool`: delete-under-lock then send/close, exactly
  `Conn.ProvideCredential`'s anti-abuse order. Unknown or answered id: `false`, never an error.
- `Pending() Snapshot`, `Subscribe(fn) (unsubscribe func())`.
- Withdrawal by broker timeout, op cancel or client disconnect removes the entry and emits, so every
  Space window closes the stale dialog. This is F9's server-driven cancel, for the only host that
  still prompts.

Routing hook on `gitsession.Conn`: `RouteCredentials(fn func(ctx context.Context, req
gitaskpass.Request) (string, bool))`, called once before the `Conn` serves (same happens-before
rule as `DisableAutoFetch`). When set, `AskCredential` derives a ctx cancelled by `c.done` and
delegates; no `credential.request` is emitted on that connection. `repoPrompter` gains the repo
label (field on `gitaskpass.Request`: `RepoLabel string`, set in `withAskpass`).

Who routes into the relay:

- **Socket clients** (`gitsock/server.go` `handleConn`): always. Decision 2.
- **ADE board** (`ade/board.go`): yes. Replaces `EmitFocused`, which drops a prompt when no window is
  key (§1). Removes the parallel `kira:adetask:credential` path.
- **Native stream conns**: unchanged. The stream exists only while a window has that workspace
  mounted, so its prompt always has a window; its per-workspace drop on tab close
  (`dropCredentialRequests`) stays correct.

### D3. Space UI

- Bridge: `GitCredentialService` (`bridge/gitcredential.go`): `Pending() []GitCredentialPrompt`,
  `Provide({requestId, secret}) bool` (validate id non-empty, `ipcerr.BadRequest`), push channel
  `ChannelGitCredential = "kira:git:credential"` in `bridge/events.go`, broadcast to every window
  (pairing's `AttachPush` shape).
- Renderer: extend the existing `gitCredential` store (same concern: the credential prompt queue;
  no second store). Add `syncRelayPrompts(list)`: add unseen ids in list order; drop vanished ids
  from the queue; if the active entry vanished, clear it and pump the next. Hydrate at boot with
  `hydrateThenSubscribe` beside `hydrateGitClients()` in `main.ts`. Pinia + snapshot push, not
  TanStack Query: the queue holds answer closures and drives one always-mounted dialog with no
  loading/error UI; this mirrors pairing.
- `PendingCredential` gains optional `relayId` and `label`. `GitCredentialDialog.vue` shows
  `label` (`"<source> · <repoLabel>"`) when present, else the code-repo name as today.
- Every window shows the head prompt; the first answer wins; the snapshot closes the rest.

### D4. Surfacing when Space is in the background or windowless

- **Window open, Space not frontmost (or minimised):** on every `onAdded`, focus the first live
  window via `WindowRegistry.Focus(Keys()[0])` (Show + UnMinimise + Focus). Reason: the op was
  started elsewhere and nothing else tells the user to switch; the dialog is useless unseen. No OS
  notification: Space has no notification infrastructure, and bringing the window forward already
  surfaces it. Whether macOS activates Space over VS Code (not just orders the window) is
  unverified here; P180 checks it on a Mac.
- **No window open:** **user decision U1** (§3). Plan implements the recommendation behind one
  `onAdded` branch in `main.go`.

### D5. Repository settings are Space-only

- New capability `capabilities.editRepoSettings: boolean`: Space native `true`, VS Code `false`.
  git-ui hides the toolbar gear and does not mount `RepoSettingsDialog` when `false`.
- `gitsock` refuses `repoSettings.set` from socket clients with `E_READ_ONLY` ("repository settings
  are set in Kira Space"). Enforcement lives in `gitsock` (a small method denylist wrapping
  `handlers.Request`), not the Router: Space's native stream uses the same Router and must keep
  writing. The same wrapper refuses `credential.provide` (nothing to answer on a socket conn after
  D2; an explicit refusal beats a silent `false`).
- `repoSettings.get` and `repoSettings.changed` stay for clients: git-ui reads page size, scope,
  auto-stash, etc. in VS Code.
- With the dialog gone from VS Code, its `host` prop and the host-conditional Display/Diagnostics
  sections have no remaining reader except the harness. Delete Diagnostics (D6). Display: per U2.

### D6. Dead per-repo log level removed; extension log via `LogOutputChannel`

As audit A4/A5. Stored `logLevel` rows in `git_repo_settings` stay unread and inert: `Get` reads
leaves by name, and deleting them needs a migration for no behavioural gain.

### D7. Contract

One bump for the phase: P173's landed `CONTRACT_VERSION`/`ContractVersion` + 1 (expected 44 → 45).
Both numbers equal (`ARCHITECTURE.md`'s bump checklist). History entry in `contract.go` and
`validate.ts` names every change:

- behaviour: socket clients never receive `credential.request`; `credential.provide` and
  `repoSettings.set` refused on `git.sock`;
- `AppInitResult.capabilities.editRepoSettings` added;
- `RepoSettingsSnapshot`/`RepoSettingsPatch` lose `kiraSpace.log.level`;
- if U2 = (a): `ServerAppInitResult.dateFormat` and `AppInitResult.dateFormat?` added.

`credential.request`/`credential.provide` stay in the contract: the native stream uses both. Rewrite
their doc comments (`contract.ts:2075-2081`, `:2322-2330`) to say socket clients never see them.

## 3. Open user decisions (resolve before Step 3 / Step 7)

**U1. A socket client's credential prompt arrives and no Space window is open.**
Recommended: (a) open a window the way a Dock click does (`shell.ReopenWindows(winDeps)`), then the
mount-time hydrate shows the prompt. The user started a push in VS Code and is waiting on it.
Alternative: (b) hold it, pairing-style: shown when the user next opens a Space window; if nobody
does within 120 s, git fails with an auth error that VS Code's op UI reports. The extension shows
nothing in either case (decision 2). Plan implements (a); with (b), `onAdded` focuses only when
`Count() > 0`. Not decided by the planner.

**U2. VS Code graph date format once the repo-settings dialog is hidden.**
Recommended: (a) follow Kira Space's app-wide `appearance.dateFormat`, read at each `app.init`
(Space's own mount reads it once, same freshness). Go `gitrpc.Deps.DateFormat func() string` wired
from Space settings in `main.go`; `ServerAppInitResult.dateFormat`; extension passes it into
`AppInitResult.dateFormat?`; `App.vue` bootstrap: `props.dateFormat ?? init.dateFormat ??
persisted`. Delete the Display section and `RepoSettingsDialog`'s `host`/`dateFormat` props.
Alternative: (b) keep a VS Code-local preference in webview state, with a minimal VS Code-only
surface that keeps only the Display section. Step 7 runs only for (a); with (b), Step 7 keeps the
Display section reachable under VS Code instead. Not decided by the planner.

## 4. Steps (one commit each, in order)

Precondition: P173 landed on the chapter branch; this branch rebased onto it. Per commit: `go build
./...`, `go vet`, touched Go packages' tests, `bun run lint` + typecheck for touched TS packages.
Wails bindings: regenerate per `docs/DEV_ENVIRONMENT.md` whenever a bound service or its types
change (Steps 2, 4). Hook must pass clean; never `--no-verify`.

### Step 1. `feat(vscode)!: require a trusted workspace, drop dead trust plumbing`

- `apps/kira-space-vscode/package.json`: D1 `capabilities` block.
- `src/extension.ts`: drop `:347-349` comment wording about the trust probe, `:427`.
- `src/proxyHandlers.ts`: drop `isWorkspaceTrusted` from `CreateProxyHandlersDeps` (`:89-95`) and
  destructure (`:206`); `runPrepareScript: true` with D1 comment.
- `src/proxyHandlers.test.ts` (4 sites), `src/testing/stubHost.ts:32`: drop the stub.
- `packages/git-ui/src/components/dialogs/WorktreeDialog.vue:57-61`: doc says `false` only for
  Space's native host (layer-one refusal), no trust gate.
- No contract change. Test: none (deletion; typecheck proves no reader left).

### Step 2. `feat(space): credential relay and its Space prompt UI`

Relay exists and is shown; nothing routes into it yet.

- New `apps/kira-space/internal/gitcred/relay.go` (D2).
- New `apps/kira-space/internal/gitcred/relay_test.go`: concurrency earns it. Cases: answer reaches
  `Ask`; dismissal (`nil`) returns `false`; ctx cancel removes and emits; double `Provide` is a
  no-op `false`; snapshot order is FIFO across concurrent `Ask`s; `onAdded` fires once per entry.
  Run with `-race`.
- `internal/bridge/events.go`: `ChannelGitCredential`.
- New `internal/bridge/gitcredential.go`: `GitCredentialService` + `AttachPush` (D3).
- `apps/kira-space/main.go`: construct the relay before `wireGit`; register the service; attach
  push; `onAdded` = D4 (U1 branch).
- `packages/shared/domain/git.ts` (beside `GitPairingSnapshot`): `GitCredentialPrompt`.
- `frontend/src/bridge/index.ts`: `gitCredentialPending`, `gitCredentialProvide`,
  `onGitCredentialChanged`.
- `frontend/src/state/gitCredential.ts`: `syncRelayPrompts`, `hydrateRelayPrompts`
  (`hydrateThenSubscribe`); `PendingCredential.relayId?`, `label?`.
- `frontend/src/main.ts`: call `hydrateRelayPrompts()` beside `hydrateGitClients()`.
- `frontend/src/workbench/GitCredentialDialog.vue`: label line (D3). Tailwind utilities only.
- `apps/kira-space/tests/unit/git-credential-queue.spec.ts`: sync cases (vanished active pumps next;
  vanished queued entry removed; stale answer after withdrawal is a no-op; re-sync is idempotent).
- Bindings regenerated.

### Step 3. `feat(space,vscode)!: socket clients' credential prompts open in Kira Space only`

- `internal/gitaskpass/prompt.go`: `Request.RepoLabel`.
- `internal/gitsession/conn.go`: `RouteCredentials`; `AskCredential` delegation (D2).
- `internal/gitsession/remote.go`: `repoPrompter` sets `RepoLabel`.
- `internal/gitsock/server.go`: `Deps.Credentials *gitcred.Relay` (required; tests build a real
  relay, no nil fallback); `handleConn` calls
  `gconn.RouteCredentials` bound to `label`; method denylist wrapper refusing `credential.provide`
  (D5's `repoSettings.set` joins in Step 5).
- `main.go`: pass the relay into `gitsock.Deps`.
- `internal/gitsock/remote_test.go`: rewire every credential test (`:29`, `:145-277`, `:801-817`)
  to answer through `Relay.Provide` and observe `Relay.Subscribe`; disconnect case asserts the entry
  is withdrawn. Add one assertion that the socket client receives no `credential.request` event.
- `internal/gitsession/remote_test.go`, `concurrency_test.go`: add the routed path to the existing
  four-exit test if it does not already cover a delegating `Conn` (ctx, `c.done`).
- Extension: delete `src/ports/credentialPrompt.ts`; in `extension.ts` drop the import, `:352-357`,
  the `credential.request` subscription (`:558-586`), and `connectionLifetime` abort (`:636-640`).
  `proxyHandlers.ts:539-547`: keep the total-map throw, comment "answered in Kira Space only".
- `packages/git-core/src/ports/credentialPrompt.ts`: delete; drop its exports from `index.ts`.
- Contract bump (D7): `apps/kira-space/internal/gitrpc/contract.go`, `packages/git-ipc/src/validate.ts`
  `CONTRACT_VERSION`, history entries; `contract.ts` doc comments for both credential keys.
  Steps 5-7 add to this same history entry; no second bump.

### Step 4. `refactor(space): ADE credential prompts use the relay`

- `internal/ade/board.go`: `b.conn.RouteCredentials(...)` with source `"Kira Space ade"`; delete
  `case "credential.request"`, `credentialRequest`, `ProvideCredential`; `TaskBoardDeps.OnCredential`.
- `internal/bridge/adetask.go`: delete `AdeTaskCredentialRequested`, `ProvideCredential`.
- `internal/bridge/adewire/channels.go`, `wire.go`, `wire_test.go`: drop `ChannelCredential`,
  `CredentialRequest`, `ProvideCredentialArgs`.
- `main.go:471`: drop `OnCredential`; pass the relay to `NewTaskBoard`.
- Frontend: `ade/queries.ts:94-106`, `bridge/index.ts:160-161,267-268`, `ade/v2/wire.ts`
  credential types; `tests/ui/support/{ipcChannels,mockRuntime,types}.ts` and any spec referencing
  the ADE credential channel (`grep -rn adetask:credential apps/kira-space/tests`).
- `docs/ARCHITECTURE.md:3746,3788-3789` wording moves in Step 8.
- Bindings regenerated. Test: none new; relay tests cover the mechanism.

### Step 5. `feat!: repository settings are edited in Kira Space only`

- `packages/git-ipc/src/contract.ts` (`AppInitResult.capabilities`, `:1550` area),
  `validate.ts`, `codec.test.ts:70` fixture: `editRepoSettings`.
- `apps/kira-space/frontend/src/repo/git/hostHandlers.ts:193-217`: `editRepoSettings: true`.
- `apps/kira-space-vscode/src/proxyHandlers.ts` app.init: `editRepoSettings: false`.
- `packages/git-ui/src/state/review.test.ts:14` fixture; any other `capabilities` fixture the
  typecheck flags (e.g. `apps/kira-space-vscode/tests/interaction/support/fakeGraphHost.ts`).
- `packages/git-ui/src/components/AppToolbar.vue`: gear rendered only when a new prop says so.
- `packages/git-ui/src/App.vue`: pass the capability to the toolbar; mount `RepoSettingsDialog`
  only when `true`.
- `internal/gitsock/server.go` denylist: add `repoSettings.set`.
- `internal/gitsock/settings_test.go`: socket `repoSettings.set` now refused (assert `E_READ_ONLY`);
  move the fan-out assertion to an in-process `Router.SetRepoSettings` write observed by two socket
  clients. Switch its leaf off `kiraSpace.log.level` (Step 6 deletes it).
- Extension `extension.ts`: delete `migrateLegacySettings`, `LEGACY_GIT_PATH_KEY`,
  `SETTINGS_MIGRATED_KEY`, `inspectedValue`, the `:367` call; `readRawSettings` reads only
  `source: 'host'` keys; header comment `:9-10` updated (the extension owns no settings).
- `apps/kira-space-vscode/tests/interaction/graph-dialog-reconnect.spec.ts`: the gear is gone under
  VS Code. Keep the P108 F3 regression on a dialog still reachable there (one opened from the
  toolbar, e.g. Stash); same "reconnect closes it" assertion.

### Step 6. `refactor!: drop the unread per-repo log level; extension logs via LogOutputChannel`

- `packages/git-core/src/settings/schema.ts`: delete `kiraSpace.log.level`; fix comments `:50-57`;
  `schema.test.ts` if it counts repo keys.
- `packages/git-ipc/src/contract.ts:54-79`: drop the leaf and stale comments; `validate.ts`.
- `packages/git-ui/src/state/repoSettings.ts` default snapshot; `RepoSettingsDialog.vue`: delete the
  Diagnostics section, `logLevelOptions`, `onLogLevelChange`, header paragraph `:11-18`.
- Go: `gitrpc/wire.go:558-597`, `gitrpc/settings.go:29,59`, `storage/model/gitreposettings.go`
  (`LogLevel` field, patch leaf, `Validate` branch, default), `storage/repos/gitreposettings.go`
  (`logLevelSettingKey` read/write); `gitrpc/settings_test.go:192-361` switch leaf to
  `kiraSpace.graph.scope` where the test is about per-repo scoping, delete cases that only tested
  the log-level leaf itself.
- `apps/kira-space-vscode/src/ports/logger.ts`: wrap `vscode.LogOutputChannel`; map
  error/warn/info/debug to its methods; no own filter. `extension.ts:337,343`:
  `createOutputChannel('Kira Space', { log: true })`. Drop now-unused `coerceSettings` call path if
  only `workbench.tree.indent` remains (build `SettingsSnapshot` directly).
- `packages/git-core/src/ports/logger.ts` doc: `"off"` no longer named as a VS Code setting.

### Step 7. `feat: VS Code graph follows Kira Space's date format` (U2 = (a) only)

- `internal/gitrpc/handlers.go`: `Deps.DateFormat func() string`; `handleAppInit` sets it.
  `wire.go` / `ServerAppInitResult` Go type.
- `main.go`: wire from Space settings (`model.Settings` appearance `DateFormat`).
- `packages/git-ipc/src/contract.ts:1193` `ServerAppInitResult.dateFormat`; `AppInitResult.dateFormat?`;
  `validate.ts`.
- `apps/kira-space-vscode/src/proxyHandlers.ts` app.init: pass `server.dateFormat`.
- `packages/git-ui/src/App.vue` bootstrap precedence (U2 (a)); `RepoSettingsDialog.vue`: delete
  Display section, `host`/`dateFormat` props and emit; `App.vue` call site.
- If U2 = (b): instead keep the Display section reachable under VS Code per the user's answer; do
  not start this step before the answer.

### Step 8. `test(e2e): Space credential relay prompt and VS Code webview suite`

- Space UI spec (mock runtime, `apps/kira-space/tests/ui/`): push a `kira:git:credential` snapshot →
  dialog shows label and prompt; Submit calls `GitCredentialService.Provide`; an empty snapshot
  closes the dialog.
- Run the VS Code webview Playwright suite (`apps/kira-space-vscode/tests`), git-ui tests, Space UI
  suite, `go test -race ./...` under `apps/kira-space`. Fix in follow-up commits.

### Step 9. `docs: record P178 decisions`

`docs/ARCHITECTURE.md`:

- `:2856-2875` credential bullet: socket clients' and ADE prompts go to the Space relay; native
  stream keeps its own; withdrawal closes stale dialogs; D4 surfacing; U1 outcome.
- `:3034-3040` host-capability list: drop "credential prompt"; state the D-criterion (Space-owned
  config and Space-held prompts live in Space; extension keeps VS Code-owned UI); manifest requires
  a trusted workspace; extension log uses `LogOutputChannel`.
- `:3746`, `:3788-3789`: ADE credential channel gone, relay instead.
- Settings: `repoSettings.set` refused on `git.sock`; `editRepoSettings` capability; per-repo log
  level gone; date format per U2.
- Known open items: add "macOS app activation over VS Code on a relay prompt unverified" only if
  P180 has not run by then; delete once verified.

This plan's Result section: implementer fills it (what landed, commit list, deviations).

## 5. File ownership (Stream A, P178; one implementer, sequential)

| File(s) | Steps |
|---|---|
| `apps/kira-space-vscode/package.json` | 1 |
| `apps/kira-space-vscode/src/extension.ts` | 1, 3, 5, 6 |
| `apps/kira-space-vscode/src/proxyHandlers.ts` | 1, 3, 5, 7 |
| `apps/kira-space-vscode/src/proxyHandlers.test.ts`, `src/testing/stubHost.ts` | 1 |
| `apps/kira-space-vscode/src/ports/credentialPrompt.ts` (delete), `src/ports/logger.ts` | 3, 6 |
| `apps/kira-space-vscode/tests/interaction/graph-dialog-reconnect.spec.ts`, `support/fakeGraphHost.ts` | 5 |
| `packages/git-core/src/ports/credentialPrompt.ts` (delete), `ports/logger.ts`, `index.ts` | 3, 6 |
| `packages/git-core/src/settings/schema.ts`, `schema.test.ts` | 6 |
| `packages/git-ipc/src/contract.ts`, `validate.ts`, `codec.test.ts` | 3, 5, 6, 7 |
| `packages/git-ui/src/App.vue`, `components/AppToolbar.vue` | 5, 7 |
| `packages/git-ui/src/components/dialogs/RepoSettingsDialog.vue`, `WorktreeDialog.vue` | 1, 6, 7 |
| `packages/git-ui/src/state/repoSettings.ts`, `state/review.test.ts` | 5, 6 |
| `apps/kira-space/internal/gitcred/*` (new) | 2 |
| `apps/kira-space/internal/gitaskpass/prompt.go` | 3 |
| `apps/kira-space/internal/gitsession/conn.go`, `remote.go`, their tests | 3 |
| `apps/kira-space/internal/gitsock/server.go`, `remote_test.go`, `settings_test.go` | 3, 5 |
| `apps/kira-space/internal/gitrpc/contract.go` | 3 |
| `apps/kira-space/internal/gitrpc/wire.go`, `settings.go`, `settings_test.go`, `handlers.go` | 6, 7 |
| `apps/kira-space/internal/storage/model/gitreposettings.go`, `storage/repos/gitreposettings.go` | 6 |
| `apps/kira-space/internal/ade/board.go` | 4 |
| `apps/kira-space/internal/bridge/events.go`, `gitcredential.go` (new), `adetask.go`, `adewire/*` | 2, 4 |
| `apps/kira-space/main.go` | 2, 3, 4, 7 |
| `apps/kira-space/frontend/src/state/gitCredential.ts`, `workbench/GitCredentialDialog.vue`, `main.ts`, `bridge/index.ts` | 2, 4 |
| `apps/kira-space/frontend/src/ade/queries.ts`, `ade/v2/wire.ts` | 4 |
| `apps/kira-space/frontend/src/repo/git/hostHandlers.ts` | 5 |
| `packages/shared/domain/git.ts` | 2 |
| `apps/kira-space/frontend/bindings/**` (generated) | 2, 4 |
| `apps/kira-space/tests/unit/git-credential-queue.spec.ts`, `tests/ui/**` | 2, 4, 8 |
| `docs/ARCHITECTURE.md` | 9 |

No split: Steps 2-7 chain through `main.go`, `gitsock/server.go`, `contract.ts` and the one
contract bump. One sequential implementer.

## 6. Overlap with P173 (Stream C)

Shared source files: `apps/kira-space/internal/gitsock/server.go` (P173 Step 1),
`packages/git-ipc/src/contract.ts`, `validate.ts`, `apps/kira-space/internal/gitrpc/contract.go`
(P173 Step 3 bump), `apps/kira-space-vscode/src/extension.ts`, `proxyHandlers.ts` (P173 Step 3),
`packages/git-ui/src/App.vue` (P173 Steps 4-5), `docs/ARCHITECTURE.md` (P173 Step 7). Likely also
`apps/kira-space/main.go` and `internal/gitrpc/handlers.go` (P173's auto-fetch/report wiring).

Semantic dependency: both bump the contract. P178 bumps from P173's landed number.

Rule: P178 implementation starts only after P173's final commit is on the chapter branch. Rebase
first; re-read every file above at the rebased head before editing (line numbers in this plan are
from `2ab0304` and will shift).

## 7. Verification

Orchestrator checks (real, not prose):

- `grep -rn "isWorkspaceTrusted\|createInputBox\|CredentialPrompt\|migrateLegacySettings\|kiraSpace.log.level" apps/kira-space-vscode/src packages/git-core/src packages/git-ipc/src packages/git-ui/src apps/kira-space/internal`
  → no hits (generated bindings and docs history aside).
- `package.json` has `capabilities.untrustedWorkspaces.supported === false` with a description.
- Real callers: `RouteCredentials` in `gitsock/server.go` and `ade/board.go`; `gitcred.Relay` built
  in `main.go`; `notify.PendingQueue` used in `gitcred/relay.go`; `hydrateRelayPrompts` called in
  frontend `main.ts`; `createOutputChannel(..., { log: true })` in `extension.ts`.
- `gitsock` refuses `repoSettings.set` and `credential.provide` (test in `settings_test.go`, refusal
  path exercised in `remote_test.go`).
- `ContractVersion` (Go) equals `CONTRACT_VERSION` (TS) equals P173's landed number + 1.
- `go test -race ./...` under `apps/kira-space`, TS lint/typecheck/tests, both Playwright suites
  green; pre-commit hook clean on every commit.

Limits here: no real VS Code host (Restricted Mode behaviour, `LogOutputChannel` level command,
"extension shows nothing" during a credential wait) and no macOS (window bring-forward and app
activation over VS Code). Both go to P180.

## Result

(Implementer fills.)
