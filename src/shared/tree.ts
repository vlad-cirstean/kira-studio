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
  'routine',
  'column',
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

// D6: node paths are encoded as `kind:name` segments joined by `/`, with `name` percent-encoded.
// The encoded form excludes the connection id (metadata_cache's key is already (connection_id,
// path)). Example: 'schema:public/table:order%2Fitems'. `encodePath([])` is '' — the root.
export function encodePath(segments: PathSegment[]): string {
  return segments.map((s) => `${s.kind}:${encodeURIComponent(s.name)}`).join('/');
}

// `decodePath` throws on an unknown kind or a malformed segment; callers treat that as a corrupt
// cache row and drop it.
export function decodePath(connectionId: string, encoded: string): NodePath {
  if (encoded === '') return { connectionId, segments: [] };
  const segments = encoded.split('/').map((part) => {
    const colon = part.indexOf(':');
    if (colon <= 0) throw new Error(`malformed path segment "${part}"`);
    const kind = part.slice(0, colon);
    const parsed = nodeKindSchema.safeParse(kind);
    if (!parsed.success) throw new Error(`unknown node kind "${kind}"`);
    return { kind: parsed.data, name: decodeURIComponent(part.slice(colon + 1)) };
  });
  return { connectionId, segments };
}

export function pathParent(encoded: string): string | null {
  if (encoded === '') return null;
  const last = encoded.lastIndexOf('/');
  return last === -1 ? '' : encoded.slice(0, last);
}

export function pathTail(encoded: string): PathSegment | null {
  if (encoded === '') return null;
  const last = encoded.lastIndexOf('/');
  const part = last === -1 ? encoded : encoded.slice(last + 1);
  const colon = part.indexOf(':');
  if (colon <= 0) return null;
  const parsed = nodeKindSchema.safeParse(part.slice(0, colon));
  if (!parsed.success) return null;
  return { kind: parsed.data, name: decodeURIComponent(part.slice(colon + 1)) };
}

export const treeNodeSchema = z.object({
  kind: nodeKindSchema,
  name: z.string(),
  path: z.string(),
  hasChildren: z.boolean(),
  detail: z.string().optional(),
  badges: z.array(z.string()).optional(),
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
  referencedPath: z.string(),
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
  referencedBy: z.array(foreignKeyMetaSchema),
  indexes: z.array(indexMetaSchema),
  rowEstimate: z.number().nullable(),
  comment: z.string().nullable(),
});
export type ObjectMeta = z.infer<typeof objectMetaSchema>;
