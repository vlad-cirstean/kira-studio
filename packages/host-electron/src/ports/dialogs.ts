/**
 * `Dialogs` over `dialog.showOpenDialog` (P3 W11) — the same one method VS Code's own
 * `ports/dialogs.ts` implements. The real Electron `dialog` (plus which window it should
 * attach to as a sheet on macOS) is injected as a minimal `DialogApi` rather than imported at
 * module scope here, so a fake can drive `pickFolder` in a unit test without ever loading the
 * real `electron` module — `main/index.ts` is the one place that adapts the real `dialog` +
 * `BrowserWindow.getFocusedWindow()` into this shape.
 */
import type { Dialogs, PickFolderOptions } from "@kira-version/core";

export interface DialogApi {
  showOpenDialog(opts: {
    readonly title: string;
    readonly buttonLabel: string;
    readonly properties: readonly string[];
  }): Promise<{ readonly canceled: boolean; readonly filePaths: readonly string[] }>;
}

export class ElectronDialogs implements Dialogs {
  readonly #dialog: DialogApi;

  constructor(dialogApi: DialogApi) {
    this.#dialog = dialogApi;
  }

  async pickFolder(opts: PickFolderOptions): Promise<string | null> {
    const result = await this.#dialog.showOpenDialog({
      title: opts.title,
      buttonLabel: "Open Repository",
      properties: ["openDirectory"],
    });
    return result.canceled ? null : (result.filePaths[0] ?? null);
  }
}
