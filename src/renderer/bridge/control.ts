import type {
  ConnectionFilter,
  ConnectionInput,
  ConnectionState,
  ConnectionSummary,
} from '@shared/connection';
import type { TestResult } from '@shared/engine-ops';
import type {
  AppInfo,
  EngineStatus,
  FiltersReplacePayload,
  IdPayload,
  OpsCancelPayload,
  OpsRecentPayload,
  ReorderPayload,
  TreeChildrenPayload,
  TreeChildrenResult,
  TreeDescribePayload,
  TreeDescribeResult,
  TreeInvalidatePayload,
  UpdateConnectionPayload,
} from '@shared/ipc';
import type { Layout, LayoutPatch } from '@shared/layout';
import type { OpRecord } from '@shared/ops';
import type { Settings, SettingsPatch } from '@shared/settings';

const kira = window.kira;

export const control = {
  appInfo: (): Promise<AppInfo> => kira.appInfo(),
  settingsGetAll: (): Promise<Settings> => kira.settingsGetAll(),
  settingsSet: (patch: SettingsPatch): Promise<Settings> => kira.settingsSet(patch),
  layoutGetAll: (): Promise<Layout> => kira.layoutGetAll(),
  layoutSet: (patch: LayoutPatch): Promise<Layout> => kira.layoutSet(patch),
  engineStatus: (): Promise<EngineStatus> => kira.engineStatus(),
  onEngineState: (cb: (status: EngineStatus) => void): (() => void) => kira.onEngineState(cb),
  onOpenSettings: (cb: () => void): (() => void) => kira.onOpenSettings(cb),
  onToggleProjectPanel: (cb: () => void): (() => void) => kira.onToggleProjectPanel(cb),
  onToggleOperationsPanel: (cb: () => void): (() => void) => kira.onToggleOperationsPanel(cb),

  connectionsList: (): Promise<ConnectionSummary[]> => kira.connectionsList(),
  connectionsCreate: (input: ConnectionInput): Promise<ConnectionSummary> =>
    kira.connectionsCreate(input),
  connectionsUpdate: (payload: UpdateConnectionPayload): Promise<ConnectionSummary> =>
    kira.connectionsUpdate(payload),
  connectionsDuplicate: (payload: IdPayload): Promise<ConnectionSummary> =>
    kira.connectionsDuplicate(payload),
  connectionsDelete: (payload: IdPayload): Promise<void> => kira.connectionsDelete(payload),
  connectionsReorder: (payload: ReorderPayload): Promise<ConnectionSummary[]> =>
    kira.connectionsReorder(payload),
  connectionsReveal: (payload: IdPayload): Promise<{ password: string | null }> =>
    kira.connectionsReveal(payload),
  connectionsTest: (input: ConnectionInput): Promise<TestResult> => kira.connectionsTest(input),
  connectionsConnect: (payload: IdPayload): Promise<ConnectionState> =>
    kira.connectionsConnect(payload),
  connectionsDisconnect: (payload: IdPayload): Promise<ConnectionState> =>
    kira.connectionsDisconnect(payload),
  connectionsStates: (): Promise<ConnectionState[]> => kira.connectionsStates(),

  treeChildren: (payload: TreeChildrenPayload): Promise<TreeChildrenResult> =>
    kira.treeChildren(payload),
  treeDescribe: (payload: TreeDescribePayload): Promise<TreeDescribeResult> =>
    kira.treeDescribe(payload),
  treeInvalidate: (payload: TreeInvalidatePayload): Promise<void> => kira.treeInvalidate(payload),

  filtersList: (payload: IdPayload): Promise<ConnectionFilter[]> => kira.filtersList(payload),
  filtersReplace: (payload: FiltersReplacePayload): Promise<ConnectionFilter[]> =>
    kira.filtersReplace(payload),

  opsRecent: (payload: OpsRecentPayload): Promise<OpRecord[]> => kira.opsRecent(payload),
  opsCancel: (payload: OpsCancelPayload): Promise<void> => kira.opsCancel(payload),

  onConnectionState: (cb: (state: ConnectionState) => void): (() => void) =>
    kira.onConnectionState(cb),
  onConnectionMetadataInvalidated: (cb: (payload: TreeInvalidatePayload) => void): (() => void) =>
    kira.onConnectionMetadataInvalidated(cb),
  onOpUpdate: (cb: (record: OpRecord) => void): (() => void) => kira.onOpUpdate(cb),
};
