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
// P62 §4.5: the blame annotation's click-through needs to push `ui.action` the same way
// review.open's own handler does (§8.1's local event bus) — but from
// views/repo/blameAnnotation.ts, which is not a hostHandlers.ts request handler and so has no
// `emitLocal` closure of its own. Keyed by codeRepoId (not the git repoId) so this module — the
// one that actually owns each repo workspace's local emitter — can be asked directly.
const localEmittersByCodeRepoId = new Map<string, ReturnType<typeof createLocalEmitter>>();

/** A no-op for a codeRepoId whose graph tab (and therefore transport) was never mounted — nothing
 *  is listening yet, the same "cold" outcome every other local-bus emission already tolerates
 *  (`review.open`'s own `emitLocal` call has the identical property while the review sidebar is
 *  unmounted). */
export function emitUiAction(codeRepoId: string, payload: EventPayload<'ui.action'>): void {
  localEmittersByCodeRepoId.get(codeRepoId)?.emit('ui.action', payload);
}

function createNativeGitTransport(codeRepoId: string): Transport {
  const remote = createRpcClient(createStreamChannel(Stream('git')));
  const local = createLocalEmitter();
  localEmittersByCodeRepoId.set(codeRepoId, local);
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

/** An `AbortController` that aborts as soon as either input signal does. Not `AbortSignal.any` —
 *  this repo does not rely on it anywhere else, and this is the phase's only use. */
function linkAbort(a: AbortSignal, b?: AbortSignal): AbortSignal {
  if (!b) return a;
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  if (a.aborted || b.aborted) {
    controller.abort();
  } else {
    a.addEventListener('abort', onAbort, { once: true });
    b.addEventListener('abort', onAbort, { once: true });
  }
  return controller.signal;
}

/** One real client per repo workspace, plus every outstanding lease on it (P67b §2.1). */
interface SharedClient {
  readonly transport: Transport;
  readonly leases: Set<Transport>;
}

/** A fresh view onto `shared.transport` per `gitTransportFor` call. `request` is deliberately
 *  untracked — an orphaned response from a departed mount resolves into a dead closure, exactly
 *  as it already does today for call sites (`RepoDiffView.vue`, `RepoFileView.vue`) that never
 *  dispose anything. `on` and `stream` ARE tracked, so a departed mount's subscriptions and
 *  long-lived streams (`graph.stream`) actually stop instead of quietly leaking. `dispose()`
 *  releases only this lease's own registrations and NEVER closes the underlying socket — that is
 *  `disposeGitTransport`'s job alone. */
function leaseOf(shared: SharedClient): Transport {
  const unsubs = new Set<() => void>();
  const streams = new AbortController();
  let released = false;
  const lease: Transport = {
    request(method, params, signal) {
      return shared.transport.request(method, params, signal);
    },
    on(method, handler) {
      if (released) return () => {};
      const off = shared.transport.on(method, handler);
      unsubs.add(off);
      return () => {
        unsubs.delete(off);
        off();
      };
    },
    stream(method, params, onChunk, signal) {
      return shared.transport.stream(method, params, onChunk, linkAbort(streams.signal, signal));
    },
    dispose(): void {
      if (released) return;
      released = true;
      for (const off of unsubs) off();
      unsubs.clear();
      streams.abort();
      shared.leases.delete(lease);
    },
  };
  shared.leases.add(lease);
  return lease;
}

const sharedClientsByCodeRepoId = new Map<string, SharedClient>();

/** One transport LEASE per call (§2.1), over one shared client per repo workspace — cached across
 *  mount/unmount of the pinned graph tab, so a cold remount reuses the same underlying stream
 *  rather than opening a second one and losing whatever repo hold the first took. Never returns
 *  the same object twice: each caller (`RepoGraphView.vue`, `RepoReviewView.vue`,
 *  `RepoDiffView.vue`, `RepoFileView.vue`) gets its own lease, so one mount tearing its lease down
 *  on unmount no longer kills every other mount sharing the workspace. The shared client itself is
 *  disposed only when the workspace closes (`state/workspace.ts`, S17), never on a mere tab-hide. */
export function gitTransportFor(codeRepoId: string): Transport {
  let shared = sharedClientsByCodeRepoId.get(codeRepoId);
  if (!shared) {
    shared = { transport: createNativeGitTransport(codeRepoId), leases: new Set() };
    sharedClientsByCodeRepoId.set(codeRepoId, shared);
  }
  return leaseOf(shared);
}

/** S17: called from the repo workspace's own close path. A no-op for a workspace whose graph tab
 *  was never mounted (no shared client was ever created). Disposes every outstanding lease first,
 *  then the shared client — so a workspace close still ends in exactly one `channel.close()`. */
export function disposeGitTransport(codeRepoId: string): void {
  const shared = sharedClientsByCodeRepoId.get(codeRepoId);
  if (!shared) return;
  sharedClientsByCodeRepoId.delete(codeRepoId);
  localEmittersByCodeRepoId.delete(codeRepoId);
  for (const lease of [...shared.leases]) lease.dispose();
  shared.transport.dispose();
}
