import { decodePath, encodePath, pathParent } from '@shared/domain/tree';
import { data } from '../../bridge/data';
import { findKeyValueTab, openKeyValueTab } from '../../state/tabs';
import { browseInvalidate } from '../../state/viewCommands';
import { createImmediateMutator } from '../shared/immediateMutation';
import { reload } from './state';

// Keyvalue mutates immediately (mirrors views/documents/mutations.ts's discipline exactly) — no
// pendingChanges.ts-style staged plan, no preview step.
//
// The same two reserved sentinels as engine/adapters/redis/mutate.ts (`_key`/`$value`) — see
// that file's own comment for why `plan.path` alone can't name the target key.
const KEY_SENTINEL = '_key';
const VALUE_SENTINEL = '$value';

const mutate = createImmediateMutator({ findTab: findKeyValueTab, reload });

export async function saveValueEdit(
  tabId: string,
  keyName: string,
  newValue: string,
): Promise<void> {
  await mutate(tabId, [
    { kind: 'update', key: { [KEY_SENTINEL]: keyName }, changes: { [VALUE_SENTINEL]: newValue } },
  ]);
}

export async function deleteKey(tabId: string, keyName: string): Promise<void> {
  // The key this tab was showing is now gone — reload still runs (mirrors deleteDocument's own
  // unconditional reload) so a stale row set never lingers; the read that follows surfaces the
  // ordinary "key no longer exists" query-time condition (read.ts's own precedent) rather than
  // this module inventing a second way to report the same fact.
  await mutate(tabId, [{ kind: 'delete', key: { [KEY_SENTINEL]: keyName } }], (tab) => {
    // P43 F11/D15: a deleted key's own container level (the level a Browse tab shows) just lost
    // a member — a no-op when no Browse tab is open (browseInvalidate's own contract).
    browseInvalidate(tab.connectionId, pathParent(tab.path) ?? '');
  });
}

// Scoped to string-type keys only (same D2 as edit — see redis/mutate.ts's assertEditableType).
// Unlike edit/delete, there is no existing key for `plan.path` to already point at, so the new
// key's name travels entirely through the `insert` op's own `_key`/`$value` sentinels; the plan's
// path only needs to resolve to the right database (the current tab's own path already does).
// On success this opens the new key in its own tab rather than reloading the current one — the
// current tab is still showing an unrelated, still-existing key.
export async function addKey(
  tabId: string,
  newKeyName: string,
  initialValue: string,
): Promise<void> {
  const tab = findKeyValueTab(tabId);
  if (!tab?.connectionId) return;
  await data.mutate({
    opId: crypto.randomUUID(),
    tabId,
    connectionId: tab.connectionId,
    path: tab.path,
    ops: [
      {
        kind: 'insert',
        values: { [KEY_SENTINEL]: newKeyName, [VALUE_SENTINEL]: initialValue },
      },
    ],
  });
  // P43 F11/D15: the new key's own container level just gained a member.
  browseInvalidate(tab.connectionId, pathParent(tab.path) ?? '');
  const databaseSegment = decodePath(tab.connectionId, tab.path).segments.find(
    (s) => s.kind === 'database',
  );
  if (!databaseSegment) return;
  const newPath = encodePath([
    { kind: 'database', name: databaseSegment.name },
    { kind: 'key', name: newKeyName },
  ]);
  openKeyValueTab(tab.connectionId, newPath, { newTab: true });
}
