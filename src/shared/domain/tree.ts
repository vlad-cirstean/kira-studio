import { z } from 'zod';

export const nodeKindSchema = z.enum([
  'connection',
  'database',
  'schema',
  'table',
  'view',
  'matview',
  'function',
  'sequence',
  'column',
  'collection', // P8: mongo's table-equivalent
  'index', // P8: a leaf under a collection (or a table, later)
  'namespace', // P9: an intermediate ':'-delimited level in a redis key tree
  'key', // P9: a leaf redis key, opened as a key/value tab
  'topic', // P10: a kafka topic, opened as a stream tab
  'partition', // P10: a browse-only leaf under a kafka topic
  'consumerGroup', // P10: a browse-only, informational leaf under a kafka topic
  'queue', // P10: an sqs queue, opened as a stream tab
]);
export type NodeKind = z.infer<typeof nodeKindSchema>;

export interface PathSegment {
  kind: NodeKind;
  name: string;
}

export interface NodePath {
  connectionId: string;
  segments: PathSegment[];
}

// 'schema:public/table:order%2Fitems' — the connection id is not part of the string (D6).
export function encodePath(segments: PathSegment[]): string {
  return segments.map((s) => `${s.kind}:${encodeURIComponent(s.name)}`).join('/');
}

export function decodePath(connectionId: string, encoded: string): NodePath {
  if (encoded === '') return { connectionId, segments: [] };
  const segments = encoded.split('/').map((raw) => {
    const sep = raw.indexOf(':');
    if (sep < 0) throw new Error(`malformed path segment: ${raw}`);
    const kind = raw.slice(0, sep);
    const name = raw.slice(sep + 1);
    const parsed = nodeKindSchema.safeParse(kind);
    if (!parsed.success) throw new Error(`unknown node kind in path segment: ${kind}`);
    return { kind: parsed.data, name: decodeURIComponent(name) };
  });
  return { connectionId, segments };
}

export function pathParent(encoded: string): string | null {
  const idx = encoded.lastIndexOf('/');
  if (idx < 0) return encoded === '' ? null : '';
  return encoded.slice(0, idx);
}

export function pathTail(encoded: string): PathSegment | null {
  if (encoded === '') return null;
  const idx = encoded.lastIndexOf('/');
  const raw = idx < 0 ? encoded : encoded.slice(idx + 1);
  const sep = raw.indexOf(':');
  if (sep < 0) return null;
  const parsed = nodeKindSchema.safeParse(raw.slice(0, sep));
  if (!parsed.success) return null;
  return { kind: parsed.data, name: decodeURIComponent(raw.slice(sep + 1)) };
}

export const treeNodeSchema = z.object({
  kind: nodeKindSchema,
  name: z.string(), // the raw identifier, used to build SQL and to copy
  path: z.string(), // encoded, relative to the connection
  hasChildren: z.boolean(),
  detail: z.string().optional(), // muted right-aligned text: type, row estimate, signature
  badges: z.array(z.string()).optional(), // e.g. ['PK'], ['UNIQUE']
});
export type TreeNode = z.infer<typeof treeNodeSchema>;

export const columnMetaSchema = z.object({
  name: z.string(),
  position: z.number(),
  dataType: z.string(),
  nullable: z.boolean(),
  defaultExpr: z.string().nullable(),
  isPrimaryKey: z.boolean(),
  comment: z.string().nullable(),
});
export type ColumnMeta = z.infer<typeof columnMetaSchema>;

export const indexMetaSchema = z.object({
  name: z.string(),
  columns: z.array(z.string()),
  unique: z.boolean(),
  primary: z.boolean(),
  method: z.string().nullable(),
});
export type IndexMeta = z.infer<typeof indexMetaSchema>;

export const foreignKeyMetaSchema = z.object({
  name: z.string(),
  columns: z.array(z.string()),
  referencedPath: z.string(), // encoded path of the referenced table (P7)
  referencedColumns: z.array(z.string()),
  onDelete: z.string().nullable(),
  onUpdate: z.string().nullable(),
});
export type ForeignKeyMeta = z.infer<typeof foreignKeyMetaSchema>;

export const objectMetaSchema = z.object({
  path: z.string(),
  kind: nodeKindSchema,
  name: z.string(),
  qualifiedName: z.string(),
  columns: z.array(columnMetaSchema),
  primaryKey: z.array(z.string()).nullable(),
  foreignKeys: z.array(foreignKeyMetaSchema),
  referencedBy: z.array(foreignKeyMetaSchema), // D17
  indexes: z.array(indexMetaSchema),
  rowEstimate: z.number().nullable(),
  comment: z.string().nullable(),
});
export type ObjectMeta = z.infer<typeof objectMetaSchema>;
