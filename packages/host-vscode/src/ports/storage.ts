/**
 * `Storage` over VS Code's two `Memento`s (P3 W10) — `workspace` scope is
 * `ExtensionContext.workspaceState`, `global` scope is `ExtensionContext.globalState`, exactly
 * as §3.3 names them.
 */
import type { Storage, StorageScope } from "@kira-version/core";
import type * as vscode from "vscode";

export class VsCodeStorage implements Storage {
  readonly #mementos: Record<StorageScope, vscode.Memento>;

  constructor(context: vscode.ExtensionContext) {
    this.#mementos = { global: context.globalState, workspace: context.workspaceState };
  }

  get<T>(scope: StorageScope, key: string): T | undefined {
    return this.#mementos[scope].get<T>(key);
  }

  set(scope: StorageScope, key: string, value: unknown): Promise<void> {
    return Promise.resolve(this.#mementos[scope].update(key, value));
  }
}
