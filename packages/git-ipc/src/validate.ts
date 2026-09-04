import {
  createContractShapeAsserter,
  unwrapVersioned as unwrapAtVersion,
  type VersionedEnvelope,
  validateVersion as validateAtVersion,
  wrapVersioned as wrapAtVersion,
} from '@kira/ipc-core';
import type { EventKey, RequestKey, StreamKey } from './contract';

/** Bumped whenever the frame union or a contract entry changes; bridge/git.go's
 *  GitContractVersion mirrors it, and internal/bridge/rpcstream carries it as a Handlers field. */
export const CONTRACT_VERSION = 3;

export const validateVersion = (received: number): void =>
  validateAtVersion(CONTRACT_VERSION, received);
export const wrapVersioned = <T>(body: T): VersionedEnvelope<T> =>
  wrapAtVersion(CONTRACT_VERSION, body);
export const unwrapVersioned = <T>(envelope: VersionedEnvelope<T>): T =>
  unwrapAtVersion(CONTRACT_VERSION, envelope);

// The complete method-name lists, mirroring Contract's keys — the runtime half of a guarantee
// TypeScript cannot make across a wire. NOTE (F8): the ReadonlySet<RequestKey> annotation rejects a
// key that is not in Contract, but nothing here requires every Contract key to be listed; OQ-3
// carries that gap.
const REQUEST_KEYS: ReadonlySet<RequestKey> = new Set([
  'app.init',
  'repo.list',
  'repo.pick',
  'repo.open',
  'repo.close',
  'graph.status',
  'graph.loadMore',
  'graph.refresh',
]);
const EVENT_KEYS: ReadonlySet<EventKey> = new Set(['repo.changed', 'settings.changed']);
const STREAM_KEYS: ReadonlySet<StreamKey> = new Set(['graph.stream']);

export const assertContractShape = createContractShapeAsserter({
  requests: REQUEST_KEYS,
  events: EVENT_KEYS,
  streams: STREAM_KEYS,
});
