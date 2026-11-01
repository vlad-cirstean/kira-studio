// Wire types of CaptureService (apps/kira-space/internal/bridge/capture.go) and shell.HotkeyState.

export type CaptureKind = 'changeRequest' | 'issue' | 'text' | 'empty';
export type CaptureAction = 'openChangeRequest' | 'openIssue' | 'later';

export interface CaptureItem {
  id: string;
  kind: CaptureKind;
  text: string;
  truncated: boolean;
  /** "PR #7 owner/repo" or "Jira PROJ-12"; '' for text and empty. */
  label: string;
  /** Ordered; the first is preselected. */
  actions: CaptureAction[];
  /** Prefill for the Later task title. */
  title: string;
}

export interface CaptureResult {
  action: CaptureAction;
  key?: string;
  taskId?: string;
}

export type HotkeyStateKind = 'off' | 'active' | 'requested' | 'failed';

export interface HotkeyState {
  state: HotkeyStateKind;
  accelerator: string;
  reason?: string;
}

/** Go-side push channels. */
export const CHANNEL_CAPTURE_ITEM = 'kira:capture:item';
export const CHANNEL_CAPTURE_STATUS = 'kira:capture:status';
