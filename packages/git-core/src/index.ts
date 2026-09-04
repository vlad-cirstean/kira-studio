export { advanceColorState, allocateColor, initialColorState } from './graph/colors';
export type { BuiltEdges } from './graph/edges';
export { EdgeBuffer } from './graph/edges';
export type { LaneAssignment } from './graph/lanes';
export { assignLanes } from './graph/lanes';
export type { LayoutAppendResult } from './graph/layout';
export { layoutAppend, layoutTransferList } from './graph/layout';
export type {
  ColorState,
  EdgeKind,
  LayoutChunk,
  LayoutFrontier,
  LayoutInput,
  LayoutRequest,
  LayoutResponse,
  PendingEdge,
} from './graph/types';
export {
  DEFAULT_PALETTE_SIZE,
  EDGE_COLOR,
  EDGE_FROM_LANE,
  EDGE_FROM_ROW,
  EDGE_KIND,
  EDGE_KIND_BRANCH_OUT,
  EDGE_KIND_MERGE_IN,
  EDGE_KIND_STRAIGHT,
  EDGE_STRIDE,
  EDGE_TO_LANE,
  EDGE_TO_ROW,
  LANE_EMPTY,
  LANE_PENDING,
  UNRESOLVED_ROW,
} from './graph/types';
export type {
  CommitDetail,
  CommitIdentity,
  CommitRecord,
  DecorationRef,
  FileChange,
  FileChangeKind,
  SignatureStatus,
} from './model/commit';
export type { MergePrediction, UnmergedEntry, UnmergedStage } from './model/conflict';
export type { RefKind, RefRecord, RefTrack } from './model/ref';
export type { HeadState, RepoIdentity } from './model/repo';
export type { StashEntry } from './model/stash';
export type {
  FileStatusCode,
  IgnoredStatusEntry,
  OrdinaryStatusEntry,
  RenamedStatusEntry,
  StatusBranchInfo,
  StatusEntry,
  StatusResult,
  UntrackedStatusEntry,
} from './model/status';
export type {
  CoerceProblem,
  CoerceResult,
  HostKind,
  SettingDef,
  SettingKey,
  Settings,
  SettingType,
  SettingValue,
} from './settings/schema';
export { coerceSettings, defaultSettings, SETTINGS } from './settings/schema';
export type { AppendResult, CommitStoreStats, PackedCommitChunk } from './store/commitStore';
export { CommitStore, packedTransferList } from './store/commitStore';
export { StringInterner, SubjectBuffer } from './store/intern';
export type { ShaTableOptions } from './store/shaTable';
export { bytesToHex, hexToBytes, ShaTable } from './store/shaTable';
export { AssertionError, assert, assertDefined, assertNever } from './util/assert';
export type { RecordSplitterOptions } from './util/nulSplit';
export {
  RecordSplitter,
  RemainderOverflowError,
  splitLimitedFields,
  splitRecords,
} from './util/nulSplit';
