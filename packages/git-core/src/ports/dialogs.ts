/**
 * Native confirm / pick-folder / save-file prompts — `window.show*` in VS Code today
 * (`ports/testFakes.ts`'s `FakeDialogs` is the second implementation, for unit tests). P3 needs
 * only the folder picker (repo.pick's fallback when `WorkspaceRoots` comes up empty); later
 * phases add confirm/save as their own consumers need them.
 */
export interface PickFolderOptions {
  readonly title: string;
}

export interface Dialogs {
  pickFolder(opts: PickFolderOptions): Promise<string | null>;
}
