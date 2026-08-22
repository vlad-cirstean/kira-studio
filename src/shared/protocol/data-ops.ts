import { z } from 'zod';
import { type MutationRowOp, mutationRowOpSchema } from '../domain/mutations';
import { type SortSpec, sortSpecSchema } from '../domain/queries';
import type { Page } from './page';

// The bulk data channel group (D1): result pages travel renderer<->engine over the
// MessagePort, never through main. Everything else P2 adds (tabs, saved filters, history,
// settings) stays on ipcRenderer.invoke through main — see shared/protocol/ipc.ts.
export const DATA_OP = {
  read: 'data:read',
  count: 'data:count',
  prefetch: 'data:prefetch',
  /** Drops L2 pages + the L3 count for one target. The ↻ button; P5's mutation hook (D13). */
  invalidate: 'data:invalidate',
  /** Never executes (P5 D6) — adapter.preview() renders literal SQL text for display only. */
  preview: 'data:preview',
  /** P5: adapter.mutate(), then a same-process cache.dropTarget() on success. */
  mutate: 'data:mutate',
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
}

export const countRequestWireSchema = z.object({
  opId: z.string(),
  tabId: z.string().nullable(),
  connectionId: z.string(),
  path: z.string(),
  filter: z.string().max(4096).nullable(),
});

export interface InvalidateRequestWire {
  connectionId: string;
  path: string;
}

export const invalidateRequestWireSchema = z.object({
  connectionId: z.string(),
  path: z.string(),
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

export interface PrefetchResponse {
  warmed: boolean;
  bytes: number;
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

export const cacheStatsSchema = z.object({
  l2Bytes: z.number(),
  l2BudgetBytes: z.number(),
  l2Entries: z.number(),
  l2Hits: z.number(),
  l2Misses: z.number(),
  l3Entries: z.number(),
});
export type CacheStats = z.infer<typeof cacheStatsSchema>;
