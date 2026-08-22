import type { Layout, LayoutPatch } from './layout';
import type { Settings, SettingsPatch } from './settings';

export const IPC = {
  appInfo: 'kira:app:info',
  settingsGetAll: 'kira:settings:getAll',
  settingsSet: 'kira:settings:set',
  layoutGetAll: 'kira:layout:getAll',
  layoutSet: 'kira:layout:set',
  engineStatus: 'kira:engine:status',
  port: 'kira:port',
  engineState: 'kira:engine:state',
  openSettings: 'kira:open-settings',
  toggleProjectPanel: 'kira:menu:toggle-project-panel',
  toggleOperationsPanel: 'kira:menu:toggle-operations-panel',
} as const;

export interface AppInfo {
  appVersion: string;
  electron: string;
  chrome: string;
  node: string;
  kiraHome: string;
}

export interface EngineStatus {
  alive: boolean;
  pid: number | null;
}

export interface KiraApi {
  appInfo(): Promise<AppInfo>;
  settingsGetAll(): Promise<Settings>;
  settingsSet(patch: SettingsPatch): Promise<Settings>;
  layoutGetAll(): Promise<Layout>;
  layoutSet(patch: LayoutPatch): Promise<Layout>;
  engineStatus(): Promise<EngineStatus>;
  onEngineState(cb: (status: EngineStatus) => void): () => void;
  onOpenSettings(cb: () => void): () => void;
  onToggleProjectPanel(cb: () => void): () => void;
  onToggleOperationsPanel(cb: () => void): () => void;
}
