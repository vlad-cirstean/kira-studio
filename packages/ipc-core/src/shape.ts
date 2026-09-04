// ---------------------------------------------------------------------------------------
// createContractShapeAsserter — a per-key structural check on arrival, factored over a
// module's own key sets rather than hardcoding one module's vocabulary.
// ---------------------------------------------------------------------------------------

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

/** The complete method-name lists for one module's contract, mirroring its `Contract`'s keys.
 *  TypeScript's own exhaustiveness checking cannot reach across a wire, so these are the runtime
 *  half of the same guarantee for whichever module hands them to `createContractShapeAsserter`. */
export interface ContractKeys {
  readonly requests: ReadonlySet<string>;
  readonly events: ReadonlySet<string>;
  readonly streams: ReadonlySet<string>;
}

function keysForChannel(keys: ContractKeys, channel: ContractChannel): ReadonlySet<string> {
  switch (channel) {
    case 'request':
      return keys.requests;
    case 'event':
      return keys.events;
    case 'stream':
      return keys.streams;
  }
}

/**
 * Builds a per-key structural check on arrival, not a schema library: the wire is trusted-but-
 * versioned between two halves of one build (§3.5). `validateVersion` rules out a stale build
 * talking to a fresh one; the returned function rules out the one thing a version number alone
 * cannot catch — a method name or a `kind` discriminant that could not have come from this
 * contract at all. It does not re-validate every field, since a single build's own type-checker
 * already guarantees that; it exists for the boundary between two different builds.
 */
export function createContractShapeAsserter(
  keys: ContractKeys,
): (channel: ContractChannel, method: string, payload: unknown) => void {
  return (channel: ContractChannel, method: string, payload: unknown): void => {
    if (!keysForChannel(keys, channel).has(method)) {
      throw new ContractShapeError(channel, method, `unknown ${channel} method`);
    }
    if (payload === null || typeof payload !== 'object') {
      throw new ContractShapeError(channel, method, 'payload is not an object');
    }
    const record = payload as Record<string, unknown>;
    if ('kind' in record && typeof record.kind !== 'string') {
      throw new ContractShapeError(channel, method, "'kind' discriminant is not a string");
    }
  };
}
