import { TransportError } from '@kira/git-ipc';

/** `createLatestRequest`'s cancellation predicate for git-ui: an aborted transport call. */
export function isCancelledTransport(error: unknown): boolean {
  return error instanceof TransportError && error.code === 'cancelled';
}
