/**
 * Boundary validation: the versioned envelope. Per §3.5, a contract mismatch must fail loudly
 * rather than half-work — so this throws, it does not degrade. The version is a parameter here,
 * not a constant: it belongs to a module's own contract, not to the protocol, so each module
 * (`@kira/git-ipc`'s `CONTRACT_VERSION`, mirrored on the Go side by `GitContractVersion` /
 * `rpcstream`'s `Handlers.ContractVersion`) binds it once in its own thin wrapper around these
 * functions.
 */
export class ContractVersionMismatchError extends Error {
  readonly received: number;
  readonly expected: number;

  constructor(expected: number, received: number) {
    super(`ipc contract version mismatch: this build expects ${expected}, received ${received}`);
    this.name = 'ContractVersionMismatchError';
    this.received = received;
    this.expected = expected;
  }
}

export function validateVersion(expected: number, received: number): void {
  if (received !== expected) {
    throw new ContractVersionMismatchError(expected, received);
  }
}

export interface VersionedEnvelope<T> {
  readonly version: number;
  readonly body: T;
}

export function wrapVersioned<T>(version: number, body: T): VersionedEnvelope<T> {
  return { version, body };
}

export function unwrapVersioned<T>(version: number, envelope: VersionedEnvelope<T>): T {
  validateVersion(version, envelope.version);
  return envelope.body;
}
