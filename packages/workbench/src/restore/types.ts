/** A Compose service inside a project row. */
export interface RestoreMember {
  id: string;
  label: string;
  error?: string;
}

/**
 * One thing the shared restore dialog offers to start again. `ready` rows are selectable,
 * `waiting` rows start on their own and stay disabled, `unavailable` rows are listed with their
 * `reason` and never selected.
 */
export interface RestoreRow {
  id: string;
  label: string;
  /** Second line: a command or an image. */
  detail?: string;
  folder?: string;
  badges?: string[];
  state: 'ready' | 'waiting' | 'unavailable';
  /** The source's own status; rendered as `data-status` only. */
  status: string;
  reason?: string;
  error?: string;
  members?: RestoreMember[];
}
