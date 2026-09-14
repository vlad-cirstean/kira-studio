import { pathParent, pathTail } from '@shared/domain/tree';
import {
  type ColumnDescriptor,
  type KeyValuePage,
  OBJECT_BODY_EDIT_BYTES,
} from '@shared/protocol/page';
import { formatBytes } from '../../../format';
import { publishSelectedCell, type SelectedCell } from '../../../state/cellSelection';
import { confirmDialog } from '../../../state/confirmDialog';
import { connectionRecord, connectionsState } from '../../../state/connections';
import { deleteObject, downloadObject } from '../../../state/objectStore';
import { browseInvalidate } from '../../../state/viewCommands';
import { keyValueHost } from './host';
import { deleteKey, saveValueEdit } from './mutations';
import { getPage, keyValueRow } from './page';
import { reload, runtime, setActionError } from './state';

// P63 §2.2: the interactive glue that used to live inline in KeyValueView.vue's own <script
// setup> — the badges/toolbar/strips markup stays in KeyValueView.vue (ViewChrome's own #badges/
// #toolbar/#strips slots must keep byte-identical DOM for the existing tab, so the markup can't
// move), but the logic behind it is now viewKey-parameterized and reusable, so KeyValuePane.vue's
// body (row clicks, its own context menu) and KeyValueView.vue's chrome (the toolbar's Edit/
// Delete/Download buttons, the strips' Save button) call the exact same functions instead of
// each re-deriving or duplicating them. Every function here is a plain read of shared module
// state (runtime[viewKey], getPage/keyValueRow, keyValueHost, connectionsState) — none of it is
// tied to a specific mounted component, so it is safe to call from either file, or from both.

export function ttlText(ttlMs: number | null): string {
  if (ttlMs === null) return 'no expiry';
  const seconds = Math.ceil(ttlMs / 1000);
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.ceil(seconds / 60)}m`;
  return `${Math.ceil(seconds / 3600)}h`;
}

export function memoryText(bytes: number | null): string {
  return bytes === null ? 'unknown' : formatBytes(bytes);
}

// "Connection is read-only" only actually explains a disabled control when the connection's own
// readOnly toggle is the reason — an adapter that structurally can't write at all (S3) would show
// the same tooltip on a control that toggle could never turn back on.
export function writeDisabledReason(capFlag: boolean | undefined): string {
  return capFlag === false ? 'Not supported for this connection type' : 'Connection is read-only';
}

function caps(viewKey: string) {
  const connectionId = keyValueHost(viewKey)?.connectionId ?? null;
  return connectionId ? (connectionsState.states[connectionId]?.caps ?? null) : null;
}

function readOnly(viewKey: string): boolean {
  const connectionId = keyValueHost(viewKey)?.connectionId ?? null;
  return !!connectionRecord(connectionId ?? null)?.readOnly;
}

export function canUpdate(viewKey: string): boolean {
  return !!caps(viewKey)?.canUpdate && !readOnly(viewKey);
}
export function canDelete(viewKey: string): boolean {
  return !!caps(viewKey)?.canDelete && !readOnly(viewKey);
}
export function canInsert(viewKey: string): boolean {
  return !!caps(viewKey)?.canInsert && !readOnly(viewKey);
}
export function canDownload(viewKey: string): boolean {
  return !!caps(viewKey)?.fileTransfer;
}

// P33 D4: the Body row is present only when the object is at or under OBJECT_BODY_PREVIEW_BYTES —
// scanning the small, already-loaded field list for it (never a second fetch) is how this tells
// "too large to preview" apart from "this object genuinely has no readable body".
export function objectBodyRowFor(
  viewKey: string,
  page: KeyValuePage | null,
): { value: string; isTruncated: boolean } | null {
  if (page?.redisType !== 'object') return null;
  for (let i = 0; i < page.rowCount; i++) {
    const row = keyValueRow(viewKey, i);
    if (row?.field === 'Body') return { value: row.value, isTruncated: row.isTruncated };
  }
  return null;
}

export function objectBodyRowIndex(viewKey: string, page: KeyValuePage | null): number | null {
  if (page?.redisType !== 'object') return null;
  for (let i = 0; i < page.rowCount; i++) {
    if (keyValueRow(viewKey, i)?.field === 'Body') return i;
  }
  return null;
}

// P33 D6/D7: the whole of the edit-size decision, in one place — every reason names the actual
// number or the actual condition, never a silently-disabled control with no explanation.
export interface ObjectEditGate {
  editable: boolean;
  reason: string;
}
export function objectEditGate(viewKey: string): ObjectEditGate {
  if (!canUpdate(viewKey)) {
    return { editable: false, reason: writeDisabledReason(caps(viewKey)?.canUpdate) };
  }
  const page = getPage(viewKey);
  const bodyRow = objectBodyRowFor(viewKey, page);
  if (bodyRow === null) {
    return { editable: false, reason: 'Too large to edit — download it to open it locally' };
  }
  if (bodyRow.isTruncated) {
    return {
      editable: false,
      reason: 'Only part of this object was fetched — editing it would overwrite the rest',
    };
  }
  if (bodyRow.value.includes('�')) {
    return {
      editable: false,
      reason: "This object isn't valid UTF-8 text — download it to edit it locally",
    };
  }
  const size = page?.memoryBytes ?? null;
  if (size !== null && size > OBJECT_BODY_EDIT_BYTES) {
    return {
      editable: false,
      reason: `Too large to edit (${formatBytes(size)} — the limit is ${formatBytes(OBJECT_BODY_EDIT_BYTES)})`,
    };
  }
  return { editable: true, reason: 'Edit value' };
}

function keyNameFor(viewKey: string): string {
  return pathTail(keyValueHost(viewKey)?.path ?? '')?.name ?? '';
}

// §11's cell-editor seam (state/cellSelection.ts): clicking a row previews its value read-only in
// the cell editor panel, regardless of type — a hash/list/etc. row is still viewable there even
// though only a string key's row is *editable* via the toolbar's popover. `hasPrimaryKey: true`
// because a redis key is always addressable by name (unlike a PK-less SQL table).
export function onRowClick(viewKey: string, i: number): void {
  const row = keyValueRow(viewKey, i);
  const page = getPage(viewKey);
  const host = keyValueHost(viewKey);
  if (!row || !page || !host) return;
  const column: ColumnDescriptor = {
    name: page.redisType === 'string' ? 'value' : row.field,
    // P17: an s3 object's field/value rows aren't a "redis" anything — dataType is the cell
    // editor's own status-badge text, so this stays honest about which engine this page came from.
    dataType: page.redisType === 'object' ? 's3 object field' : `redis ${page.redisType}`,
    typeClass: 'text',
    nullable: false,
    isPrimaryKey: false,
    generated: false,
  };
  // The S3 object's Body row is the one row that can genuinely stage a write — every other row
  // here (redis hash/list/set/zset fields, an object's own metadata rows) has no onEdit at all, so
  // the panel stays read-only for them by cellSelection.ts's own "no onEdit -> read-only" rule.
  const isEditableBodyRow =
    page.redisType === 'object' && row.field === 'Body' && objectEditGate(viewKey).editable;
  const selected: SelectedCell = {
    tabId: viewKey,
    connectionId: host.connectionId,
    path: host.path,
    columnIndex: 1, // the page's own `values` column (`fields` is 0) — KeyValuePage's fixed pair
    column,
    row: i,
    value: row.value,
    truncated: row.isTruncated,
    hasPrimaryKey: true,
    ...(isEditableBodyRow
      ? {
          onEdit: (newValue: string) => {
            const rt = runtime[viewKey];
            if (rt) rt.objectDraft = newValue;
          },
          onRevert: () => {
            const rt = runtime[viewKey];
            if (rt) rt.objectDraft = null;
          },
        }
      : {}),
  };
  publishSelectedCell(selected);
}

// --- edit popover (toolbar) / row-menu "Edit value" (body) — both funnel through here. --------
export function openEdit(viewKey: string): void {
  const rt = runtime[viewKey];
  if (!rt) return;
  const page = getPage(viewKey);
  if (page?.redisType === 'object') {
    if (!objectEditGate(viewKey).editable) return;
    const index = objectBodyRowIndex(viewKey, page);
    if (index !== null) onRowClick(viewKey, index);
    return;
  }
  const editableType = page?.redisType === 'string';
  if (!canUpdate(viewKey) || !editableType) return;
  rt.editDraft = keyValueRow(viewKey, 0)?.value ?? '';
  rt.editError = null;
  rt.editOpen = true;
}

export function closeEdit(viewKey: string): void {
  const rt = runtime[viewKey];
  if (!rt) return;
  rt.editOpen = false;
  rt.editError = null;
}

export async function saveEdit(viewKey: string): Promise<void> {
  const rt = runtime[viewKey];
  const keyName = keyNameFor(viewKey);
  if (!rt || !keyName) return;
  rt.editSaving = true;
  rt.editError = null;
  try {
    await saveValueEdit(viewKey, keyName, rt.editDraft);
    rt.editOpen = false;
  } catch (err) {
    rt.editError = err instanceof Error ? err.message : String(err);
  } finally {
    rt.editSaving = false;
  }
}

// --- delete: type-agnostic (DEL works for any of the six types) — confirmed inline, mirrors
// documents/menu.ts's confirmDialog() precedent. S3's object delete rides state/objectStore.ts's
// deleteObject() instead of mutations.ts's deleteKey(), since it needs the object's whole path
// (not just its key name) to satisfy s3/mutate.ts's bucket-rooted MutationPlan.path. -------------
export async function onDeleteKey(viewKey: string): Promise<void> {
  const host = keyValueHost(viewKey);
  const keyName = keyNameFor(viewKey);
  if (!canDelete(viewKey) || !keyName || !host?.connectionId) return;
  const page = getPage(viewKey);
  const isSingleObjectPage = page?.redisType === 'object';
  const label = isSingleObjectPage ? 'object' : 'key';
  if (!(await confirmDialog(`Delete ${label} "${keyName}"? This removes the entire ${label}.`))) {
    return;
  }
  try {
    if (isSingleObjectPage) {
      await deleteObject(host.connectionId, host.path, viewKey);
      await reload(viewKey);
      // P43 F11/D15: the deleted object's own container level just lost a member.
      browseInvalidate(host.connectionId, pathParent(host.path) ?? '');
    } else {
      await deleteKey(viewKey, keyName);
    }
    setActionError(viewKey, null);
  } catch (err) {
    setActionError(viewKey, err instanceof Error ? err.message : String(err));
  }
}

// --- download: a read, never blocked by read-only (D18) — gated only on caps.fileTransfer. -----
export async function onDownload(viewKey: string): Promise<void> {
  const host = keyValueHost(viewKey);
  if (!canDownload(viewKey) || !host?.connectionId) return;
  await downloadObject(host.connectionId, host.path, viewKey);
}

// --- S3 object body edit: staged locally by the cell editor's onEdit (onRowClick above), never
// written to S3 on blur/Ctrl+Enter — S3's PutObject is a real, immediate write with no undo, so
// an explicit Save (the strips' own button) is the only thing that ever calls this. -------------
export async function saveObjectEdit(viewKey: string): Promise<void> {
  const rt = runtime[viewKey];
  const keyName = keyNameFor(viewKey);
  if (!rt || rt.objectDraft === null || !keyName) return;
  rt.objectSaving = true;
  rt.objectSaveError = null;
  try {
    await saveValueEdit(viewKey, keyName, rt.objectDraft);
    rt.objectDraft = null;
  } catch (err) {
    rt.objectSaveError = err instanceof Error ? err.message : String(err);
  } finally {
    rt.objectSaving = false;
  }
}
