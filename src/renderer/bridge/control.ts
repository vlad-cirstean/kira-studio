import type { AppInfo, EngineStatus } from '@shared/ipc';
import type { Layout, LayoutPatch } from '@shared/layout';
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
};
