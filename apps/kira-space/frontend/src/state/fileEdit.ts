import { registerTabRuntimeCleanup } from '@workbench/state/tabRuntime';
import { defineStore } from 'pinia';
import { reactive } from 'vue';

export type EditConflict = 'changed' | 'gone';

export interface FileEditSession {
  /** Hash of the on-disk bytes the buffer was last synced with. */
  baseHash: string;
  /** Monaco alternative version id of the saved text; the buffer is clean when it matches. */
  savedVersionId: number;
  dirty: boolean;
  conflict: EditConflict | null;
}

/** Per-tab worktree edit sessions. A session exists only while the tab is in edit mode and is never
 *  persisted, so a restored window opens read only. */
export const useFileEditStore = defineStore('fileEdit', () => {
  const sessions = reactive<Record<string, FileEditSession>>({});

  function begin(tabId: string, baseHash: string, versionId: number): void {
    sessions[tabId] = { baseHash, savedVersionId: versionId, dirty: false, conflict: null };
  }

  /** Records a successful save, or a reload of the disk text into a clean buffer. */
  function markSaved(tabId: string, hash: string, versionId: number): void {
    const s = sessions[tabId];
    if (!s) return;
    s.baseHash = hash;
    s.savedVersionId = versionId;
    s.dirty = false;
    s.conflict = null;
  }

  function setDirty(tabId: string, dirty: boolean): void {
    const s = sessions[tabId];
    if (s) s.dirty = dirty;
  }

  function setConflict(tabId: string, conflict: EditConflict | null): void {
    const s = sessions[tabId];
    if (s) s.conflict = conflict;
  }

  function end(tabId: string): void {
    delete sessions[tabId];
  }

  function isEditing(tabId: string): boolean {
    return tabId in sessions;
  }

  function isDirty(tabId: string): boolean {
    return sessions[tabId]?.dirty ?? false;
  }

  registerTabRuntimeCleanup(end);

  return { sessions, begin, markSaved, setDirty, setConflict, end, isEditing, isDirty };
});
