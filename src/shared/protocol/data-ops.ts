import { z } from 'zod';
import { type MutationRowOp, mutationRowOpSchema } from '../domain/mutations';
import { localFilePathSchema } from '../domain/object-store';
import { type SortSpec, sortSpecSchema } from '../domain/queries';
import type { Page } from './page';

// The bulk data channel group (D1): result pages travel renderer<->engine over the dedicated
// `engine` stream (bridge/port.ts), never through a bound call. Everything else P2 adds (tabs,
// saved filters, history, settings) is a bound call instead — see bridge/control.ts.
export const DATA_OP = {
  read: 'data:read',
  count: 'data:count',
  /** Drops L2 pages + the L3 count for one target. The ↻ button; P5's mutation hook (D13). */
  invalidate: 'data:invalidate',
  /** Never executes (P5 D6) — adapter.preview() renders literal SQL text for display only. */
  preview: 'data:preview',
  /** P5: adapter.mutate(), then a same-process cache.dropTarget() on success. */
  mutate: 'data:mutate',
  /** P5.5 §8.14: adapter.execute() — one op-log row for the whole statement batch. */
  execute: 'data:execute',
  /** P33: streams one S3 object's bytes into a local file. Never returns bytes over the port —
   *  the engine writes the file itself (§4: bulk data never transits main *or* the renderer). */
  objectDownload: 'data:objectDownload',
  cacheStats: 'cache:stats',
  cacheClear: 'cache:clear',
} as const;

export const PORT_EVENT = { cacheStats: 'cache:stats' } as const;

export type { SortSpec };
export { sortSpecSchema };

export type PageCursor =
  | { mode: 'offset'; offset: number }
  | { mode: 'after'; token: string }
  | { mode: 'before'; token: string };

export const pageCursorSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('offset'), offset: z.number().int().min(0) }),
  z.object({ mode: z.literal('after'), token: z.string() }),
  z.object({ mode: z.literal('before'), token: z.string() }),
]);

const pageSizeSchema = z.union([z.literal(10), z.literal(100), z.literal(1000), z.literal(10000)]);

/** The wire form: `path` is the encoded string (P1 D6). engine/data.ts decodes it. */
export interface ReadRequestWire {
  opId: string; // renderer-generated (D2)
  tabId: string | null;
  connectionId: string;
  path: string;
  projection: string[] | null; // null = every column
  filter: string | null; // free-text WHERE fragment (D9)
  sort: SortSpec | null;
  pageSize: 10 | 100 | 1000 | 10000; // D24
  cursor: PageCursor;
}

export const readRequestWireSchema = z.object({
  opId: z.string(),
  tabId: z.string().nullable(),
  connectionId: z.string(),
  path: z.string(),
  projection: z.array(z.string()).nullable(),
  filter: z.string().max(4096).nullable(),
  sort: sortSpecSchema.nullable(),
  pageSize: pageSizeSchema,
  cursor: pageCursorSchema,
});

export interface CountRequestWire {
  opId: string;
  tabId: string | null;
  connectionId: string;
  path: string;
  filter: string | null;
  /** P13 D18: the renderer's explicit refresh affordance on a stale count — bypass the L3 hit. */
  refresh?: boolean;
}

export const countRequestWireSchema = z.object({
  opId: z.string(),
  tabId: z.string().nullable(),
  connectionId: z.string(),
  path: z.string(),
  filter: z.string().max(4096).nullable(),
  refresh: z.boolean().optional(),
});

export interface InvalidateRequestWire {
  connectionId: string;
  path: string;
  /** P13 D18: 'all' (default) is the explicit ↻ Refresh — pages + counts, hard. 'pages' is the
   *  post-mutation reload — pages only; counts are marked stale by cache.invalidateAfterMutation
   *  instead, via DATA_OP.mutate, not this channel. */
  scope?: 'all' | 'pages';
}

export const invalidateRequestWireSchema = z.object({
  connectionId: z.string(),
  path: z.string(),
  scope: z.enum(['all', 'pages']).optional(),
});

export interface ReadResponse {
  page: Page;
  source: 'cache' | 'server';
}

export interface CountResponse {
  value: number;
  exact: boolean;
  at: number;
  stale: boolean;
  source: 'cache' | 'server';
}

export interface PreviewRequestWire {
  connectionId: string;
  path: string;
  ops: MutationRowOp[];
}

export const previewRequestWireSchema = z.object({
  connectionId: z.string(),
  path: z.string(),
  ops: z.array(mutationRowOpSchema),
});

export interface PreviewResponse {
  statements: string[];
}

export interface MutateRequestWire {
  opId: string;
  tabId: string | null;
  connectionId: string;
  path: string;
  ops: MutationRowOp[];
}

export const mutateRequestWireSchema = z.object({
  opId: z.string(),
  tabId: z.string().nullable(),
  connectionId: z.string(),
  path: z.string(),
  ops: z.array(mutationRowOpSchema),
});

export interface MutateResponse {
  affectedRows: number;
}

export interface ExecuteRequestWire {
  opId: string;
  tabId: string | null;
  connectionId: string;
  path: string;
  statements: string[];
}

export const executeRequestWireSchema = z.object({
  opId: z.string(),
  tabId: z.string().nullable(),
  connectionId: z.string(),
  path: z.string(),
  statements: z.array(z.string()).min(1),
});

export interface ExecuteResponse {
  pages: Page[];
}

export interface ObjectDownloadRequestWire {
  opId: string;
  tabId: string | null;
  connectionId: string;
  path: string;
  destPath: string;
}

export const objectDownloadRequestWireSchema = z.object({
  opId: z.string(),
  tabId: z.string().nullable(),
  connectionId: z.string(),
  path: z.string(),
  destPath: localFilePathSchema,
});

export interface ObjectDownloadResponse {
  bytes: number;
}

export const cacheStatsSchema = z.object({
  l2Bytes: z.number(),
  l2BudgetBytes: z.number(),
  l2Entries: z.number(),
  l2Hits: z.number(),
  l2Misses: z.number(),
  l3Entries: z.number(),
});
export type CacheStats = z.infer<typeof cacheStatsSchema>;
