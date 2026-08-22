import { z } from 'zod';
import { nodeKindSchema } from './tree';

/** Where the text came from. 'server' is the engine's own definition, byte for byte. */
export const ddlOriginSchema = z.enum(['server', 'composed']);
export type DdlOrigin = z.infer<typeof ddlOriginSchema>;

export const sourceTextSchema = z.object({
  /** Encoded NodePath of the object — the L1 cache key's second component and the tab's path. */
  path: z.string(),
  kind: nodeKindSchema,
  /** Display form, unquoted, identical to ObjectMeta.qualifiedName: 'app.order_items'. */
  qualifiedName: z.string(),
  /** Ordered, each without a trailing semicolon. Never empty. */
  statements: z.array(z.string()).min(1),
  origin: ddlOriginSchema,
  /** One short sentence per caveat; [] when there is nothing to say. */
  notes: z.array(z.string()),
  /** ISO-8601, stamped by the adapter when the text was produced. */
  generatedAt: z.string(),
});
export type SourceText = z.infer<typeof sourceTextSchema>;

/** The one definition of "the document". Used by the view, and by the DB specs' round trip. */
export function ddlText(source: SourceText): string {
  return source.statements.map((s) => `${s};`).join('\n\n');
}
