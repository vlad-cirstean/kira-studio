import type { BeautifyMode, BeautifyResult } from '../../beautify';

export type PrettyFormat = 'json' | 'xml';

export interface PrettyResult {
  format: PrettyFormat | null;
  text?: string;
}

export interface ParseJobs {
  'body.format': { input: { body: string; wantText: boolean }; output: PrettyResult };
  'json.beautify': { input: { text: string; mode: BeautifyMode }; output: BeautifyResult };
  'xml.beautify': { input: { text: string; mode: BeautifyMode }; output: BeautifyResult };
}

export type JobKind = keyof ParseJobs;
export type JobInput<K extends JobKind> = ParseJobs[K]['input'];
export type JobOutput<K extends JobKind> = ParseJobs[K]['output'];

export interface WorkerRequest {
  id: number;
  kind: JobKind;
  input: unknown;
}

export type WorkerResponse =
  | { id: number; ok: true; output: unknown }
  | { id: number; ok: false; error: string };
