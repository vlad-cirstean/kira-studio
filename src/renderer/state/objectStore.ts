import {
  OBJECT_CONTENT_TYPE_SENTINEL,
  OBJECT_FILE_SENTINEL,
  OBJECT_KEY_SENTINEL,
} from '@shared/domain/object-store';
import { decodePath, encodePath, pathTail } from '@shared/domain/tree';
import { reactive } from 'vue';
import { control } from '../bridge/control';
import { data } from '../bridge/data';

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
