import type { DataGripPreview, DataGripPreviewRow, DataGripReport } from '@shared/domain/datagrip';
import { defineStore } from 'pinia';
import { reactive, toRefs } from 'vue';
import { control } from '../bridge/control';
import { connectionsState } from './connections';

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

export const useDatagripImportStore = defineStore('datagripImport', () => {
  const state = reactive({
    open: false,
    busy: false,
    projectPath: '',
    preview: null as DataGripPreview | null,
    selected: new Set<string>(),
    error: null as string | null,
    report: null as DataGripReport | null,
  });

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
    state.open = false;
    state.projectPath = '';
    state.preview = null;
    state.selected = new Set();
    state.error = null;
    state.report = null;
  }

  /** Opens the native folder picker and scans the chosen project (D13/D9). Returns false when the
   *  picker was cancelled or the scan itself failed — the dialog only opens on a real preview. */
  async function pickAndScanDataGripProject(): Promise<boolean> {
    const chosen = await control.filesChooseFolder('Import from DataGrip');
    if (chosen.canceled || !chosen.path) return false;
    return scanDataGripProject(chosen.path);
  }

  async function scanDataGripProject(path: string): Promise<boolean> {
    state.busy = true;
    state.error = null;
    try {
      const preview = await control.datagripScan(path);
      state.projectPath = path;
      state.preview = preview;
      state.selected = initialSelection(preview);
      state.report = null;
      state.open = true;
      return true;
    } catch (err) {
      state.error = err instanceof Error ? err.message : String(err);
      return false;
    } finally {
      state.busy = false;
    }
  }

  function toggleDataGripRow(uuid: string): void {
    if (state.selected.has(uuid)) state.selected.delete(uuid);
    else state.selected.add(uuid);
  }

  function closeDataGripImportDialog(): void {
    resetDialogState();
  }

  /** D9's second step: the dialog's own confirm action. Nothing is written before this runs — the
   *  preview is a real review step, not decoration (D10). The created connections themselves reach
   *  connectionsState.records through the existing connectionsChanged broadcast
   *  (connections.Service.emitListChanged), so nothing here has to re-fetch the list by hand. */
  async function confirmDataGripImport(): Promise<DataGripReport | null> {
    if (!state.preview || state.selected.size === 0) return null;
    const uuids = [...state.selected];
    state.busy = true;
    state.error = null;
    try {
      const report = await control.datagripImport(state.projectPath, uuids);
      state.report = report;
      return report;
    } catch (err) {
      state.error = err instanceof Error ? err.message : String(err);
      return null;
    } finally {
      state.busy = false;
    }
  }

  return {
    ...toRefs(state),
    pickAndScanDataGripProject,
    toggleDataGripRow,
    closeDataGripImportDialog,
    confirmDataGripImport,
  };
});
