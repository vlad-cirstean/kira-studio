// Shape of `window.__kiraGridProto`, shared by the debug hook and the Playwright helper
// (apps/kira-studio/tests/proto/support/grid.ts). Pure types: no DOM, Vue or cheetah imports.

interface HookSelection {
  kind: 'cell' | 'range' | 'row' | 'column' | 'all' | null;
  /** Page rows, ascending. */
  rows: number[];
  /** Column names in display order. */
  columns: string[];
  /** Active cell: page row and column name. */
  active: { row: number; column: string } | null;
}

export interface KiraGridProtoHook {
  /** Record index of a page row, or null when sort or hide filtered it out. */
  recordIndex(pageRow: number): number | null;
  pageRow(recordIndex: number): number;
  selection(): HookSelection;
}

declare global {
  interface Window {
    __kiraGridProto?: KiraGridProtoHook;
  }
}
