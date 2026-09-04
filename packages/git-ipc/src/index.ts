// Git's own contract — the only thing in this package that is about Git. This line is unchanged
// from today's, all 18 names included: contract.ts is a zero-line diff (D8).

// Contract-independent machinery, re-exported so `git-ui` still depends on exactly two packages
// (docs/v1.3/SPEC.md). Not a compatibility shim — see D7: the files themselves are gone, this is
// the module facade naming what its own IPC surface includes.
export type {
  ContractChannel,
  EncodedMessage,
  MessageChannelLike,
  TransportErrorCode,
  VersionedEnvelope,
  WireError,
} from '@kira/ipc-core';
export {
  ContractShapeError,
  ContractVersionMismatchError,
  decode,
  dedupeTransferList,
  encode,
  RpcError,
  TransportError,
} from '@kira/ipc-core';
export type {
  Contract,
  DecorationRef,
  EventKey,
  EventPayload,
  GitStatus,
  HeadState,
  HostKind,
  PackedCommitChunk,
  ParamsOf,
  RepoCandidate,
  RepoOpenResult,
  RepoSummary,
  RequestKey,
  ResultOf,
  SettingsSnapshot,
  StreamChunkOf,
  StreamKey,
  StreamParamsOf,
} from './contract';
// The five names that genuinely are instantiations of the generic machinery (D7).
export type {
  RequestHandler,
  RpcServer,
  ServerHandlers,
  StreamHandler,
  Transport,
} from './endpoint';
export { createRpcClient, createRpcServer } from './endpoint';
export {
  assertContractShape,
  CONTRACT_VERSION,
  unwrapVersioned,
  validateVersion,
  wrapVersioned,
} from './validate';
