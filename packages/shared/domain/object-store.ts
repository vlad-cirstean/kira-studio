import { z } from 'zod';
import type { NodePath } from './tree';

/** Adapter-side (mirrors mutations.ts's MutationPlan): built by engine/data.ts from a decoded
 *  NodePath plus the wire's own destPath, never parsed whole at a boundary. */
export interface ObjectDownloadRequest {
  path: NodePath;
  /** Absolute local path, chosen by the user through the main-process save dialog. */
  destPath: string;
}

export interface ObjectTransferResult {
  bytes: number;
}

/** The reserved sentinels for an S3 upload, on top of redis/mutate.ts's own `_key`. Same
 *  discipline, same reason (F10 in the P33 plan): a local file path is not a column value, and
 *  `$` can never start a real S3 metadata field name. */
export const OBJECT_KEY_SENTINEL = '_key';
export const OBJECT_VALUE_SENTINEL = '$value';
export const OBJECT_FILE_SENTINEL = '$file';
export const OBJECT_CONTENT_TYPE_SENTINEL = '$contentType';

const EXTENSION_CONTENT_TYPES: Record<string, string> = {
  txt: 'text/plain',
  md: 'text/markdown',
  csv: 'text/csv',
  html: 'text/html',
  htm: 'text/html',
  css: 'text/css',
  json: 'application/json',
  xml: 'application/xml',
  js: 'text/javascript',
  ts: 'text/plain',
  yaml: 'application/yaml',
  yml: 'application/yaml',
  pdf: 'application/pdf',
  zip: 'application/zip',
  gz: 'application/gzip',
  tar: 'application/x-tar',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  webp: 'image/webp',
  mp4: 'video/mp4',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
};

/** Extension → Content-Type for the upload dialog's prefill. Deliberately small and explicit
 *  rather than a dependency: the value is shown in an editable field, so a miss is visible and
 *  correctable before anything is sent, never silent. */
export function contentTypeForFilename(name: string): string {
  const dot = name.lastIndexOf('.');
  if (dot < 0 || dot === name.length - 1) return 'application/octet-stream';
  const ext = name.slice(dot + 1).toLowerCase();
  return EXTENSION_CONTENT_TYPES[ext] ?? 'application/octet-stream';
}

export const localFilePathSchema = z.string().min(1).max(4096);
