// The wire shape of internal/datagrip's Preview/Report (P25), hand-mirrored the same way
// collections.ts's ImportReport mirrors internal/bridge's Go struct — kept here rather than
// imported straight from the generated bindings so the frontend has one stable import regardless
// of exactly which Go type crosses which bridge boundary.

/** D9's four-value classification Scan can make from file reads alone. */
export type DataGripPasswordOutlook =
  | 'will-attempt'
  | 'not-saved'
  | 'from-url'
  | 'store-unsupported';

/** D11's closed set of reasons a row cannot be imported at all, or a warning it still carries. */
export type DataGripReasonCode =
  | 'unsupported-engine'
  | 'unrepresentable-url'
  | 'sqlite-path-not-absolute'
  | 'no-jdbc-url'
  | 'password-not-saved'
  | 'password-not-found'
  | 'credential-store-not-found'
  | 'credential-store-unsupported'
  | 'credential-store-locked'
  | 'secret-storage-unavailable'
  | 'name-truncated'
  | 'ssh-tunnel-dropped';

/** One line of D10's review dialog — DataGripService.Scan's PreviewRow. */
export interface DataGripPreviewRow {
  uuid: string;
  name: string;
  importable: boolean;

  // Populated only when importable.
  kind?: string;
  host?: string | null;
  port?: number | null;
  database?: string | null;
  username?: string | null;
  passwordOutlook?: DataGripPasswordOutlook;

  // Populated only when !importable.
  skipReason?: DataGripReasonCode;
  skipDetail?: string;

  warnings: DataGripReasonCode[];
}

/** DataGripService.Scan's answer. */
export interface DataGripPreview {
  projectDir: string;
  rows: DataGripPreviewRow[];
}

/** One row of D9's Report — DataGripService.Import's own per-row outcome. */
export interface DataGripReportRow {
  uuid: string;
  name: string;
  created: boolean;
  passwordImported: boolean;
  error?: string;
}

/** DataGripService.Import's answer. It never carries a password. */
export interface DataGripReport {
  rows: DataGripReportRow[];
}
