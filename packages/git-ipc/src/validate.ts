import type { EventKey, RequestKey, StreamKey } from './contract.ts';

/**
 * Boundary validation. Per §3.5, a contract mismatch must fail loudly rather than
 * half-work — so this throws, it does not degrade.
 */
// G10 D9: 16 -> 17 for one new event, 'ui.action' — the palette's own route into an already-
// mounted webview (see contract.ts's own doc comment on UiActionKind). This is the one place G10
// touches the wire contract; every other change this phase makes is packaging mechanics.
// G11 D1: 17 -> 18 for three new requests (review.files, review.fileDiff, review.mark) and one new
// UiActionKind member ('toggleFileReviewed').
// G12 D1: 18 -> 19 for one new request, 'editor.openRangeDiff' — a two-revision diff for the
// review sidebar's Files pane, answered entirely inside the extension (never emitted or parsed by
// the Go server), the same "extension-answered but the sole compatibility authority still moves"
// precedent G10 D9 set for 'ui.action'.
// G13 D1: 19 -> 20 for five new requests ('review.comment.add/list/remove/clear/export'),
// 'editor.openRangeDiff's reshaped params (D8), and two new UiActionKind members
// ('copyReviewComments', 'refreshReviewComments').
// G14 D6/D10: 20 -> 21, one bump for two reasons landing in the same phase. D6:
// SettingsSnapshot gains the host-owned 'workbench.tree.indent' member. D10: UiActionKind gains
// 'revealCommit' and 'ui.action' gains an optional 'target' naming the commit to reveal — both
// extension-side only (the Go server neither emits nor parses either), the same "the sole
// compatibility authority still moves" precedent G10 D9/G12 D1 set.
// G18 D5: 21 -> 22, for three new requests (repoSettings.get/set, settings.setGitPath) and one
// new event (repoSettings.changed) — seven kiraVersion.* settings move out of
// contributes.configuration into their own per-repo store (D1/D3/D4); git.path's own dead
// server-side wiring is fixed in the same phase (D15) and its one-time migration leg needs its
// own tiny server-only request (D11) since git.path was never part of the per-repo store
// repoSettings.set writes. SettingsSnapshot narrows to its one remaining member
// (workbench.tree.indent); the seven moved keys now live in the new RepoSettingsSnapshot.
// G19 D11b: 22 -> 23, for two new requests ('review.session.save'/'review.session.load') — the
// review sidebar's durable "back to branch selection" resume point, additive only, answered
// entirely inside the extension against `context.workspaceState` and never reaching the Go
// backend (the same "extension-answered but the sole compatibility authority still moves"
// precedent G10 D9/G12 D1/G14 D6/D10 already established). No existing method's shape changes.
// G21 D8/D12/D13: 23 -> 24, one bump for three additive changes landing across this phase's own
// commits (stated here so it is never discovered piecemeal in a diff): one new request,
// 'editor.openAllChanges' (D8, the "Open all changes" multi-file diff, extension-answered like
// every 'editor.*' request before it); 'editor.openDiff' gains optional 'pinned' (D13) and
// 'fallbackSha' (D12, the stash-untracked-file retry); 'editor.openRangeDiff' gains the same
// optional 'pinned' (D13). No existing method's shape changes — every addition is optional.
export const CONTRACT_VERSION = 24;

export class ContractVersionMismatchError extends Error {
  readonly received: number;

  constructor(received: number) {
    super(
      `ipc contract version mismatch: this build expects ${CONTRACT_VERSION}, received ${received}`,
    );
    this.name = 'ContractVersionMismatchError';
    this.received = received;
  }
}

export function validateVersion(received: number): void {
  if (received !== CONTRACT_VERSION) {
    throw new ContractVersionMismatchError(received);
  }
}

export interface VersionedEnvelope<T> {
  readonly version: number;
  readonly body: T;
}

export function wrapVersioned<T>(body: T): VersionedEnvelope<T> {
  return { version: CONTRACT_VERSION, body };
}

export function unwrapVersioned<T>(envelope: VersionedEnvelope<T>): T {
  validateVersion(envelope.version);
  return envelope.body;
}

// ---------------------------------------------------------------------------------------
// assertContractShape — a per-key structural check on arrival.
// ---------------------------------------------------------------------------------------

/**
 * The complete method-name lists, mirroring `Contract`'s keys. TypeScript's own exhaustiveness
 * checking cannot reach across a wire, so these are the runtime half of the same guarantee — but
 * a plain `Set<RequestKey>` literal is only checked for *extra* keys, not missing ones (adding a
 * key to `Contract["requests"]` and forgetting it here compiles cleanly, and previously did:
 * `docs/plans/P8.md` W21 found all four `remote.*` requests and `remote.progress` missing from
 * these three sets, silently failing every `assertContractShape` call for them since W17 added
 * them to `Contract` (`RpcError: ipc contract shape error … unknown request method`) with nothing
 * short of an E2E test through the real codec ever exercising this path to catch it — `mockBridge`
 * calls its handlers directly, `repoService`'s own integration tests never round-trip through
 * `assertContractShape`). Built through a `Record<Key, true>` rather than an array literal so a
 * *missing* key is a compile error too — TypeScript's mapped-type checker requires every key of
 * `RequestKey`/`EventKey`/`StreamKey` to be present, which a bare array can never enforce.
 */
const REQUEST_KEY_MAP: Record<RequestKey, true> = {
  'app.init': true,
  'repo.list': true,
  'repo.pick': true,
  'repo.open': true,
  'repo.close': true,
  'graph.status': true,
  'graph.loadMore': true,
  'graph.refresh': true,
  'commit.detail': true,
  'commit.fileDiff': true,
  'editor.openDiff': true,
  'editor.openRangeDiff': true,
  'editor.openAllChanges': true,
  'editor.goToFile': true,
  'clipboard.write': true,
  'refs.list': true,
  'status.get': true,
  'preflight.checkout': true,
  'preflight.revert': true,
  'op.run': true,
  'undo.peek': true,
  'undo.run': true,
  'editor.resolveConflict': true,
  'review.resolveBase': true,
  'review.open': true,
  'review.files': true,
  'review.fileDiff': true,
  'review.mark': true,
  'review.comment.add': true,
  'review.comment.list': true,
  'review.comment.remove': true,
  'review.comment.clear': true,
  'review.comment.export': true,
  'remote.pullPreflight': true,
  'remote.pushPreflight': true,
  'remote.run': true,
  'remote.cancel': true,
  'credential.provide': true,
  'stash.list': true,
  'stash.show': true,
  'preflight.stashPop': true,
  'preflight.stashBranch': true,
  'preflight.reset': true,
  'preflight.cherryPick': true,
  'search.run': true,
  'file.read': true,
  'file.goToTarget': true,
  'repoSettings.get': true,
  'repoSettings.set': true,
  'settings.setGitPath': true,
  'review.session.save': true,
  'review.session.load': true,
};
const EVENT_KEY_MAP: Record<EventKey, true> = {
  'repo.changed': true,
  'settings.changed': true,
  'review.target': true,
  'remote.progress': true,
  'credential.request': true,
  'ui.action': true,
  'repoSettings.changed': true,
};
const STREAM_KEY_MAP: Record<StreamKey, true> = {
  'graph.stream': true,
};
const REQUEST_KEYS: ReadonlySet<RequestKey> = new Set(Object.keys(REQUEST_KEY_MAP) as RequestKey[]);
const EVENT_KEYS: ReadonlySet<EventKey> = new Set(Object.keys(EVENT_KEY_MAP) as EventKey[]);
const STREAM_KEYS: ReadonlySet<StreamKey> = new Set(Object.keys(STREAM_KEY_MAP) as StreamKey[]);

export type ContractChannel = 'request' | 'event' | 'stream';

export class ContractShapeError extends Error {
  readonly channel: ContractChannel;
  readonly method: string;

  constructor(channel: ContractChannel, method: string, reason: string) {
    super(`ipc contract shape error on ${channel} '${method}': ${reason}`);
    this.name = 'ContractShapeError';
    this.channel = channel;
    this.method = method;
  }
}

function keysForChannel(channel: ContractChannel): ReadonlySet<string> {
  switch (channel) {
    case 'request':
      return REQUEST_KEYS;
    case 'event':
      return EVENT_KEYS;
    case 'stream':
      return STREAM_KEYS;
  }
}

/**
 * A per-key structural check on arrival, not a schema library: the wire is trusted-but-
 * versioned between two halves of one build (§3.5). `validateVersion` rules out a stale build
 * talking to a fresh one; this rules out the one thing a version number alone cannot catch — a
 * method name or a `kind` discriminant that could not have come from this contract at all.
 * It does not re-validate every field, since a single build's own type-checker already
 * guarantees that; it exists for the boundary between two different builds.
 */
export function assertContractShape(
  channel: ContractChannel,
  method: string,
  payload: unknown,
): void {
  if (!keysForChannel(channel).has(method)) {
    throw new ContractShapeError(channel, method, `unknown ${channel} method`);
  }
  if (payload === null || typeof payload !== 'object') {
    throw new ContractShapeError(channel, method, 'payload is not an object');
  }
  const record = payload as Record<string, unknown>;
  if ('kind' in record && typeof record.kind !== 'string') {
    throw new ContractShapeError(channel, method, "'kind' discriminant is not a string");
  }
}
