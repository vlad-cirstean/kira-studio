import {
  OBJECT_CONTENT_TYPE_SENTINEL,
  OBJECT_FILE_SENTINEL,
  OBJECT_KEY_SENTINEL,
} from '@shared/domain/object-store';
import { decodePath, encodePath, pathTail } from '@shared/domain/tree';
import { reactive } from 'vue';
import { control } from '../bridge/control';
import { data } from '../bridge/data';
import { connectionRecord, connectionsState } from './connections';
import type { MenuItem } from './contextMenu';

// P33 D17: lives in state/ (not views/keyvalue/) because project/menus.ts must be able to open
// the upload dialog without importing a views/ module sideways (§11's dependency rule, F17) — the
// tree's own bucket/prefix rows are a second entry point alongside the object tab's own toolbar.

export interface UploadDialogState {
  open: boolean;
  connectionId: string | null;
  /** The bucket or prefix path a successful upload lands the new object under. */
  containerPath: string;
}

export const uploadDialogState = reactive<UploadDialogState>({
  open: false,
  connectionId: null,
  containerPath: '',
});

export function openUploadDialog(connectionId: string, containerPath: string): void {
  uploadDialogState.connectionId = connectionId;
  uploadDialogState.containerPath = containerPath;
  uploadDialogState.open = true;
}

// P33 D3/P41 D10: offered only when the connection's caps say so (fileTransfer + canInsert) and
// it isn't read-only, never a permanently disabled row — shared by the project tree's bucket/
// prefix rows (project/menus.ts) and the Browse panel's own container rows (views/browse/menu.ts),
// which sit on opposite sides of the project/ -> views/ layering rule, so the item itself lives
// here rather than in either caller.
export function uploadMenuItem(connectionId: string, containerPath: string): MenuItem[] {
  const caps = connectionsState.states[connectionId]?.caps;
  const record = connectionRecord(connectionId);
  if (!caps?.fileTransfer || !caps.canInsert || record?.readOnly) return [];
  return [
    {
      type: 'item',
      id: 'upload-file',
      label: 'Upload file…',
      icon: 'cloud-upload',
      run: () => openUploadDialog(connectionId, containerPath),
    },
  ];
}

export function closeUploadDialog(): void {
  uploadDialogState.open = false;
}

/** Save dialog → data.objectDownload. Returns the chosen path, or null when cancelled. */
export async function downloadObject(
  connectionId: string,
  path: string,
  tabId: string | null,
): Promise<string | null> {
  const tail = pathTail(path);
  if (tail?.kind !== 'object') return null;
  const chosen = await control.filesChooseSave(tail.name);
  if (chosen.canceled || !chosen.filePath) return null;
  await data.objectDownload({
    opId: crypto.randomUUID(),
    tabId,
    connectionId,
    path,
    destPath: chosen.filePath,
  });
  return chosen.filePath;
}

/** Confirm → data.mutate delete. Callers reload/refresh; this module never touches a view's runtime. */
export async function deleteObject(
  connectionId: string,
  path: string,
  tabId: string | null,
): Promise<boolean> {
  const tail = pathTail(path);
  if (tail?.kind !== 'object') return false;
  await data.mutate({
    opId: crypto.randomUUID(),
    tabId,
    connectionId,
    path,
    ops: [{ kind: 'delete', key: { [OBJECT_KEY_SENTINEL]: tail.name } }],
  });
  return true;
}

/** data.mutate insert with the `$file` sentinel; resolves to the new object's encoded path. */
export async function uploadObject(args: {
  connectionId: string;
  containerPath: string;
  key: string;
  sourcePath: string;
  contentType: string;
  tabId: string | null;
}): Promise<string> {
  await data.mutate({
    opId: crypto.randomUUID(),
    tabId: args.tabId,
    connectionId: args.connectionId,
    path: args.containerPath,
    ops: [
      {
        kind: 'insert',
        values: {
          [OBJECT_KEY_SENTINEL]: args.key,
          [OBJECT_FILE_SENTINEL]: args.sourcePath,
          [OBJECT_CONTENT_TYPE_SENTINEL]: args.contentType,
        },
      },
    ],
  });
  const containerSegments = decodePath(args.connectionId, args.containerPath).segments;
  return encodePath([...containerSegments, { kind: 'object', name: args.key }]);
}
