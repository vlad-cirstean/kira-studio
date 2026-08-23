import { describe, expect, test } from "bun:test";
import type { DialogApi } from "./dialogs.ts";
import { ElectronDialogs } from "./dialogs.ts";

class FakeDialogApi implements DialogApi {
  calls: Array<{ title: string; buttonLabel: string; properties: readonly string[] }> = [];
  result: { canceled: boolean; filePaths: readonly string[] } = { canceled: true, filePaths: [] };

  showOpenDialog(opts: {
    readonly title: string;
    readonly buttonLabel: string;
    readonly properties: readonly string[];
  }): Promise<{ readonly canceled: boolean; readonly filePaths: readonly string[] }> {
    this.calls.push(opts);
    return Promise.resolve(this.result);
  }
}

describe("ElectronDialogs", () => {
  test("pickFolder requests a directory-only, single-selection open dialog", async () => {
    const dialogApi = new FakeDialogApi();
    const dialogs = new ElectronDialogs(dialogApi);

    await dialogs.pickFolder({ title: "Open Repository" });

    expect(dialogApi.calls).toEqual([
      { title: "Open Repository", buttonLabel: "Open Repository", properties: ["openDirectory"] },
    ]);
  });

  test("returns the first chosen path when the dialog resolves with one", async () => {
    const dialogApi = new FakeDialogApi();
    dialogApi.result = { canceled: false, filePaths: ["/repo/one", "/repo/two"] };
    const dialogs = new ElectronDialogs(dialogApi);

    expect(await dialogs.pickFolder({ title: "Open Repository" })).toBe("/repo/one");
  });

  test("returns null when the user cancels", async () => {
    const dialogApi = new FakeDialogApi();
    dialogApi.result = { canceled: true, filePaths: [] };
    const dialogs = new ElectronDialogs(dialogApi);

    expect(await dialogs.pickFolder({ title: "Open Repository" })).toBeNull();
  });

  test("returns null when the dialog resolves not-canceled but with no paths", async () => {
    const dialogApi = new FakeDialogApi();
    dialogApi.result = { canceled: false, filePaths: [] };
    const dialogs = new ElectronDialogs(dialogApi);

    expect(await dialogs.pickFolder({ title: "Open Repository" })).toBeNull();
  });
});
