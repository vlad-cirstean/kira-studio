/**
 * The composition SPEC §5 items 2-4 describe (G3 plan D18): `app.init`/`repo.list`/`repo.pick`
 * answered locally, `graph.loadMore`/`graph.stream` get D6's `scope`/`pageSize` injected from the
 * current settings snapshot before forwarding, everything else forwards verbatim through
 * `ConnectionManager`. Written now, not in G1 — "a version of it that only forwards would be
 * replaced wholesale by G4" (G1 §5.5) — because G3 is the first phase with enough of the server
 * side (`app.init`'s real `git` status, `repo.list`/`repo.pick`'s own ports, `graph.*`) to make a
 * non-trivial composition worth writing once rather than twice.
 */
import type { Dialogs, WorkspaceRoots } from '@kira/git-core';
import type {
  GitStatus,
  RequestHandler,
  RequestKey,
  ServerHandlers,
  SettingsSnapshot,
} from '@kira/git-ipc';
import type { ConnectionManager } from './connection.ts';

// D11: the server contract's own app.init is the webview contract's AppInitResult minus host/
// settings/capabilities (SPEC §5 item 3 assigns those to the extension) — mirrors
// internal/gitrpc/wire.go's AppInitResult field for field, cast rather than trusted at the
// webview contract's own type the way extension.ts's own probe call already does.
interface ServerAppInitResult {
  readonly contractVersion: number;
  readonly serverVersion: string;
  readonly git: GitStatus;
}

export interface CreateProxyHandlersDeps {
  readonly connection: ConnectionManager;
  readonly settings: () => SettingsSnapshot;
  readonly roots: WorkspaceRoots;
  readonly dialogs: Dialogs;
}

export function createProxyHandlers(deps: CreateProxyHandlersDeps): ServerHandlers {
  const { connection, settings, roots, dialogs } = deps;

  function forward<K extends RequestKey>(method: K): RequestHandler<K> {
    return (params, ctx) => connection.request(method, params, ctx.signal);
  }

  const requests: ServerHandlers['requests'] = {
    'app.init': async () => {
      const raw = await connection.request('app.init', {});
      const server = raw as unknown as ServerAppInitResult;
      return {
        host: 'vscode',
        contractVersion: server.contractVersion,
        settings: settings(),
        git: server.git,
        // The remaining four host-capability methods are unanswered until G4's ports wire in —
        // reported honestly false, which is what this block is for (contract.ts: "an optional
        // capability the UI feature-detects rather than assumes").
        capabilities: {
          openInEditor: false,
          goToFile: false,
          clipboard: false,
          resolveConflict: false,
        },
      };
    },
    'repo.list': async () => {
      const candidates = await roots.list();
      // No persisted "last active repo" surface exists yet (rehydration is App.vue's own
      // persisted-state path, D7) — the picker always starts with nothing pre-selected.
      return { candidates, activeRepoId: null };
    },
    'repo.pick': async () => {
      const path = await dialogs.pickFolder({ title: 'Open Repository' });
      return { path };
    },
    'repo.open': forward('repo.open'),
    'repo.close': forward('repo.close'),
    'graph.status': forward('graph.status'),
    'graph.loadMore': (params, ctx) => {
      const snap = settings();
      return connection.request(
        'graph.loadMore',
        {
          ...params,
          scope: snap['kiraVersion.graph.scope'],
          pageSize: snap['kiraVersion.graph.pageSize'],
        },
        ctx.signal,
      );
    },
    'graph.refresh': forward('graph.refresh'),
    'commit.detail': forward('commit.detail'),
    'commit.fileDiff': forward('commit.fileDiff'),
    'editor.openDiff': forward('editor.openDiff'),
    'editor.goToFile': forward('editor.goToFile'),
    'clipboard.write': forward('clipboard.write'),
    'refs.list': forward('refs.list'),
    'status.get': forward('status.get'),
    'preflight.checkout': forward('preflight.checkout'),
    'preflight.revert': forward('preflight.revert'),
    'op.run': forward('op.run'),
    'undo.peek': forward('undo.peek'),
    'undo.run': forward('undo.run'),
    'editor.resolveConflict': forward('editor.resolveConflict'),
    'review.resolveBase': forward('review.resolveBase'),
    'review.open': forward('review.open'),
    'remote.pullPreflight': forward('remote.pullPreflight'),
    'remote.pushPreflight': forward('remote.pushPreflight'),
    'remote.run': forward('remote.run'),
    'remote.cancel': forward('remote.cancel'),
    'stash.list': forward('stash.list'),
    'stash.show': forward('stash.show'),
    'preflight.stashPop': forward('preflight.stashPop'),
    'preflight.stashBranch': forward('preflight.stashBranch'),
    'preflight.reset': forward('preflight.reset'),
    'preflight.cherryPick': forward('preflight.cherryPick'),
    'search.run': forward('search.run'),
    // G4 D3/F12: server-only, never called by the webview — plain forwarders are enough
    // (ServerHandlers.requests is total over RequestKey, so both need an entry regardless).
    'file.read': forward('file.read'),
    'file.goToTarget': forward('file.goToTarget'),
  };

  const streams: ServerHandlers['streams'] = {
    'graph.stream': (params, ctx) => {
      const snap = settings();
      return connection.stream(
        'graph.stream',
        {
          ...params,
          scope: snap['kiraVersion.graph.scope'],
          pageSize: snap['kiraVersion.graph.pageSize'],
        },
        (chunk) => ctx.emit(chunk),
        ctx.signal,
      );
    },
  };

  return { requests, streams };
}
