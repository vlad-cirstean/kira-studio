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

/** One named stream per repo workspace, each its own `gitsession.Conn`/repo hold on the Go side
 *  (`handlers.go`'s own per-connection design, §8) — independent even for two workspaces open on
 *  the same repository. */
function createNativeGitTransport(codeRepoId: string): Transport {
  const remote = createRpcClient(createStreamChannel(Stream('git')));
  const host = createHostHandlers({ remoteRequest: remote.request, codeRepoId });

  return {
    request<K extends RequestKey>(
      method: K,
      params: ParamsOf<K>,
      signal?: AbortSignal,
    ): Promise<ResultOf<K>> {
      const local = host[method];
      return local ? local(params, signal) : remote.request(method, params, signal);
    },
    // Every event (repo.changed, repoSettings.changed) and the one stream (graph.stream)
    // originate entirely in Go — hostHandlers.ts is total over its own request-only key set, so
    // neither of these ever needs a local arm.
    on<K extends EventKey>(method: K, handler: (payload: EventPayload<K>) => void): () => void {
      return remote.on(method, handler);
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
