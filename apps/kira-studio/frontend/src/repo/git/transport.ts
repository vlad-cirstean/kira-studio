/**
 * C10 §3.5/§8 (S12) — the native `Transport` git-ui's `mount()` is handed, and the per-repo-
 * workspace cache over it (§8: "one transport per repo workspace, not per mount").
 *
 * VS Code has three tiers: webview -> (postMessage) -> extension host -> (socket) -> Go. The
 * middle tier's *job* still exists here — `editor.openDiff`, `clipboard.write`, `app.init`'s host
 * half and `repo.list` are host concerns the Go server has no case for — but its *process* does
 * not: this app has two tiers, not three. So this implements `Transport` directly, dispatching
 * per method to `hostHandlers.ts`'s own map or forwarding to the git stream, rather than stacking
 * a second `createRpcClient`/`createRpcServer` correlation layer inside one JS context to move
 * objects between two halves of the same heap that never needed splitting in the first place.
 *
 * No length prefix, no pairing, no trust store: `streamChannel.ts` (S2) is message-framed already,
 * and `internal/bridge/gitstream.go`'s own doc comment states why there is no handshake — the peer
 * is this process's own webview, not an external client a trust store exists to gate
 * (`docs/v1.5/plans/C10-git-graph-native.md` §3.2).
 *
 * C11 §8.1 (S4) adds a small local event bus alongside the remote one: `review.target` and
 * `ui.action` are composed host-side (`review.open`'s handler, and the repaint choreography below)
 * and Go never emits either — the honest native analogue of what `KiraReviewViewProvider` does
 * with `this.#server?.emit(...)`, not a workaround. §7.6's repaint choreography lives here too,
 * as a post-processing step over `request()`: both halves of the review UI (the panel's own pane
 * components and `reviewDecorations.ts`'s Monaco layer, S9) share one `Transport` per repo
 * workspace, so a mutation's success is the one place to fan a repaint out to both.
 */
import type {
  EventKey,
  EventPayload,
  ParamsOf,
  RequestKey,
  ResultOf,
  StreamChunkOf,
  StreamKey,
  StreamParamsOf,
  Transport,
} from '@kira/git-ipc';
import { createRpcClient, createStreamChannel } from '@kira/git-ipc';
// tsconfig.json maps this specifier onto @wailsio/runtime's real types (see bridge/port.ts's own
// identical comment) and resolves it cleanly under typecheck:web; tests/unit's own project has no
// such mapping (breaks Bun's mock.module interception for every transitive importer), so this
// stays the suppress-if-present directive that file already established, not the require-an-error
// kind (which would itself fail where this resolves fine).
// biome-ignore lint/suspicious/noTsIgnore: an "unused directive" kind fails where this resolves fine (see comment above)
// @ts-ignore
import { Stream } from '/wails/runtime.js';
import { createHostHandlers } from './hostHandlers';

/** The two `EventKey`s this host answers itself rather than forwarding to `remote.on` — never
 *  emitted by Go (§8.1). */
const LOCAL_EVENT_KEYS: ReadonlySet<EventKey> = new Set(['review.target', 'ui.action']);

/** A minimal typed pub-sub — all `emitLocal`/`on` need for the two events above. One instance per
 *  transport (per repo workspace), matching `remote.on`'s own scoping. */
function createLocalEmitter(): {
  on<K extends EventKey>(method: K, handler: (payload: EventPayload<K>) => void): () => void;
  emit<K extends EventKey>(method: K, payload: EventPayload<K>): void;
} {
  const handlersByMethod = new Map<EventKey, Set<(payload: unknown) => void>>();
  return {
    on(method, handler) {
      let handlers = handlersByMethod.get(method);
      if (!handlers) {
        handlers = new Set();
        handlersByMethod.set(method, handlers);
      }
      const asUnknown = handler as (payload: unknown) => void;
      handlers.add(asUnknown);
      return () => {
        handlersByMethod.get(method)?.delete(asUnknown);
      };
    },
    emit(method, payload) {
      for (const handler of handlersByMethod.get(method) ?? []) handler(payload);
    },
  };
}

// §7.6's repaint table, the two mutation-triggered rows — `repo.changed` needs no entry here,
// since it already crosses as an ordinary Go-emitted event `reviewDecorations.ts` subscribes to
// directly via `transport.on`. Module-level, not per-transport: a listener (one per open review
// diff editor, S9) filters by its own `(repoId, branch)` or `path`, so one registry serves every
// open repo workspace.
export type ReviewRepaintEvent =
  | { readonly kind: 'comments'; readonly repoId: string; readonly branch: string }
  | {
      readonly kind: 'mark';
      readonly repoId: string;
      readonly branch: string;
      readonly path: string;
    };

const reviewRepaintListeners = new Set<(event: ReviewRepaintEvent) => void>();

/** Registered by `views/repo/reviewDecorations.ts` (S9), one per mounted review diff editor. */
export function onReviewRepaint(listener: (event: ReviewRepaintEvent) => void): () => void {
  reviewRepaintListeners.add(listener);
  return () => {
    reviewRepaintListeners.delete(listener);
  };
}

function fireReviewRepaint(event: ReviewRepaintEvent): void {
  for (const listener of reviewRepaintListeners) listener(event);
}

const COMMENT_MUTATION_METHODS: ReadonlySet<RequestKey> = new Set([
  'review.comment.add',
  'review.comment.remove',
  'review.comment.clear',
]);

/** One named stream per repo workspace, each its own `gitsession.Conn`/repo hold on the Go side
 *  (`handlers.go`'s own per-connection design, §8) — independent even for two workspaces open on
 *  the same repository. */
function createNativeGitTransport(codeRepoId: string): Transport {
  const remote = createRpcClient(createStreamChannel(Stream('git')));
  const local = createLocalEmitter();
  const host = createHostHandlers({
    remoteRequest: remote.request,
    codeRepoId,
    emitLocal: local.emit,
  });

  return {
    request<K extends RequestKey>(
      method: K,
      params: ParamsOf<K>,
      signal?: AbortSignal,
    ): Promise<ResultOf<K>> {
      const handler = host[method];
      const result = handler ? handler(params, signal) : remote.request(method, params, signal);
      // §7.6: repaint every open review surface once a mutation actually succeeds, regardless of
      // which half of the UI made the call (the panel's own Comments pane and this Monaco layer
      // share this one Transport per repo workspace) — never on a rejected request.
      if (method === 'review.mark') {
        const { repoId, branch, path } = params as unknown as {
          repoId: string;
          branch: string;
          path: string;
        };
        return result.then((value) => {
          fireReviewRepaint({ kind: 'mark', repoId, branch, path });
          return value;
        });
      }
      if (COMMENT_MUTATION_METHODS.has(method)) {
        const { repoId, branch } = params as unknown as { repoId: string; branch: string };
        return result.then((value) => {
          fireReviewRepaint({ kind: 'comments', repoId, branch });
          local.emit('ui.action', { action: 'refreshReviewComments' });
          return value;
        });
      }
      return result;
    },
    // Every event Go emits (repo.changed, repoSettings.changed) and the one stream (graph.stream)
    // still forward to remote — only review.target/ui.action are ever local (§8.1).
    on<K extends EventKey>(method: K, handler: (payload: EventPayload<K>) => void): () => void {
      return LOCAL_EVENT_KEYS.has(method) ? local.on(method, handler) : remote.on(method, handler);
    },
    stream<K extends StreamKey>(
      method: K,
      params: StreamParamsOf<K>,
      onChunk: (chunk: StreamChunkOf<K>) => void,
      signal?: AbortSignal,
    ): Promise<void> {
      return remote.stream(method, params, onChunk, signal);
    },
    dispose(): void {
      remote.dispose();
    },
  };
}

const transportsByCodeRepoId = new Map<string, Transport>();

/** One transport per repo workspace (§8), cached across mount/unmount of the pinned graph tab —
 *  a tab switch unmounts `RepoGraphView.vue` (C5), and a cold remount must reuse the SAME
 *  transport rather than opening a second stream and losing whatever repo hold the first one
 *  took. Disposed only when the workspace itself closes (`state/workspace.ts`, S17), never on a
 *  mere tab-hide. */
export function gitTransportFor(codeRepoId: string): Transport {
  let transport = transportsByCodeRepoId.get(codeRepoId);
  if (!transport) {
    transport = createNativeGitTransport(codeRepoId);
    transportsByCodeRepoId.set(codeRepoId, transport);
  }
  return transport;
}

/** S17: called from the repo workspace's own close path. A no-op for a workspace whose graph tab
 *  was never mounted (no transport was ever created). */
export function disposeGitTransport(codeRepoId: string): void {
  const transport = transportsByCodeRepoId.get(codeRepoId);
  if (!transport) return;
  transportsByCodeRepoId.delete(codeRepoId);
  transport.dispose();
}
