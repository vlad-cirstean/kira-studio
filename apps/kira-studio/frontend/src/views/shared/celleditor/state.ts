import { reactive } from 'vue';
import type { SelectedCell } from '../../../state/cellSelection';
import { connectionRecord } from '../../../state/connections';
import type { CellFormat } from './formats';

/** P5 adds 'no-primary-key' — a table with no primary key can't identify a row to write. P24 D27
 *  adds 'value-truncated' — the buffer holds only the first 64 KB (§0 note 9), so committing it
 *  verbatim would silently overwrite the full value with a truncated one; refused outright rather
 *  than half-supported, the same "no half-implementations" rule the rest of this phase follows. */
export type ReadOnlyReason =
  | 'connection-read-only'
  | 'value-truncated'
  | 'no-primary-key'
  | 'not-editable-yet';

// Session-only, never persisted (D12): not tabs.state_json, not settings, not SQLite. A `\0`
// separator because a connection id is a UUID but a path segment can legitimately contain `:`
// and `/`.
const overrides = reactive<Record<string, CellFormat>>({});

function overrideKey(cell: SelectedCell): string {
  return `${cell.connectionId ?? ''}\0${cell.path}\0${cell.column.name}`;
}

export function overrideFor(cell: SelectedCell): CellFormat | null {
  return overrides[overrideKey(cell)] ?? null;
}

export function setOverride(cell: SelectedCell, format: CellFormat | null): void {
  const key = overrideKey(cell);
  if (format === null) delete overrides[key];
  else overrides[key] = format;
}

/** connection-read-only wins, so §8.6's forced case is always the visible one. `null` means the
 *  cell is genuinely editable in the grid (P5 D2) — the panel itself stays read-only regardless
 *  (D4), but no chip is shown for it. */
export function readOnlyReasonFor(cell: SelectedCell): ReadOnlyReason | null {
  const record = connectionRecord(cell.connectionId);
  if (record?.readOnly) return 'connection-read-only';
  if (cell.truncated) return 'value-truncated';
  if (!cell.hasPrimaryKey) return 'no-primary-key';
  return null;
}
