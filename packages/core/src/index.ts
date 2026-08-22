export type { MergePrediction, UnmergedEntry, UnmergedStage } from "./model/conflict.ts";
export type {
  CommitDetail,
  CommitIdentity,
  CommitRecord,
  DecorationRef,
  FileChange,
  FileChangeKind,
  SignatureStatus,
} from "./model/commit.ts";
export type { RefKind, RefRecord, RefTrack } from "./model/ref.ts";
export type { HeadState, RepoIdentity } from "./model/repo.ts";
export type { StashEntry } from "./model/stash.ts";
export type { AppendResult, CommitStoreStats } from "./store/commitStore.ts";
export { CommitStore } from "./store/commitStore.ts";
export { StringInterner, SubjectBuffer } from "./store/intern.ts";
export type { ShaTableOptions } from "./store/shaTable.ts";
export { ShaTable } from "./store/shaTable.ts";
export type {
  FileStatusCode,
  IgnoredStatusEntry,
  OrdinaryStatusEntry,
  RenamedStatusEntry,
  StatusBranchInfo,
  StatusEntry,
  StatusResult,
  UntrackedStatusEntry,
} from "./model/status.ts";
export type {
  ProcessExit,
  ProcessRunner,
  SpawnedProcess,
  SpawnRequest,
} from "./ports/processRunner.ts";
export { AssertionError, assert, assertDefined, assertNever } from "./util/assert.ts";
export {
  RecordSplitter,
  RemainderOverflowError,
  splitLimitedFields,
  splitRecords,
} from "./util/nulSplit.ts";
export type { RecordSplitterOptions } from "./util/nulSplit.ts";
