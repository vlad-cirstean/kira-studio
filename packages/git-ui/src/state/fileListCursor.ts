import { type ShallowRef, shallowRef } from 'vue';

export type FileListMode = 'tree' | 'flat';

/**
 * P113 F8: `DetailState`/`WorkingDetailState`/`StashState` each carry this same file-list cursor
 * triple (`selectedFile`/`listMode`/`filter`) and its three setters verbatim — `selectedFile`'s
 * `-1` sentinel ("no file selected") is what `reset()` restores whenever a new commit/stash/
 * working-tree selection replaces the list underneath it.
 */
export class FileListCursor {
  /** An index into the owning class's own file list, or `-1` when no file is selected. */
  readonly selectedFile: ShallowRef<number> = shallowRef(-1);
  readonly listMode: ShallowRef<FileListMode> = shallowRef('tree');
  readonly filter: ShallowRef<string> = shallowRef('');

  selectFile(index: number): void {
    this.selectedFile.value = index;
  }

  setListMode(mode: FileListMode): void {
    this.listMode.value = mode;
  }

  setFilter(text: string): void {
    this.filter.value = text;
  }

  /** Restores the "nothing selected" sentinel — every caller's own selection-change/clear path
   *  resets this alongside its own state. */
  reset(): void {
    this.selectedFile.value = -1;
  }
}
