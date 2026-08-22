export { advanceColorState, allocateColor, initialColorState } from "./graph/colors.ts";
export { EdgeBuffer } from "./graph/edges.ts";
export type { BuiltEdges } from "./graph/edges.ts";
export type { LaneAssignment } from "./graph/lanes.ts";
export { assignLanes } from "./graph/lanes.ts";
export type { LayoutAppendResult } from "./graph/layout.ts";
export { layoutAppend, layoutTransferList } from "./graph/layout.ts";
export type {
  ColorState,
  EdgeKind,
  LayoutChunk,
  LayoutFrontier,
  LayoutInput,
  LayoutRequest,
  LayoutResponse,
  PendingEdge,
} from "./graph/types.ts";
export {
  DEFAULT_PALETTE_SIZE,
  EDGE_COLOR,
  EDGE_FROM_LANE,
  EDGE_FROM_ROW,
  EDGE_KIND_BRANCH_OUT,
  EDGE_KIND_MERGE_IN,
  EDGE_KIND_STRAIGHT,
  EDGE_STRIDE,
  EDGE_TO_LANE,
  EDGE_TO_ROW,
  LANE_EMPTY,
  LANE_PENDING,
  UNRESOLVED_ROW,
} from "./graph/types.ts";
export type {
  CommitDetail,
  CommitIdentity,
  CommitRecord,
  DecorationRef,
  FileChange,
  FileChangeKind,
  SignatureStatus,
} from "./model/commit.ts";
export type { MergePrediction, UnmergedEntry, UnmergedStage } from "./model/conflict.ts";
export type { RefKind, RefRecord, RefTrack } from "./model/ref.ts";
export type { HeadState, RepoIdentity } from "./model/repo.ts";
export type { StashEntry } from "./model/stash.ts";
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
export type { AppendResult, CommitStoreStats } from "./store/commitStore.ts";
export { CommitStore } from "./store/commitStore.ts";
export { StringInterner, SubjectBuffer } from "./store/intern.ts";
export type { ShaTableOptions } from "./store/shaTable.ts";
export { ShaTable } from "./store/shaTable.ts";
export { AssertionError, assert, assertDefined, assertNever } from "./util/assert.ts";
export type { RecordSplitterOptions } from "./util/nulSplit.ts";
export {
  RecordSplitter,
  RemainderOverflowError,
  splitLimitedFields,
  splitRecords,
} from "./util/nulSplit.ts";
