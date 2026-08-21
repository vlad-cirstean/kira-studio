import type { Page } from '@playwright/test';
import type { ConnectionFilterInput, ConnectionInput } from '@shared/connection';
import type { KiraApi, TreeChildrenPayload, TreeChildrenResult } from '@shared/ipc';
import type { OpRecord } from '@shared/ops';

// Typed access to the preload bridge from Node-side specs. The cast lives *inside* each serialized
// evaluate body (a Node-side closure over a helper would not survive serialization, and the
// renderer's CSP forbids eval/new Function). The TS-only `KiraApi` type is erased at runtime.

export const api = {
  connectionsList: (page: Page) =>
    page.evaluate(() => (window as unknown as { kira: KiraApi }).kira.connectionsList()),

  connectionsCreate: (page: Page, input: ConnectionInput) =>
    page.evaluate((i) => (window as unknown as { kira: KiraApi }).kira.connectionsCreate(i), input),

  connectionsDelete: (page: Page, id: string) =>
    page.evaluate(
      (x) => (window as unknown as { kira: KiraApi }).kira.connectionsDelete({ id: x }),
      id,
    ),

  connectionsReveal: (page: Page, id: string) =>
    page.evaluate(
      (x) => (window as unknown as { kira: KiraApi }).kira.connectionsReveal({ id: x }),
      id,
    ),

  connectionsConnect: (page: Page, id: string) =>
    page.evaluate(
      (x) => (window as unknown as { kira: KiraApi }).kira.connectionsConnect({ id: x }),
      id,
    ),

  connectionsDisconnect: (page: Page, id: string) =>
    page.evaluate(
      (x) => (window as unknown as { kira: KiraApi }).kira.connectionsDisconnect({ id: x }),
      id,
    ),

  connectionsStates: (page: Page) =>
    page.evaluate(() => (window as unknown as { kira: KiraApi }).kira.connectionsStates()),

  treeChildren: (page: Page, payload: TreeChildrenPayload): Promise<TreeChildrenResult> =>
    page.evaluate((p) => (window as unknown as { kira: KiraApi }).kira.treeChildren(p), payload),

  filtersReplace: (page: Page, connectionId: string, filters: ConnectionFilterInput[]) =>
    page.evaluate((p) => (window as unknown as { kira: KiraApi }).kira.filtersReplace(p), {
      connectionId,
      filters,
    }),

  opsRecent: (page: Page, limit: number): Promise<OpRecord[]> =>
    page.evaluate(
      (n) => (window as unknown as { kira: KiraApi }).kira.opsRecent({ limit: n }),
      limit,
    ),
};
