/**
 * Small persisted key/value storage, in two scopes (§3.3: "per repo and global") — VS Code's
 * `Memento` (workspace + global) today.
 */
export type StorageScope = 'global' | 'workspace';

export interface Storage {
  get<T>(scope: StorageScope, key: string): T | undefined;
  set(scope: StorageScope, key: string, value: unknown): Promise<void>;
}
