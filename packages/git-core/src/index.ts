export type { DetailFileLookup } from './detail/find.ts';
export { findChangeInDetail } from './detail/find.ts';
export { advanceColorState, allocateColor, initialColorState } from './graph/colors.ts';
export type { BuiltEdges } from './graph/edges.ts';
export { EdgeBuffer } from './graph/edges.ts';
export type { LaneAssignment } from './graph/lanes.ts';
export { assignLanes } from './graph/lanes.ts';
export type { LayoutAppendResult } from './graph/layout.ts';
export { layoutAppend, layoutTransferList } from './graph/layout.ts';
export type {
  RowPlan,
  RowPlanEntry,
  RowPlanEntryKind,
  RowPlanOptions,
  TipRef,
} from './graph/rowPlan.ts';
export {
  buildRowPlan,
  identityRowPlan,
  OTHER_GROUP_KEY,
  projectLayoutInput,
} from './graph/rowPlan.ts';
export type {
  ColorState,
  LayoutChunk,
  LayoutFrontier,
  LayoutInput,
  LayoutRequest,
  LayoutResponse,
  PendingEdge,
} from './graph/types.ts';
export {
  DEFAULT_PALETTE_SIZE,
  EDGE_COLOR,
  EDGE_FROM_LANE,
  EDGE_FROM_ROW,
  EDGE_RUN_LANE,
  EDGE_STRIDE,
  EDGE_TO_LANE,
  EDGE_TO_ROW,
  LANE_EMPTY,
  LANE_PENDING,
  PATCH_EDGE_INDEX,
  PATCH_STRIDE,
  PATCH_TO_LANE,
  PATCH_TO_ROW,
  PATCH_UNCHANGED,
  UNRESOLVED_ROW,
} from './graph/types.ts';
export type {
  CommitDetail,
  CommitIdentity,
  CommitRecord,
  CommitSignature,
  DecorationRef,
  FileChange,
  FileChangeKind,
  SignatureStatus,
} from './model/commit.ts';
export type { MergePrediction, UnmergedEntry, UnmergedStage } from './model/conflict.ts';
export type {
  CommitTrailer,
  DiffHunk,
  DiffLine,
  DiffLineKind,
  DiffRow,
  DiffSide,
  FileDiff,
  FileDiffBody,
} from './model/diff.ts';
export {
  flattenDiffRows,
  mapDiffLineToRevision,
  mapLineAcrossDiff,
} from './model/diff.ts';
export type {
  InProgressKind,
  InProgressOperation,
  InProgressStateFiles,
  OpErrorKind,
  OpRequest,
  OpResult,
  ResetMode,
  UndoSlotSnapshot,
} from './model/operation.ts';
export { canRunOp, classifyInProgress, describeInProgress } from './model/operation.ts';
export type { RefKind, RefRecord, RefTrack, TagAnnotation } from './model/ref.ts';
export type {
  PullStrategy,
  PullStrategySource,
  RefUpdate,
  RemoteOpKind,
  RemoteOpRequest,
  RemoteOpResult,
} from './model/remote.ts';
export type { HeadState, RepoIdentity } from './model/repo.ts';
export type { LineRange } from './model/review.ts';
export type { SelectionShape } from './model/reviewRanges.ts';
export {
  clampRanges,
  coverage,
  hunkChangeBlock,
  normalizeRanges,
  selectionToRange,
} from './model/reviewRanges.ts';
export type { StashEntry } from './model/stash.ts';
export type {
  FileStatusCode,
  IgnoredStatusEntry,
  OrdinaryStatusEntry,
  RenamedStatusEntry,
  StatusBranchInfo,
  StatusEntry,
  StatusResult,
  StatusSummary,
  UntrackedStatusEntry,
} from './model/status.ts';
export { dirtyPathsFrom, summarizeStatus } from './model/status.ts';
export { isAnnotated, tagTargetCommit } from './model/tag.ts';
export { classifyReset } from './preflight/reset.ts';
export { classifyTagCreate, validateRefName } from './preflight/tag.ts';
export type {
  CheckoutBlocker,
  CheckoutPreflight,
  CherryPickBlocker,
  CherryPickPreflight,
  DirtyPath,
  MergeOutcomePrediction,
  PullBlocker,
  PullPreflight,
  PullRoute,
  PushPreflight,
  ResetPreflight,
  RevertParentChoice,
  RevertPrediction,
  RevertPreflight,
  StashBranchPreflight,
  StashPopBlocker,
  StashPopPreflight,
  TagCreatePreflight,
} from './preflight/types.ts';
export type {
  CommitFields,
  LoadedScanOptions,
  LoadedScanResult,
  MatchableRef,
  SearchField,
} from './search/matcher.ts';
export { matchCommitFields, matchRef, searchLoadedCommits } from './search/matcher.ts';
export type { CompiledQuery, SearchQuery, SearchScope } from './search/query.ts';
export { compileQuery, escapeRegExp, MIN_SHA_PREFIX } from './search/query.ts';
export type {
  CoerceProblem,
  CoerceResult,
  SettingDef,
  SettingKey,
  Settings,
  SettingType,
  SettingValue,
} from './settings/schema.ts';
export {
  coerceSettings,
  defaultSettings,
  repoSettingKeys,
  SETTINGS,
} from './settings/schema.ts';
export type { AppendResult, CommitStoreStats, PackedCommitChunk } from './store/commitStore.ts';
export { CommitStore } from './store/commitStore.ts';
export { StringInterner, SubjectBuffer } from './store/intern.ts';
export type { ShaTableOptions } from './store/shaTable.ts';
export { bytesToHex, hexToBytes, ShaTable } from './store/shaTable.ts';
export { AssertionError, assert, assertDefined } from './util/assert.ts';
export { formatAbsoluteDate, formatRelativeDate } from './util/dateFormat.ts';
export { nfcPath } from './util/nfcPath.ts';
export type { WorktreeLabelInput } from './worktree/label.ts';
export { worktreeLabel } from './worktree/label.ts';
