/**
 * `activate`/`deactivate` (G1 §5.4). G1's whole job: dial the socket, handshake, and prove
 * `app.init`/`repo.open` round-trip for real. No webview view is registered yet (D13) — that is
 * G3's first step, once there is a graph to draw.
 *
 * Upstream's `activate()` built an in-process `RepoService` and two webview providers; neither
 * exists here. `coerceSettings`/`readRawSettings` and the `onDidChangeConfiguration` re-coercion
 * are kept — the extension still owns settings (SPEC §5 item 3) — but the two
 * `notifySettingsChanged` calls that used to push into those providers are gone with them,
 * returning in G3.
 */
import {
  coerceSettings,
  SETTINGS,
  type SettingKey,
  type VirtualDocumentSource,
} from '@kira/git-core';
import type { GitStatus } from '@kira/git-ipc';
import * as vscode from 'vscode';
import { ConnectionManager } from './connection.ts';
import { KiraGraphViewProvider } from './panelView.ts';
import { VsCodeClipboard } from './ports/clipboard.ts';
import { VsCodeDialogs } from './ports/dialogs.ts';
import { VsCodeEditorIntegration } from './ports/editorIntegration.ts';
import { VsCodeLogger } from './ports/logger.ts';
import { VsCodeWorkspaceRoots } from './ports/workspaceRoots.ts';
import { createProxyHandlers } from './proxyHandlers.ts';
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

const STATUS_COMMAND = 'kiraVersion.showConnectionStatus';
const OPEN_REPO_COMMAND = 'kiraVersion.openRepository';
// G1 §5.4 removed this command saying it "returns in G3" (D13/D17) — it does, once there is a
// graph view to focus.
const FOCUS_GRAPH_COMMAND = 'kiraVersion.focusGraph';
const GRAPH_VIEW_ID = 'kiraVersion.graph';
const SETTING_KEYS = Object.keys(SETTINGS) as readonly SettingKey[];

function readRawSettings(config: vscode.WorkspaceConfiguration): Record<string, unknown> {
  const raw: Record<string, unknown> = {};
  for (const key of SETTING_KEYS) {
    const value = config.get(key);
    if (value !== undefined) raw[key] = value;
  }
  return raw;
}

let connection: ConnectionManager | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const outputChannel = vscode.window.createOutputChannel('Kira Version');
  context.subscriptions.push(outputChannel);

  let currentSettings = coerceSettings(
    readRawSettings(vscode.workspace.getConfiguration()),
  ).settings;
  const logger = new VsCodeLogger(outputChannel, () => currentSettings['kiraVersion.log.level']);
  const dialogs = new VsCodeDialogs();
  const roots = new VsCodeWorkspaceRoots();
  const clipboard = new VsCodeClipboard();
  const editor = new VsCodeEditorIntegration();

  const appVersion = String(
    (context.extension.packageJSON as { version?: unknown }).version ?? '0.0.0',
  );
  const manager = new ConnectionManager(context, logger.child('connection'), appVersion);
  connection = manager;

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

  // D17/D18: the graph webview view is registered as this phase's own first step -- the graph
  // renders end to end from here on, with refs.list/status.get/undo.peek/stash.list rejecting
  // E_UNKNOWN_METHOD on every repo open until G5/G8 close them (documented, not a regression).
  const handlers = createProxyHandlers({
    connection: manager,
    settings: () => currentSettings,
    roots,
    dialogs,
    clipboard,
    editor,
    logger,
  });
  const graphProvider = new KiraGraphViewProvider({ extensionUri: context.extensionUri, handlers });

  context.subscriptions.push(
    { dispose: () => manager.dispose() },
    vscode.window.registerWebviewViewProvider(GRAPH_VIEW_ID, graphProvider),
    { dispose: manager.on('repo.changed', (payload) => graphProvider.notifyRepoChanged(payload)) },
    manager.onStateChange((state) => {
      logger.log('info', 'connection state', state);
      // §5.4 point 4: this phase's own exit criterion, executing in the real extension — the
      // moment a connection is established, prove app.init round-trips over the real socket.
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
          })
          .catch((err: unknown) => {
            logger.log('error', 'app.init failed', { err: String(err) });
          });
      }
    }),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (!event.affectsConfiguration('kiraVersion')) return;
      const { settings, problems } = coerceSettings(
        readRawSettings(vscode.workspace.getConfiguration()),
      );
      currentSettings = settings;
      for (const problem of problems) {
        logger.log('warn', 'invalid setting, using default', problem);
      }
      graphProvider.notifySettingsChanged(currentSettings);
    }),
    vscode.commands.registerCommand(STATUS_COMMAND, () => showConnectionStatus(manager)),
    vscode.commands.registerCommand(OPEN_REPO_COMMAND, () => openRepository(manager, dialogs)),
    vscode.commands.registerCommand(FOCUS_GRAPH_COMMAND, () => {
      void vscode.commands.executeCommand(`${GRAPH_VIEW_ID}.focus`);
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

async function openRepository(
  manager: ConnectionManager,
  dialogs: { pickFolder: (opts: { title: string }) => Promise<string | null> },
): Promise<void> {
  const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  const path = folder ?? (await dialogs.pickFolder({ title: 'Open Repository' }));
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
