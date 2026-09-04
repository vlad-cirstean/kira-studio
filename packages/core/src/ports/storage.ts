/**
 * Small persisted key/value storage, in two scopes (§3.3: "per repo and global") — VS Code's
 * `Memento` (workspace + global) today; `ports/testFakes.ts`'s `FakeStorage` is the second
 * implementation, for unit tests.
 */
export type StorageScope = "global" | "workspace";

export interface Storage {
  get<T>(scope: StorageScope, key: string): T | undefined;
  set(scope: StorageScope, key: string, value: unknown): Promise<void>;
}
