import { data } from '../../bridge/data';
import { findDocumentTab } from '../../state/tabs';
import { reload } from './state';

// Documents mutate immediately (P8's ground rules — §8.7 never mentions staging/preview, unlike
// §8.5's grid section) — no pendingChanges.ts-style staged plan, no preview step. Both call
// data.mutate directly and reload the tab's current page on success so the list reflects the
// server's own state rather than an optimistic local patch.

export async function saveDocumentEdit(
  tabId: string,
  id: string,
  newBodyEjson: string,
): Promise<void> {
  const tab = findDocumentTab(tabId);
  if (!tab?.connectionId) return;
  await data.mutate({
    opId: crypto.randomUUID(),
    tabId,
    connectionId: tab.connectionId,
    path: tab.path,
    // The '$document' sentinel (P8 ground rules): a whole-document replace expressed through the
    // existing relational-shaped MutationRowOp rather than widening the shared mutation schema.
    ops: [{ kind: 'update', key: { _id: id }, changes: { $document: newBodyEjson } }],
  });
  await reload(tabId);
}

export async function saveNewDocument(tabId: string, bodyEjson: string): Promise<void> {
  const tab = findDocumentTab(tabId);
  if (!tab?.connectionId) return;
  await data.mutate({
    opId: crypto.randomUUID(),
    tabId,
    connectionId: tab.connectionId,
    path: tab.path,
    // The same '$document' sentinel saveDocumentEdit uses above, on the insert variant of
    // MutationRowOp (mongo/mutate.ts's insertOne branch) — no `key`, since a new document has no
    // existing `_id` to address by; the server assigns one when the body omits it.
    ops: [{ kind: 'insert', values: { $document: bodyEjson } }],
  });
  await reload(tabId);
}

export async function deleteDocument(tabId: string, id: string): Promise<void> {
  const tab = findDocumentTab(tabId);
  if (!tab?.connectionId) return;
  await data.mutate({
    opId: crypto.randomUUID(),
    tabId,
    connectionId: tab.connectionId,
    path: tab.path,
    ops: [{ kind: 'delete', key: { _id: id } }],
  });
  await reload(tabId);
}
