/**
 * `activate`/`deactivate` (G1 §5.4, G3 D17/D18, G6 D15). G1's whole job was dialing the socket,
 * handshaking, and proving `app.init`/`repo.open` round-trip for real, with no webview view
 * registered. G3 registered the graph view. G6 registers the second and last view this chapter
 * defines — the branch-review sidebar — closing SPEC §5's "both webview views are registered"
 * hand-off: `apps/kira-studio-vscode` registers no further views after this phase.
 *
 * Upstream's `activate()` built an in-process `RepoService` and two webview providers; neither
 * exists here in that shape. `coerceSettings`/`readRawSettings` and the `onDidChangeConfiguration`
 * re-coercion are kept — the extension still owns settings (SPEC §5 item 3).
 *
 * G10 D3/D16/D19: `activationEvents: ["onStartupFinished"]` (the manifest) is what lets the
 * status-bar item created here appear before a user has ever opened the panel by hand — an item
 * created in `activate()` cannot show until something has already activated the extension.
 * `activate()` now also registers every palette command straight from `commands.ts`'s tables (no
 * hand-written second list to drift from), and the SCM title-bar button is a manifest-only
 * addition (`contributes.menus.scm/title`) pointing at the pre-existing `kiraVersion.focusGraph`.
 */
import {
  coerceSettings,
  type Logger,
  nfcPath,
  repoSettingKeys,
  SETTINGS,
  type SettingKey,
  type VirtualDocumentSource,
} from '@kira/git-core';
import type { GitStatus, RepoSettingsPatch } from '@kira/git-ipc';
import * as vscode from 'vscode';
import type { OtherCommandId } from './commands.ts';
import { isPaletteCommand, MUTATING_COMMANDS, OTHER_COMMANDS } from './commands.ts';
import { ConnectionManager, type ConnectionState } from './connection.ts';
import { goToFileFromDiffCommand, openCommitInGraphCommand } from './diffToolbar.ts';
import { KiraGraphViewProvider } from './panelView.ts';
import { VsCodeClipboard } from './ports/clipboard.ts';
import { VsCodeCredentialPrompt } from './ports/credentialPrompt.ts';
import { VsCodeEditorIntegration } from './ports/editorIntegration.ts';
import { VsCodeLogger } from './ports/logger.ts';
import { VsCodeWindows } from './ports/windows.ts';
import { VsCodeWorkspaceRoots } from './ports/workspaceRoots.ts';
import { createProxyHandlers } from './proxyHandlers.ts';
import { createReviewCommentController } from './reviewComments.ts';
import {
  createReviewMarkingController,
  markSelectionReviewedCommand,
  markSelectionUnreviewedCommand,
} from './reviewMarking.ts';
import { KiraReviewViewProvider } from './reviewView.ts';
import { KiraVirtualFileDecorationProvider } from './virtualFileDecoration.ts';
import { parseVirtualKey } from './virtualKey.ts';

// D11: the server contract's own app.init is the webview contract's AppInitResult minus host/
// settings/capabilities (SPEC §5 item 3 assigns those to the extension, which has no webview to
// compose them for yet, D13) — genuinely a different wire shape than RequestKey's own ResultOf<
// 'app.init'>, so this call is cast to gitrpc's real shape rather than trusted at its contract
// type. Mirrors internal/gitrpc/wire.go's AppInitResult field for field.
interface ServerAppInitResult {
  readonly contractVersion: number;
  readonly serverVersion: string;
  readonly git: GitStatus;
}

// G10 D19: command ids themselves now live in commands.ts's tables (the only place activate()
// reads them from to register) — STATUS_COMMAND/OPEN_REPO_COMMAND/REVIEW_BRANCH_COMMAND are gone
// from here for exactly that reason, not merely unused.
// G1 §5.4 removed this command saying it "returns in G3" (D13/D17) — it does, once there is a
// graph view to focus.
const FOCUS_GRAPH_COMMAND = 'kiraVersion.focusGraph';
const SHOW_CONNECTION_STATUS_COMMAND = 'kiraVersion.showConnectionStatus';
const GRAPH_VIEW_ID = 'kiraVersion.graph';
const REVIEW_VIEW_ID = 'kiraVersion.review';
const SETTING_KEYS = Object.keys(SETTINGS) as readonly SettingKey[];

function readRawSettings(config: vscode.WorkspaceConfiguration): Record<string, unknown> {
  const raw: Record<string, unknown> = {};
  for (const key of SETTING_KEYS) {
    const value = config.get(key);
    if (value !== undefined) raw[key] = value;
  }
  return raw;
}

// ---------------------------------------------------------------------------------------
// G18 D11: a one-time, best-effort migration for a value a user already had set for any of the
// eight keys that leave contributes.configuration this phase — the seven that moved into the new
// per-repo store (D1) plus kiraVersion.git.path (D15, fixed but relocated to Kira Studio's own
// server-owned settings, never the per-repo one). Never edits the user's settings.json (§8's own
// non-goal) — the orphaned legacy value(s) are simply left in place, unread by anything after this
// migration runs once.
// ---------------------------------------------------------------------------------------

// D15: kiraVersion.git.path is no longer a SETTINGS key at all (it never belonged in this
// VS-Code-facing schema once its true home was kira.db's own settings table) — this is the one
// place its pre-G18 dotted key still needs to be named, purely to look for a legacy value.
const LEGACY_GIT_PATH_KEY = 'kiraVersion.git.path';

// Tracks whether the one-time migration has already run (successfully) — a context.globalState
// flag rather than editing settings.json (which stays untouched, §8), the same "per editor
// installation" scope resolveClientId's own globalState read already uses.
const SETTINGS_MIGRATED_KEY = 'kira.git.repoSettingsMigrated';

/** The literal value a user had configured for `key`, at whichever scope actually won (workspace
 *  folder, then workspace, then global — VS Code's own precedence order) — `undefined` when the
 *  user never touched it, distinct from a value that merely equals the schema's own default
 *  (`config.get` alone cannot tell the two apart once `key` is no longer declared in
 *  `contributes.configuration`, but `inspect` still can). */
function inspectedValue(config: vscode.WorkspaceConfiguration, key: string): unknown {
  const inspected = config.inspect(key);
  if (!inspected) return undefined;
  return inspected.workspaceFolderValue ?? inspected.workspaceValue ?? inspected.globalValue;
}

/** G18 D11: runs once per installation (globalState-tracked). Reads every one of the eight
 *  legacy keys' own pre-G18 value via `inspect()` (never `get()`, which would otherwise conflate
 *  "the user set this" with "this happens to equal a default that no longer exists to fall back
 *  to"); a repo-scoped value is written via `repoSettings.set` against the first workspace
 *  folder's own repo (opened here specifically to learn its repoId, the same `repo.open` every
 *  other caller uses — idempotent per (connection, repoId), so this never disturbs the panel's
 *  own later open of the same repo); `git.path`'s value, if any, goes through
 *  `settings.setGitPath` instead (D15 — it was never part of the per-repo store). A session with
 *  no workspace folder open yet, or a request that fails, is retried on the next activation
 *  rather than marked done — the one-shot flag is only set after every applicable write actually
 *  lands. */
async function migrateLegacySettings(
  context: vscode.ExtensionContext,
  manager: ConnectionManager,
  logger: Logger,
): Promise<void> {
  if (context.globalState.get<boolean>(SETTINGS_MIGRATED_KEY)) return;

  const config = vscode.workspace.getConfiguration();
  const rawRepoValues: Record<string, unknown> = {};
  for (const key of repoSettingKeys()) {
    const value = inspectedValue(config, key);
    if (value !== undefined) rawRepoValues[key] = value;
  }
  const gitPathValue = inspectedValue(config, LEGACY_GIT_PATH_KEY);

  if (Object.keys(rawRepoValues).length === 0 && gitPathValue === undefined) {
    // Nothing to migrate, ever, for this installation — nothing left to retry either.
    await context.globalState.update(SETTINGS_MIGRATED_KEY, true);
    return;
  }

  // Coerced through the same validator settings.json itself is checked against — an invalid or
  // out-of-range legacy value falls back to the schema's own default rather than being carried
  // forward verbatim into the new store.
  const { settings: coerced } = coerceSettings(rawRepoValues);

  // G27 D7: a workspace folder's fsPath is filesystem-sourced, normalized before it is sent on
  // (here, as repo.open's own path) or compared against a git-sourced value elsewhere.
  const rawFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (rawFolder === undefined) {
    // No repository to attach the per-repo half to yet — try again next activation rather than
    // silently dropping a value a user genuinely set.
    return;
  }
  const folder = nfcPath(rawFolder);

  try {
    await manager.whenConnected();

    if (Object.keys(rawRepoValues).length > 0) {
      const opened = await manager.request('repo.open', { path: folder });
      if (opened.kind === 'ok') {
        const patch: Record<string, unknown> = {};
        for (const key of Object.keys(rawRepoValues)) {
          patch[key] = coerced[key as SettingKey];
        }
        await manager.request('repoSettings.set', {
          repoId: opened.repo.repoId,
          patch: patch as RepoSettingsPatch,
        });
      } else {
        logger.log('warn', 'settings migration: repo.open did not resolve to ok, will retry', {
          kind: opened.kind,
        });
        return;
      }
    }

    if (typeof gitPathValue === 'string') {
      await manager.request('settings.setGitPath', { gitPath: gitPathValue });
    }

    await context.globalState.update(SETTINGS_MIGRATED_KEY, true);
    logger.log('info', 'settings migration complete', {
      repoKeys: Object.keys(rawRepoValues),
      gitPath: typeof gitPathValue === 'string',
    });
  } catch (err) {
    logger.log('warn', 'settings migration failed, will retry next activation', {
      err: String(err),
    });
  }
}

// G14 D5: builds the status-bar tooltip as several labelled lines rather than one run-on
// sentence — the detail item.text no longer carries (F7) lives here instead, where it can be
// structured. Markdown line breaks (two trailing spaces) between each entry.
function markdownTooltip(lines: readonly string[]): vscode.MarkdownString {
  return new vscode.MarkdownString(lines.join('  \n'));
}

// The label vscode.MarkdownString's own first line reads as plain text — used for
// accessibilityInformation below, since an icon-only item needs *some* accessible name.
function plainTextOf(markdownLine: string): string {
  return markdownLine.replaceAll('**', '').replaceAll('`', '');
}

// G12 D10: an entry point genuinely visible in every state, not only the one state (connected)
// that needs no indicator — F10's fix. `active` is the in-flight-request signal
// (`ConnectionManager.onActivityChange`), meaningful only while `connected`.
//
// G14 D5: the two states that need the user's attention (pairing, an error) keep a word; the
// three that do not (connecting, connected, loading) are icon-only — everything the text used to
// spend on "Kira Version" now lives in a structured Markdown tooltip instead (F7). `appInit` is
// the server/contract version the connected/idle tooltip names — fetched separately (extension.ts's
// own app.init round-trip), so it is `undefined` for the first render of a fresh `connected` state.
//
// G21 D7 (item 7): the settings-gated hide/show toggle this used to have (a user could turn the
// item off themselves) is removed outright, along with the setting itself. The item is now
// always shown.
function updateStatusBar(
  item: vscode.StatusBarItem,
  state: ConnectionState,
  active: boolean,
  appInit?: { readonly serverVersion: string; readonly contractVersion: number },
): void {
  item.backgroundColor = undefined;
  let tooltipLines: readonly string[];
  switch (state.kind) {
    case 'connecting': {
      item.text = '$(sync~spin)';
      tooltipLines = ['**Kira Studio**', 'Connecting…', '`~/.kira-studio/git.sock`'];
      item.command = SHOW_CONNECTION_STATUS_COMMAND;
      break;
    }
    case 'pairing': {
      item.text = '$(key) Approve';
      tooltipLines = ['**Kira Studio**', "Waiting for approval in Kira Studio's window"];
      item.command = SHOW_CONNECTION_STATUS_COMMAND;
      break;
    }
    case 'connected': {
      if (active) {
        item.text = '$(sync~spin)';
        tooltipLines = ['**Kira Studio**', 'Loading…'];
      } else {
        item.text = '$(git-branch)';
        // G27 D7: a workspace folder's fsPath is filesystem-sourced.
        const rawRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        const root = rawRoot === undefined ? undefined : nfcPath(rawRoot);
        const lines = ['**Kira Studio**', 'Connected'];
        if (root) lines.push(root);
        if (appInit) {
          lines.push(
            `Kira Studio ${appInit.serverVersion}`,
            `Contract v${appInit.contractVersion}`,
          );
        }
        tooltipLines = lines;
      }
      // `connected` keeps focusing the graph — clicking a working connection should reveal the
      // panel, not explain a status there is nothing wrong with.
      item.command = FOCUS_GRAPH_COMMAND;
      break;
    }
    case 'denied': {
      item.text = '$(error) Kira';
      tooltipLines = [
        '**Kira Studio**',
        state.reason === 'timeout' ? 'Pairing request timed out' : 'Pairing was denied',
        'Click to retry',
      ];
      item.command = SHOW_CONNECTION_STATUS_COMMAND;
      item.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
      break;
    }
    case 'versionMismatch': {
      item.text = '$(error) Kira';
      tooltipLines = [
        '**Kira Studio**',
        `Version mismatch — extension expects contract ${state.expected}, ` +
          `Kira Studio (${state.serverVersion}) speaks ${state.received}`,
        'Both need to be on the same release',
      ];
      item.command = SHOW_CONNECTION_STATUS_COMMAND;
      item.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
      break;
    }
  }
  item.tooltip = markdownTooltip(tooltipLines);
  item.accessibilityInformation = { label: plainTextOf(tooltipLines[0]) };
  item.show();
}

let connection: ConnectionManager | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const outputChannel = vscode.window.createOutputChannel('Kira Version');
  context.subscriptions.push(outputChannel);

  let currentSettings = coerceSettings(
    readRawSettings(vscode.workspace.getConfiguration()),
  ).settings;
  const logger = new VsCodeLogger(outputChannel, () => currentSettings['kiraVersion.log.level']);
  const roots = new VsCodeWorkspaceRoots();
  const clipboard = new VsCodeClipboard();
  const editor = new VsCodeEditorIntegration();
  // G25 D6/D14: the "Open in New Window" port and the workspace-trust probe behind
  // capabilities.runPrepareScript.
  const windows = new VsCodeWindows();
  // G7 D4/D21: the migrated, previously-unused credential port — this phase's own relay is its
  // first (and only) caller.
  const credentialPrompt = new VsCodeCredentialPrompt();

  const appVersion = String(
    (context.extension.packageJSON as { version?: unknown }).version ?? '0.0.0',
  );
  const manager = new ConnectionManager(context, logger.child('connection'), appVersion);
  connection = manager;

  // G18 D11: fire-and-forget — never blocks activation; retries on the next activation on
  // failure or when no workspace folder is open yet (see the function's own doc comment).
  void migrateLegacySettings(context, manager, logger.child('settingsMigration'));

  // G4 D14: registered once, at activation, disposed with the extension. `key` is opaque to VS
  // Code (virtualKey.ts's own `${repoId}\0${rev}\0${path}` format) — `found` resolves to the
  // content, everything else (missing/binary/tooLarge, an unparseable key, a request that fails
  // because the connection dropped) resolves to `undefined`, which the port already turns into an
  // empty document rather than throwing into VS Code's own provider machinery.
  const virtualDocumentSource: VirtualDocumentSource = {
    provide: async (key) => {
      const parsed = parseVirtualKey(key);
      if (!parsed) return undefined;
      try {
        const result = await manager.request('file.read', parsed);
        return result.kind === 'found' ? result.content : undefined;
      } catch {
        return undefined;
      }
    },
  };
  context.subscriptions.push(editor.registerVirtualDocuments(virtualDocumentSource));

  // G19 D9: badges a virtual (historical-revision) document whose path has no live counterpart
  // on disk — a plain workspace.fs.stat against the recovered {repoId, path}, no new RPC.
  const virtualFileDecoration = new KiraVirtualFileDecorationProvider();
  context.subscriptions.push(
    virtualFileDecoration,
    vscode.window.registerFileDecorationProvider(virtualFileDecoration),
  );

  // D17/D18: the graph webview view is registered as this phase's own first step -- the graph
  // renders end to end from here on, with refs.list/status.get/undo.peek/stash.list rejecting
  // E_UNKNOWN_METHOD on every repo open until G5/G8 close them (documented, not a regression).
  //
  // G6/D15: `createProxyHandlers` needs `revealReview`, and `revealReview` needs the review
  // provider, which needs `handlers` — the smallest honest break in that cycle is a `let` binding
  // assigned on the next line, read only inside the closure (never before it is set: `review.open`
  // cannot be dispatched before `activate` returns). G13 D9's `reviewComments` controller has no
  // such cycle (it needs only `manager`, already constructed) but its `onEditorMutated` callback
  // reaches the same `reviewProvider` binding for the same reason.
  let reviewProvider: KiraReviewViewProvider;
  const reviewComments = createReviewCommentController(manager, () =>
    reviewProvider.runUiAction('refreshReviewComments'),
  );
  context.subscriptions.push(reviewComments);
  // G15 D7/D9: the same let-binding cycle break reviewComments' own onEditorMutated uses —
  // notifySidebarRefresh reaches D9's reused 'refresh' UiActionKind, keeping the review sidebar's
  // file list honest after an editor-side mark.
  const reviewMarking = createReviewMarkingController({
    connection: manager,
    extensionUri: context.extensionUri,
    notifySidebarRefresh: () => reviewProvider.runUiAction('refresh'),
  });
  context.subscriptions.push(reviewMarking);
  const handlers = createProxyHandlers({
    connection: manager,
    settings: () => currentSettings,
    roots,
    clipboard,
    editor,
    logger,
    windows,
    isWorkspaceTrusted: () => vscode.workspace.isTrusted,
    revealReview: (repoId, branch) => reviewProvider.reviewBranch(repoId, branch),
    renderReviewComments: (repoId, branchTip, path, branch) =>
      reviewComments.renderThreadsForKey(repoId, branchTip, path, branch),
    notifyCommentsMutated: (repoId, branch) => reviewComments.notifyCommentsMutated(repoId, branch),
    refreshReviewMarking: (repoId, branchTip, path, branch) =>
      reviewMarking.refreshForKey(repoId, branchTip, path, branch),
    notifyReviewMarked: (repoId, branch, path) => reviewMarking.notifyMarked(repoId, branch, path),
    // G19 D11b: context.workspaceState already satisfies ReviewSessionStore structurally — no
    // adapter needed.
    reviewSessionStore: context.workspaceState,
  });
  const graphProvider = new KiraGraphViewProvider({ extensionUri: context.extensionUri, handlers });
  reviewProvider = new KiraReviewViewProvider({
    extensionUri: context.extensionUri,
    handlers,
    context,
  });

  // G10 D16: created here so it can appear before the panel is ever opened (D3's
  // onStartupFinished); disposed with the extension like every other subscription.
  const statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 0);
  // G14 D5: set once — the item's text no longer carries a name (F7), so this is what makes it
  // identifiable in the status bar's own right-click "manage" menu.
  statusItem.name = 'Kira Version';
  context.subscriptions.push(statusItem);
  // G12 D10: the in-flight-work indicator — debounced 150ms on the rising edge only (a burst of
  // small requests must not flicker the item several times a second), never on the falling edge
  // (work finishing should read as finished immediately).
  let isActive = false;
  let activityDebounce: ReturnType<typeof setTimeout> | undefined;
  // G14 D5: the connected/idle tooltip names the server and contract version — data this
  // extension already fetches (the app.init round-trip a few lines below, previously logged only)
  // but does not have at the moment `connected` itself first fires, hence a second updateStatusBar
  // call once it resolves. Cleared whenever the state leaves `connected`, since a reconnect may
  // land on a different Kira Studio process.
  let lastAppInit: { readonly serverVersion: string; readonly contractVersion: number } | undefined;
  updateStatusBar(statusItem, manager.state, isActive, lastAppInit);

  // G10 D19: every command this extension contributes is registered from commands.ts's own
  // tables — no hand-written second list. Mutating commands all dispatch through the graph
  // provider's runUiAction; the other ids get an explicit handler each, so TypeScript requires one
  // per id and rejects one for an id that does not exist.
  //
  // G13 D9: the value type is `(...args: any[]) => unknown` rather than `() => void` — two of
  // these ids (submitReviewComment/deleteReviewComment) are contributed to a comment menu
  // (`comments/commentThread/context`/`comments/comment/title`), and VS Code invokes THOSE with
  // the menu's own argument (a `CommentReply`/`Comment`), which a zero-arg handler would silently
  // drop. Every existing zero-arg handler below is still perfectly assignable to the wider type
  // (JS ignores extra arguments), so this widens what the table CAN express without weakening any
  // individual handler's own, precisely-typed body.
  // G14 D9/D10: both diff-toolbar commands share one `DiffToolbarDeps` bundle.
  const diffToolbarDeps = { connection: manager, editor, graphProvider };
  // biome-ignore lint/suspicious/noExplicitAny: see the comment above — two of these ids take a real menu-command argument.
  const otherCommandHandlers: Record<OtherCommandId, (...args: any[]) => unknown> = {
    [SHOW_CONNECTION_STATUS_COMMAND]: () => void showConnectionStatus(manager),
    'kiraVersion.openRepository': () => void openRepository(manager),
    'kiraVersion.focusGraph': () => {
      void vscode.commands.executeCommand(`${GRAPH_VIEW_ID}.focus`);
    },
    'kiraVersion.reviewBranch': () => reviewProvider.reviewBranch(undefined, undefined),
    'kiraVersion.refresh': () => graphProvider.runUiAction('refresh'),
    // G11 D17: the review webview's own command, not the graph's — toggling a reviewed file only
    // makes sense in the review sidebar's Files pane.
    'kiraVersion.toggleFileReviewed': () => reviewProvider.runUiAction('toggleFileReviewed'),
    // G13 D19: D9's own controller owns the real logic; this table only routes to it.
    'kiraVersion.addReviewComment': () => void reviewComments.addAtSelection(),
    'kiraVersion.copyReviewComments': () => reviewProvider.runUiAction('copyReviewComments'),
    'kiraVersion.submitReviewComment': (reply: vscode.CommentReply) =>
      void reviewComments.submit(reply),
    'kiraVersion.deleteReviewComment': (comment: vscode.Comment) =>
      void reviewComments.deleteComment(comment),
    'kiraVersion.goToFileFromDiff': goToFileFromDiffCommand(diffToolbarDeps),
    'kiraVersion.openCommitInGraph': openCommitInGraphCommand(diffToolbarDeps),
    // G15 D2: the two entry points shared by the toolbar, the context menu, the palette, the
    // gutter hover's command link and the CodeLens (an explicit {uri, ranges} argument bypasses
    // tab/selection resolution for the last two).
    'kiraVersion.markSelectionReviewed': markSelectionReviewedCommand(reviewMarking),
    'kiraVersion.markSelectionUnreviewed': markSelectionUnreviewedCommand(reviewMarking),
    // G-UX D9 (item 9): the palette's own route to toggling the graph panel's search row.
    'kiraVersion.toggleSearch': () => graphProvider.runUiAction('toggleSearch'),
  };
  for (const entry of Object.values(MUTATING_COMMANDS)) {
    if (isPaletteCommand(entry)) {
      const action = entry.action;
      context.subscriptions.push(
        vscode.commands.registerCommand(entry.command, () => graphProvider.runUiAction(action)),
      );
    }
  }
  for (const { command } of OTHER_COMMANDS) {
    context.subscriptions.push(
      vscode.commands.registerCommand(command, otherCommandHandlers[command]),
    );
  }

  context.subscriptions.push(
    { dispose: () => manager.dispose() },
    vscode.window.registerWebviewViewProvider(GRAPH_VIEW_ID, graphProvider),
    vscode.window.registerWebviewViewProvider(REVIEW_VIEW_ID, reviewProvider),
    {
      dispose: manager.on('repo.changed', (payload) => {
        graphProvider.notifyRepoChanged(payload);
        reviewProvider.notifyRepoChanged(payload);
        reviewMarking.notifyRepoChanged(payload);
      }),
    },
    // G7 D4/D21: the credential relay's whole client half — askpass becomes a relay, per SPEC §5
    // item 4. No try/catch that logs anywhere on this path: the prompt text can itself contain a
    // credential (a pasted token echoed back in git's own next prompt, probe P1), so a failed
    // `credential.provide` call (the socket dropped between prompt and answer) is swallowed
    // silently — the broker's own disconnect bound has already fired by the time this would run.
    {
      dispose: manager.on('credential.request', (req) => {
        void (async () => {
          const secret = await credentialPrompt.ask({ prompt: req.prompt, masked: req.masked });
          await manager.request('credential.provide', {
            requestId: req.requestId,
            secret: secret ?? null,
          });
        })().catch(() => {
          /* the broker's own bound (dismissal/timeout/disconnect/cancel) already ends the wait */
        });
      }),
    },
    // G7 D20/§4.2: the graph provider only — the review sidebar renders no operation UI at all.
    {
      dispose: manager.on('remote.progress', (payload) => {
        graphProvider.notifyRemoteProgress(payload);
      }),
    },
    // G25 D13: the same "graph provider only" forward remote.progress already uses.
    {
      dispose: manager.on('worktree.progress', (payload) => {
        graphProvider.notifyWorktreeProgress(payload);
      }),
    },
    manager.onActivityChange((active) => {
      if (activityDebounce) {
        clearTimeout(activityDebounce);
        activityDebounce = undefined;
      }
      if (!active) {
        isActive = false;
        updateStatusBar(statusItem, manager.state, isActive, lastAppInit);
        return;
      }
      activityDebounce = setTimeout(() => {
        isActive = true;
        updateStatusBar(statusItem, manager.state, isActive, lastAppInit);
      }, 150);
    }),
    manager.onStateChange((state) => {
      logger.log('info', 'connection state', state);
      if (state.kind !== 'connected') lastAppInit = undefined;
      // G15 D7: "connection state leaves connected" — every tracked decoration/state is dropped
      // rather than left showing a diff over a connection that may reconnect to a different repo.
      reviewMarking.notifyConnectionState(state);
      updateStatusBar(statusItem, state, isActive, lastAppInit);
      // §5.4 point 4: this phase's own exit criterion, executing in the real extension — the
      // moment a connection is established, prove app.init round-trips over the real socket.
      // G14 D5: also what the connected/idle tooltip's server/contract version comes from — a
      // second updateStatusBar call once it resolves, since it is not available the instant
      // `connected` itself fires above.
      if (state.kind === 'connected') {
        manager
          .request('app.init', {})
          .then((raw) => {
            const result = raw as unknown as ServerAppInitResult;
            logger.log('info', 'app.init', {
              git: result.git.kind,
              contractVersion: result.contractVersion,
              serverVersion: result.serverVersion,
            });
            lastAppInit = {
              serverVersion: result.serverVersion,
              contractVersion: result.contractVersion,
            };
            updateStatusBar(statusItem, manager.state, isActive, lastAppInit);
          })
          .catch((err: unknown) => {
            logger.log('error', 'app.init failed', { err: String(err) });
          });
      }
    }),
    vscode.workspace.onDidChangeConfiguration((event) => {
      // G14 D6b: 'workbench.tree.indent' is a host-owned key (SETTINGS' source: 'host'), read off
      // the root configuration object like any other SETTING_KEYS member — readRawSettings itself
      // needs no special case (a fully-qualified dotted key resolves there like any other, with
      // VS Code's own user/workspace/folder/language overrides already applied). What must widen
      // is this early return, so a live change to it still reaches both webviews through the same
      // settings.changed event below.
      if (
        !event.affectsConfiguration('kiraVersion') &&
        !event.affectsConfiguration('workbench.tree.indent')
      ) {
        return;
      }
      const { settings, problems } = coerceSettings(
        readRawSettings(vscode.workspace.getConfiguration()),
      );
      currentSettings = settings;
      for (const problem of problems) {
        logger.log('warn', 'invalid setting, using default', problem);
      }
      graphProvider.notifySettingsChanged(currentSettings);
      reviewProvider.notifySettingsChanged(currentSettings);
    }),
  );
}

async function showConnectionStatus(manager: ConnectionManager): Promise<void> {
  const state = manager.state;
  const socketNote = `Socket: ~/.kira-studio/git.sock`;
  switch (state.kind) {
    case 'connected': {
      await vscode.window.showInformationMessage(`Kira Version: connected. ${socketNote}`);
      return;
    }
    case 'pairing': {
      await vscode.window.showInformationMessage(
        `Kira Version: waiting for approval in Kira Studio. ${socketNote}`,
      );
      return;
    }
    case 'connecting': {
      await vscode.window.showInformationMessage(`Kira Version: connecting… ${socketNote}`);
      return;
    }
    case 'denied': {
      const action = await vscode.window.showWarningMessage(
        state.reason === 'timeout'
          ? `Kira Version: pairing request timed out. ${socketNote}`
          : `Kira Version: pairing was denied. ${socketNote}`,
        'Retry',
      );
      if (action === 'Retry') manager.retry();
      return;
    }
    case 'versionMismatch': {
      const action = await vscode.window.showErrorMessage(
        `Kira Version: version mismatch — extension expects contract ${state.expected}, ` +
          `Kira Studio (${state.serverVersion}) speaks ${state.received}. Both need to be on the ` +
          'same release.',
        'Retry',
      );
      if (action === 'Retry') manager.retry();
      return;
    }
  }
}

async function openRepository(manager: ConnectionManager): Promise<void> {
  // G-UX D4: the workspace's own folders are the only source of repositories — no native
  // folder-picker fallback. G27 D7: a workspace folder's fsPath is filesystem-sourced — the
  // auto-open path repo.open receives on every G12-item-6 auto-open.
  const folders = vscode.workspace.workspaceFolders ?? [];
  let path: string | undefined;
  if (folders.length === 1) {
    path = nfcPath(folders[0].uri.fsPath);
  } else if (folders.length > 1) {
    const picked = await vscode.window.showQuickPick(
      folders.map((folder) => ({ label: folder.name, description: folder.uri.fsPath, folder })),
      { title: 'Open Repository', placeHolder: 'Select a workspace folder' },
    );
    if (!picked) return;
    path = nfcPath(picked.folder.uri.fsPath);
  } else {
    await vscode.window.showInformationMessage(
      "Kira Version follows this window's workspace folders — open a folder first (File → Open Folder).",
    );
    return;
  }
  if (!path) return;

  try {
    const result = await manager.request('repo.open', { path });
    if (result.kind === 'ok') {
      const head =
        result.repo.head.kind === 'branch' || result.repo.head.kind === 'unborn'
          ? result.repo.head.name
          : result.repo.head.kind;
      await vscode.window.showInformationMessage(
        `Kira Version: opened ${result.repo.root} on ${head} (${result.repo.gitDir}).`,
      );
    } else if (result.kind === 'notARepository') {
      await vscode.window.showWarningMessage(
        `Kira Version: ${result.path} is not a git repository.`,
      );
    } else {
      await vscode.window.showWarningMessage(
        `Kira Version: git is unavailable (${result.git.kind}).`,
      );
    }
  } catch (err) {
    await vscode.window.showErrorMessage(`Kira Version: repo.open failed — ${String(err)}`);
  }
}

export function deactivate(): void {
  connection?.dispose();
  connection = undefined;
}
