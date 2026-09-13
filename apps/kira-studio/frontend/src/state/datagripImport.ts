import type { DataGripPreview, DataGripPreviewRow, DataGripReport } from '@shared/domain/datagrip';
import { reactive } from 'vue';
import { control } from '../bridge/control';
import { connectionsState } from './connections';

export interface DataGripImportDialogState {
  open: boolean;
  busy: boolean;
  projectPath: string;
  preview: DataGripPreview | null;
  selected: Set<string>; // data source uuids
  error: string | null;
  report: DataGripReport | null;
}

export const datagripImportState = reactive({
  open: false,
  busy: false,
  projectPath: '',
  preview: null as DataGripPreview | null,
  selected: new Set<string>(),
  error: null as string | null,
  report: null as DataGripReport | null,
}) as DataGripImportDialogState;

/** D10: "looks like it's already imported" — a live comparison against connectionsState.records,
 *  matching on name+host+port+database. Nothing is persisted to detect this (§0.3). */
export function looksAlreadyImported(row: DataGripPreviewRow): boolean {
  return connectionsState.records.some(
    (r) =>
      r.name === row.name &&
      (r.host ?? null) === (row.host ?? null) &&
      (r.port ?? null) === (row.port ?? null) &&
      (r.database ?? null) === (row.database ?? null),
  );
}

// D10: everything that maps starts checked, except a probable re-import, which starts unchecked
// so the user has to opt back in to a likely duplicate.
function initialSelection(preview: DataGripPreview): Set<string> {
  const selected = new Set<string>();
  for (const row of preview.rows) {
    if (row.importable && !looksAlreadyImported(row)) selected.add(row.uuid);
  }
  return selected;
}

function resetDialogState(): void {
  datagripImportState.open = false;
  datagripImportState.projectPath = '';
  datagripImportState.preview = null;
  datagripImportState.selected = new Set();
  datagripImportState.error = null;
  datagripImportState.report = null;
}

/** Opens the native folder picker and scans the chosen project (D13/D9). Returns false when the
 *  picker was cancelled or the scan itself failed — the dialog only opens on a real preview. */
export async function pickAndScanDataGripProject(): Promise<boolean> {
  const chosen = await control.filesChooseFolder('Import from DataGrip');
  if (chosen.canceled || !chosen.path) return false;
  return scanDataGripProject(chosen.path);
}

async function scanDataGripProject(path: string): Promise<boolean> {
  datagripImportState.busy = true;
  datagripImportState.error = null;
  try {
    const preview = await control.datagripScan(path);
    datagripImportState.projectPath = path;
    datagripImportState.preview = preview;
    datagripImportState.selected = initialSelection(preview);
    datagripImportState.report = null;
    datagripImportState.open = true;
    return true;
  } catch (err) {
    datagripImportState.error = err instanceof Error ? err.message : String(err);
    return false;
  } finally {
    datagripImportState.busy = false;
  }
}

export function toggleDataGripRow(uuid: string): void {
  if (datagripImportState.selected.has(uuid)) datagripImportState.selected.delete(uuid);
  else datagripImportState.selected.add(uuid);
}

export function closeDataGripImportDialog(): void {
  resetDialogState();
}

/** D9's second step: the dialog's own confirm action. Nothing is written before this runs — the
 *  preview is a real review step, not decoration (D10). The created connections themselves reach
 *  connectionsState.records through the existing connectionsChanged broadcast
 *  (connections.Service.emitListChanged), so nothing here has to re-fetch the list by hand. */
export async function confirmDataGripImport(): Promise<DataGripReport | null> {
  if (!datagripImportState.preview || datagripImportState.selected.size === 0) return null;
  const uuids = [...datagripImportState.selected];
  datagripImportState.busy = true;
  datagripImportState.error = null;
  try {
    const report = await control.datagripImport(datagripImportState.projectPath, uuids);
    datagripImportState.report = report;
    return report;
  } catch (err) {
    datagripImportState.error = err instanceof Error ? err.message : String(err);
    return null;
  } finally {
    datagripImportState.busy = false;
  }
}
