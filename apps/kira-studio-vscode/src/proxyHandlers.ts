/**
 * The composition SPEC §5 items 2-4 describe (G3 plan D18): `app.init`/`repo.list`/`repo.pick`
 * answered locally, `graph.loadMore`/`graph.stream` get D6's `scope`/`pageSize` injected from the
 * current settings snapshot before forwarding, everything else forwards verbatim through
 * `ConnectionManager`. Written now, not in G1 — "a version of it that only forwards would be
 * replaced wholesale by G4" (G1 §5.5) — because G3 is the first phase with enough of the server
 * side (`app.init`'s real `git` status, `repo.list`/`repo.pick`'s own ports, `graph.*`) to make a
 * non-trivial composition worth writing once rather than twice.
 *
 * G4 (D11-D14) is the "wholesale replacement" G1 forecast: `clipboard.write`, `editor.openDiff`,
 * `editor.goToFile` and `editor.resolveConflict` stop forwarding and answer from the extension's
 * own already-migrated ports, `app.init`'s four capabilities flip to `true`, and `repo.open`/
 * `repo.close` grow a side effect — maintaining the `repoId -> root` map `editor.resolveConflict`
 * needs (D13, resolving F11: `RepoID` is only the worktree root for a non-bare repo, so a host
 * method may never `join(repoId, path)` directly). `review.open` is still forwarded and still
 * answers `E_UNKNOWN_METHOD` — the seventh host-capability method, and G6's, not this phase's
 * (D11: wiring it now would reveal a sidebar view that is not registered until G6).
 */
import { basename, join } from 'node:path';
import type {
  Clipboard,
  Dialogs,
  DocumentRef,
  EditorIntegration,
  Logger,
  WorkspaceRoots,
} from '@kira/git-core';
import { mapLineAcrossDiff } from '@kira/git-core';
import type {
  GitStatus,
  RequestHandler,
  RequestKey,
  ServerHandlers,
  SettingsSnapshot,
} from '@kira/git-ipc';
import type { ConnectionManager } from './connection.ts';
import { virtualKey } from './virtualKey.ts';

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
  readonly clipboard: Clipboard;
  readonly editor: EditorIntegration;
  readonly logger: Logger;
}

export function createProxyHandlers(deps: CreateProxyHandlersDeps): ServerHandlers {
  const { connection, settings, roots, dialogs, clipboard, editor, logger } = deps;

  function forward<K extends RequestKey>(method: K): RequestHandler<K> {
    return (params, ctx) => connection.request(method, params, ctx.signal);
  }

  // D13: repo.open's own result already carries the real worktree root (or "" for a bare repo,
  // which has no checkout and therefore no possible conflicted-file path); repo.close drops the
  // entry. editor.resolveConflict is this phase's one consumer — editor.goToFile needs no entry,
  // since file.goToTarget already returns absPath from the side that knows it.
  const repoRoots = new Map<string, string>();

  const requests: ServerHandlers['requests'] = {
    'app.init': async () => {
      const raw = await connection.request('app.init', {});
      const server = raw as unknown as ServerAppInitResult;
      return {
        host: 'vscode',
        contractVersion: server.contractVersion,
        settings: settings(),
        git: server.git,
        // D11: all four host ports are constructed and all four methods now answer.
        capabilities: {
          openInEditor: true,
          goToFile: true,
          clipboard: true,
          resolveConflict: true,
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
    'repo.open': async (params, ctx) => {
      const result = await connection.request('repo.open', params, ctx.signal);
      if (result.kind === 'ok') {
        repoRoots.set(result.repo.repoId, result.repo.root);
      }
      return result;
    },
    'repo.close': async (params, ctx) => {
      repoRoots.delete(params.repoId);
      return connection.request('repo.close', params, ctx.signal);
    },
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
    // D12: composed from commit.detail (server-cached, D7) rather than a separate fileDiff fetch
    // — a whole patch is never re-shipped just to read baseSha/change off it.
    'editor.openDiff': async ({ repoId, sha, path, parentIndex }, ctx) => {
      const detail = await connection.request(
        'commit.detail',
        { repoId, sha, parentIndex },
        ctx.signal,
      );
      const change = detail.files.find((f) => f.path === path);
      if (!change) {
        throw new Error(`editor.openDiff: ${path} is not one of commit ${sha}'s changed files`);
      }
      const baseSha = detail.parents[detail.parentIndex] ?? null;
      const oldPath = change.originalPath ?? path;

      const left: DocumentRef =
        change.kind === 'added' || baseSha === null
          ? { kind: 'empty', label: basename(oldPath) }
          : {
              kind: 'virtual',
              key: virtualKey(repoId, baseSha, oldPath),
              label: basename(oldPath),
            };
      const right: DocumentRef =
        change.kind === 'deleted'
          ? { kind: 'empty', label: basename(path) }
          : { kind: 'virtual', key: virtualKey(repoId, sha, path), label: basename(path) };

      const shortSha = sha.slice(0, 7);
      await editor.openDiff({
        left,
        right,
        title: `${basename(path)} (${shortSha}^ ↔ ${shortSha})`,
      });
      return {};
    },
    // D4/D11: the server resolves the on-disk-vs-object-database decision and (for a live file)
    // the drift hunks; the line arithmetic itself stays here, over @kira/git-core's already-tested
    // mapLineAcrossDiff — never a second, unproven Go implementation of the same trickiest math.
    'editor.goToFile': async ({ repoId, rev, path, line }, ctx) => {
      const target = await connection.request('file.goToTarget', { repoId, rev, path }, ctx.signal);
      switch (target.kind) {
        case 'live': {
          const finalLine =
            target.hunks !== null ? mapLineAcrossDiff(target.hunks, line, 'old') : line;
          await editor.reveal({ kind: 'file', path: target.absPath }, finalLine);
          return { kind: 'liveFile', path, line: finalLine };
        }
        case 'historical': {
          await editor.reveal(
            {
              kind: 'virtual',
              key: virtualKey(repoId, target.rev, target.path),
              label: basename(target.path),
            },
            line,
          );
          return { kind: 'virtualBlob', path: target.path, rev: target.rev, line };
        }
        case 'unavailable':
          return target;
      }
    },
    'clipboard.write': async ({ text, label }) => {
      try {
        await clipboard.writeText(text);
      } catch (err) {
        // Never the text itself (§6.4) — only the label, which is what the log line needs to be
        // useful without ever risking a whole commit message or file path in a log file.
        logger.log('warn', 'clipboard.write failed', { label, err: String(err) });
        throw err; // propagates so toWireError carries the reason to the UI — silence is the one
        // unacceptable outcome here.
      }
      logger.log('debug', 'clipboard.write', { label });
      return {};
    },
    'refs.list': forward('refs.list'),
    'status.get': forward('status.get'),
    'preflight.checkout': forward('preflight.checkout'),
    'preflight.revert': forward('preflight.revert'),
    'op.run': forward('op.run'),
    'undo.peek': forward('undo.peek'),
    'undo.run': forward('undo.run'),
    // D13: an absolute path over the repo's own root — never repoId, which is only the root for a
    // non-bare repo (F11) — refused with a clear error when the repo is unknown or bare (a bare
    // repo has no checkout and therefore cannot have a conflicted file at all).
    'editor.resolveConflict': async ({ repoId, path }) => {
      const root = repoRoots.get(repoId);
      if (!root) {
        throw new Error(
          `editor.resolveConflict: repo ${repoId} has no known worktree root (not open, or bare)`,
        );
      }
      await editor.resolveConflict({ path: join(root, path) });
      return {};
    },
    'review.resolveBase': forward('review.resolveBase'),
    'review.open': forward('review.open'), // G6: still forwarded, still E_UNKNOWN_METHOD (D11).
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
