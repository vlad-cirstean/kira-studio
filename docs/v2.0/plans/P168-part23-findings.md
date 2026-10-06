# P168 Part 23 findings: Kira Space VS Code extension

Reviewer: Opus, report only. Base commit `48ce095` (local `v2.0`). Fixer-churn scope:
`git log f40cd35..HEAD -- apps/kira-space-vscode scripts/build-vscode.ts scripts/package-vscode.ts`
shows `9c00d2c` and `ca54c70` (Part 19). Both touch only `tests/interaction/**` specs and fakes;
reviewed as unreviewed code, nothing found there. Consumed packages changed by Parts 17-19 (`git-ipc`
`614f647`, `c83845d`, `6906a4f`; `git-ui` reconnect/`BridgeClient`) were checked at the extension
boundary only.

Paths below: `VS` = `apps/kira-space-vscode/src`.

Routed items for Part 23: none. `P168-routed-from-streamA.md`, `-streamB.md`, `-streamC.md` and
`P168-routed-to-stream-a.md` name no Part 23 file. The streamB note mentioning "vscode proxy"
(Part 17 F2, `rpcstream/frame.go`) is a Stream A Go item, not Part 23.

Counts: high 0, medium 6, low 8. One finding carries a DESIGN-DECISION half (F11).

## Fix groups (one commit each)

- G1 commands: F1.
- G2 restore-after-reload and connection recovery: F2, F3, F4.
- G3 review comments: F5.
- G4 blame widget: F6, F7.
- G5 connection manager robustness: F8.
- G6 credential relay: F9.
- G7 status bar: F10.
- G8 manifest trust: F11.
- G9 proxy and reviewMarking small fixes: F12, F13.
- G10 comments and dead deps: F14.

## Findings

### F1 (medium) Stack navigation commands have no handler; palette and Alt+Up/Down throw

- `VS/commands.ts:264-265` lists `kiraSpace.goToStackParent`/`goToStackChild` in `OTHER_COMMANDS`;
  `package.json:285-294` contributes them and binds `alt+up`/`alt+down` (`:378-387`).
- `VS/extension.ts:496-523` `otherCommandHandlers` has no entry for either. `:532-536` registers
  `otherCommandHandlers[command]`, which is `undefined` for both. VS Code's `registerCommand` does
  not validate the callback, so activation succeeds and every invocation fails with a TypeError
  ("command ... resulted in an error").
- Root cause: `OTHER_COMMANDS` is typed `readonly OtherCommand[]`, so
  `OtherCommandId = (typeof OTHER_COMMANDS)[number]['command']` is plain `string` and
  `Record<OtherCommandId, ...>` enforces nothing. The comment at `extension.ts:482-484` ("TypeScript
  requires one per id") is false. No git-ui `UiActionKind` exists for stack navigation either
  (`grep goToStack packages/git-ui` finds nothing).
- Scenario: user focuses the graph, presses Alt+Up: error toast, nothing happens. Same from the
  palette.
- Fix: declare `OTHER_COMMANDS` `as const satisfies readonly OtherCommand[]` so the record is total
  over literal ids. Then implement both: add `UiActionKind` members (`goToStackParent`,
  `goToStackChild`) wired in `App.vue`'s `runUiAction` to the existing `stackListModel` +
  `opsState.runCheckout` path the comment at `commands.ts:259-263` describes, and route both
  handlers through `graphProvider.runUiAction`. The `git-ui`/`git-ipc` half touches Part 17/18/19
  files (closed); if the orchestrator will not reopen them, remove both commands and keybindings
  instead. Never leave them registered without a handler.

### F2 (medium) Virtual documents restored at window reload render empty and stay empty

- `VS/extension.ts:365-377`: `provide` calls `manager.request('file.read', ...)` and maps any
  rejection to `undefined` (empty document). `request` rejects at once while not connected
  (`VS/connection.ts:231-233`).
- At reload VS Code restores `kira-space:` diff tabs and asks the provider for content during
  activation, before the first handshake completes (`#dial` awaits `secrets.get` before it even
  connects). Both sides come back `''`. `ports/editorIntegration.ts:9-10` states content is cached
  per URI and never invalidated, and the provider has no `onDidChange`, so the tab keeps showing two
  empty files.
- Scenario: reload window with a commit or review diff open: the diff shows blank content (or the
  whole file as added/removed) with no error.
- Fix: in `provide`, `await manager.whenConnected(signal)` with a bounded timeout (abort after,
  say, 10 s) before `file.read`. Also give the provider an `onDidChange` emitter and fire it for
  every open `kira-space:` document (`vscode.workspace.textDocuments`) on the transition into
  `connected`, so a document that did resolve empty is re-fetched.

### F3 (medium) Review marking never recovers for restored or early review diffs

- `VS/reviewMarking.ts:194-208` `resolveBase` memoizes `.catch(() => null)`: a rejection (not
  connected, transient error) is cached as "no base" until a `repo.changed` for that repo.
  `resolve` (`:223-224`) then returns `undefined`, so no state, no decorations, and the context keys
  hide the toolbar/context-menu commands.
- `notifyConnectionState` (`:554-566`) clears `states`/`inFlight` but not `baseMemo`, and nothing
  reloads visible review editors when the state returns to `connected`.
- Scenario: reload with a review diff open: `onDidChangeVisibleTextEditors` fires during activation,
  `review.resolveBase` rejects (not connected), `null` is memoized, and the diff never gets marks or
  the Mark Reviewed command until the branch's refs change. Same after any drop and reconnect: the
  old states are cleared and nothing repaints.
- Fix: do not memoize a rejected `resolveBase` (delete the entry in the catch); clear `baseMemo` in
  `notifyConnectionState` on leaving `connected`; on entering `connected`, call `loadAndPaint` for
  every visible editor whose URI has a `reviewAnchorFor`.

### F4 (medium) Review comment threads never render for restored or reconnected review diffs

- `VS/reviewComments.ts:115-134` `renderThreads` returns without recording anything when
  `review.comment.list` fails. The only other trigger is `onDidChangeVisibleTextEditors`
  (`:221-227`). The controller has no connection-state hook (`extension.ts:615-658` notifies
  `reviewMarking` and `blameWidget` only).
- Scenario: reload with a review diff open: the list request fails (not connected), threads are
  never rendered until the editor's visibility changes. Comments the user wrote look lost.
- Fix: add `notifyConnectionState(state)` to the controller, called from the same
  `onStateChange` dispatcher; on entering `connected`, re-render every visible `kira-space:` editor
  with a `reviewAnchorFor`.

### F5 (medium) Opening a review diff renders every comment thread twice

- `VS/reviewComments.ts:115-134`: `renderThreads` disposes the tracked set before its `await`, then
  overwrites `threadsByUri` after it. Two overlapping calls for one URI both dispose nothing, both
  build threads, and the second `set` orphans the first call's threads (never disposed).
- Two calls overlap on the ordinary open path: `editor.openRangeDiff` (`VS/proxyHandlers.ts:357-368`)
  awaits `vscode.diff`, which fires `onDidChangeVisibleTextEditors`; `threadsByUri.has(uri)` is
  still false (the first list request has not resolved), so the visibility handler starts call 1;
  then `renderReviewComments` starts call 2. `notifyCommentsMutated` racing a submit's own
  `renderThreads` produces the same.
- Scenario: open a file with comments from the review sidebar: each comment shows twice in the
  gutter and Comments panel. Deleting one re-renders only the tracked set; the orphan stays until
  reload.
- Fix: per-URI generation counter (or `AbortController`) in `renderThreads`; after the `await`,
  drop a superseded result, otherwise dispose the currently tracked threads and store the new ones
  in the same synchronous step.

### F6 (medium) Blame widget sends a path relative to the workspace folder, not the repo root

- `VS/blameWidget.ts:140`: `rel = relative(folder.uri.fsPath, editor.document.uri.fsPath)`. Go
  `RepoEntry.BlameLine` (`apps/kira-space/internal/gitsession/queries.go:493-500`) joins `path`
  onto `e.Summary.Root`, the repository root.
- Scenario: a workspace folder that is a subdirectory of a repo (monorepo package opened alone).
  `repo.open` on the folder resolves the enclosing repo; `blame.line` for `pkg/README.md` asks for
  `README.md` at the root and shows the blame of a different file, or `none`. Wrong result shown
  as fact.
- Also `rel` is filesystem-sourced and not `nfcPath`-normalized (G27 D7), unlike the folder key.
- Fix: memoize the `repo.open` result's `repo.root` per folder alongside the `repoId`, compute
  `nfcPath(relative(root, nfcPath(editor.document.uri.fsPath)))`, and skip (state `none`) when it
  escapes the root.

### F7 (low) Blame repoId memo caches failures, including ones from a dropped connection

- `VS/blameWidget.ts:64-82`: a rejected `repo.open` maps to `null` and is stored in
  `repoIdByFolder`. `notifyConnectionState` (`:189-192`) clears `repoIdByFolder` but not
  `repoIdResolving`; a request in flight at the drop rejects after the clear and stores `null`.
- Scenario: connection drops during a blame lookup; after reconnect that folder shows no blame for
  the rest of the session (until the next disconnect). Any transient `repo.open` failure has the
  same lasting effect.
- Fix: store only definitive answers (`ok` gives the id, `notARepository` gives `null`); never store
  on rejection. Tag each resolve with a connection epoch and discard a result whose epoch changed.

### F8 (low) A secret-storage failure stalls the dial loop permanently

- `VS/connection.ts:347-349` (`await secrets.get`), `:424` (`secrets.store`) and `:441`
  (`secrets.delete`) run inside `void this.#dial()` / `void this.#handleHandshakeFrame(...)`. A
  rejection (keychain locked or unavailable) is an unhandled rejection and stops the loop: no
  socket, no reconnect timer, state stays `connecting`. In the `tokenRejected` branch
  `#disconnectHandledFor` is already set, so the later close event is ignored too.
- Scenario: macOS keychain prompt denied or keychain error at startup: the status bar spins forever
  and only a window reload recovers.
- Fix: wrap the secret calls; treat a failed `get` as "no token" (pair afresh) or schedule a
  reconnect with backoff; on a failed `delete` still destroy the socket and re-dial; log a failed
  `store` at `warn`.

### F9 (low) Credential prompt outlives the request it answers

- `VS/extension.ts:555-567` calls `credentialPrompt.ask({prompt, masked})` with no `signal`.
  `ports/credentialPrompt.ts` supports one; with `ignoreFocusOut: true` (`ports/credentialPrompt.ts:21`) the box stays until the
  user acts.
- Scenarios: (a) the socket drops or the remote op is cancelled from the webview; the box stays, and
  a typed secret goes to a dead `requestId`. (b) two concurrent `credential.request`s (fetches in two
  repos of a multi-root window): creating the second input box hides the first, whose `onDidHide`
  answers `null`, failing that op's auth.
- Fix: pass an `AbortSignal` aborted when the connection leaves `connected`; serialize prompts
  through a queue so one box shows at a time. Server-driven cancel (broker timeout, op cancel) needs
  a new `credential.cancel` event in the contract and Go; that half is a design decision for a
  separate phase, not this fix.

### F10 (low) Status bar tooltip renders commit text as Markdown; accessible name never says the state

- `VS/extension.ts:270-276`: `blame.summary` and `blame.author` (repository content) go into a
  `vscode.MarkdownString` unescaped (`:207-209`). Markdown in a summary (`__init__`, `*`) renders
  wrong; an image reference `![](https://host/x)` loads a remote image when the user hovers.
- `VS/extension.ts:324`: `accessibilityInformation.label` is always `plainTextOf(tooltipLines[0])`,
  which is `Kira Space` for every state. Icon-only states (connecting, connected, loading) give a
  screen-reader user no state at all.
- Fix: build the tooltip with `appendMarkdown` for fixed labels and `appendText` for summary,
  author and paths. Use all tooltip lines (plain text) joined with ", " as the accessible label.

### F11 (low) Manifest declares no workspace-trust capability, so the trust gate is dead code — DESIGN-DECISION

- `package.json` has no `capabilities.untrustedWorkspaces`. VS Code then disables the extension in
  Restricted Mode, so `isWorkspaceTrusted()` (`VS/extension.ts:420`, read at
  `VS/proxyHandlers.ts:242`) is never `false` while the code runs. If trust were supported, the
  capability is read once per webview boot and never refreshed on
  `onDidGrantWorkspaceTrust`.
- Decision needed: declare `"untrustedWorkspaces": {"supported": "limited", "description": ...}`
  and keep the prepare-script gate (then emit a `settings.changed`-style refresh or re-run
  `app.init` on trust grant), or declare `"supported": false` explicitly and delete the
  `isWorkspaceTrusted` plumbing. The fixer must not half-do either; record the choice in a
  `SPEC.md` row if it cannot be settled here.

### F12 (low) `editor.openWorkingDiff` lacks the path-containment check `editor.resolveConflict` has

- `VS/proxyHandlers.ts:406-425` opens `join(root, path)` as a live `file:` document with no check;
  `:461-472` refuses the same webview-supplied shape when it escapes `root`. `openAllChanges`
  (`:391`) builds a label-only `resource` the same way (no file opened from it).
- Scenario: a `path` of `../../.ssh/config` opens that file in a diff tab. Needs a compromised
  webview or a malformed status path, so defence in depth only.
- Fix: extract the containment check into one helper and use it in both handlers.

### F13 (low) Every worktree change re-fetches `review.files` per open review branch

- `VS/reviewMarking.ts:525-552` `notifyRepoChanged` ignores `payload.kind`. A `worktreeChanged`
  (a file save) drops the base memo and runs `review.resolveBase` plus a full `review.files` for
  each branch with an open review diff, though a branch tip only moves on `refsChanged`.
- Scenario: editing files with a review diff open: two RPCs (one a whole-branch diff) per save per
  branch.
- Fix: return early unless `payload.kind === 'refsChanged'`.

### F14 (low) Stale or false comments and an unused dependency

- `VS/diffToolbar.ts:25-29` and `VS/reviewMarking.ts:106-107` cite `reviewView.ts`'s
  `enableCommandUris`, which no longer exists (P75 §2.3 replaced the command URI; the webview
  options at `VS/webviewProviderBase.ts:44-47` set no such flag).
- `VS/webviewDocument.ts:84`: the comment reads "Escaping "<" to its JSON-safe `<` unicode escape";
  the escape sequence itself was lost from the comment text.
- `VS/extension.ts:387-390`: "refs.list/status.get/undo.peek/stash.list rejecting E_UNKNOWN_METHOD
  ... until G5/G8" is long past.
- `VS/extension.ts:482-484`: see F1 (false totality claim).
- `VS/transport.ts:3` and `:22` point at `packages/ipc/src/rpc.ts` and
  `apps/harness/src/main.ts`, neither of which exists.
- `VS/reviewView.ts:32`/`:44-46`: `KiraReviewViewProviderDeps.context` is never read (its own comment
  says so); drop it and the constructor override.
- Fix: correct or delete each comment; remove the unused dep.

## Dropped candidates

- Socket drop resolves an in-flight `graph.stream` as complete (`git-ipc` `dispose` resolves
  streams; proxy then posts a clean `end`). Dropped: the webview's `BridgeClient.onReconnect`
  re-opens the repo and stream from `loadedRows`, and `exhausted` is only set by a chunk, so no
  truncated graph is presented as complete.
- `ConnectionManager.on` keys `#transportEventUnsubs` by handler function, so one function
  registered for two events collides. Dropped: every caller passes a distinct closure; latent only.
- `worktree.prepare` forwarded without a trust check. Dropped: the script comes from Kira Space's
  own per-repo settings, not repository content; covered by F11's decision.
- `worktree.openWindow` opens any webview-supplied path. Dropped: opening a folder window runs no
  code by itself; VS Code's own trust prompt guards the new window.
- `goToFile` reveals a server-supplied `absPath` unchecked. Dropped: the Go server is the trust
  boundary for its own answers (paired, same user).
- `repo.close` proxy entry shared by both webviews. Dropped: `RepoState.close` has no caller in
  `git-ui`, so the entry is unreachable from either webview.
- `runUiAction` emitting to a hidden but undisposed webview. Dropped: lifecycle claim unverifiable
  without a real VS Code host here; P15 probes back the current design.
- Tests below the `CLAUDE.md` bar (`blameState.test.ts`, `memoizedSetter.test.ts`,
  `linkUrl.test.ts`, `prUrl.test.ts`, session save/load and pinned pass-through cases in
  `proxyHandlers.test.ts`, `virtualKey.test.ts` round-trips). Dropped: the bar is forward-only; no
  fix here touches them.
- `extensionKind: ["workspace"]` with a terminal `remote` state. Design choice documented in
  `connection.ts:176-186`; not reported.

## Coverage

- Read in full: `VS/connection.ts`, `extension.ts`, `proxyHandlers.ts`, `webviewProviderBase.ts`,
  `panelView.ts`, `reviewView.ts`, `transport.ts`, `html.ts`, `webviewDocument.ts`,
  `webview/main.ts`, `commands.ts`, `reviewComments.ts`, `reviewMarking.ts`, `blameWidget.ts`,
  `blameState.ts`, `diffToolbar.ts`, `goToFile.ts`, `virtualKey.ts`, `virtualUri.ts`,
  `virtualFileDecoration.ts`, `linkUrl.ts`, `prUrl.ts`, `memoizedSetter.ts`, all `ports/*.ts`,
  `package.json`, `.vscodeignore`, `tsconfig.json`, `scripts/build-vscode.ts`,
  `scripts/package-vscode.ts`.
- One-hop callees checked: `git-ipc` `createRpcClient`/`createRpcServer` (`rpc.ts`), contract event
  list (every server event is forwarded), `git-ui` `BridgeClient` reconnect, `RepoState`,
  `GraphViewState.openStream`, `packages/git-ui/vite.config.ts`; Go `gitsock` handshake,
  `RepoEntry.BlameLine`, `RunPrepare`.
- Skimmed (names and server binding only): `src/*.test.ts`, `tests/interaction/**`,
  `tests/layout/**`, `tests/support/webviewServer.ts` (binds `127.0.0.1`, ephemeral port).
- Not run: the webview Playwright suite and a real VS Code host (no display in this sandbox).
