import { z } from 'zod';

// P420: the validation-proof window's domain. Mirrors internal/proof's wire types and the payload
// shapes internal/proof/validate.go stores; Go validates first, the window parses again before
// building a page from a payload.

export const proofViewSchema = /*#__PURE__*/ z.enum(['table', 'document', 'keyvalue']);
export type ProofView = z.infer<typeof proofViewSchema>;

export const proofLanguageSchema = /*#__PURE__*/ z.enum(['sql', 'json', 'shell', 'text']);

export const proofDiffSchema = /*#__PURE__*/ z.enum(['added', 'changed', 'unchanged', 'removed']);
export type ProofDiff = z.infer<typeof proofDiffSchema>;

export const proofColumnTypeSchema = /*#__PURE__*/ z.enum([
  'number',
  'text',
  'boolean',
  'temporal',
  'json',
  'other',
]);

export const proofTablePayloadSchema = /*#__PURE__*/ z.object({
  columns: z.array(z.object({ name: z.string(), type: proofColumnTypeSchema })),
  rows: z.array(z.array(z.unknown())),
});
export type ProofTablePayload = z.infer<typeof proofTablePayloadSchema>;

export const proofDocumentPayloadSchema = /*#__PURE__*/ z.object({
  documents: z.array(z.object({ id: z.string(), body: z.record(z.string(), z.unknown()) })),
});
export type ProofDocumentPayload = z.infer<typeof proofDocumentPayloadSchema>;

export const proofKeyValuePayloadSchema = /*#__PURE__*/ z.object({
  entries: z.array(z.object({ field: z.string(), value: z.unknown() })),
});
export type ProofKeyValuePayload = z.infer<typeof proofKeyValuePayloadSchema>;

// Mirrors views/shared/slick/selection.ts's Selection.
export const proofSelectionSchema = /*#__PURE__*/ z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('cell'), row: z.number().int(), col: z.number().int() }),
  z.object({
    kind: z.literal('range'),
    anchorRow: z.number().int(),
    anchorCol: z.number().int(),
    row: z.number().int(),
    col: z.number().int(),
  }),
  z.object({ kind: z.literal('row'), rows: z.array(z.number().int()) }),
  z.object({ kind: z.literal('column'), cols: z.array(z.number().int()) }),
]);

// Where a tab was scrolled and what was highlighted: restored on every mount, matched by the
// screenshot, saved per step.
export const proofViewStateSchema = /*#__PURE__*/ z.object({
  queryScrollTop: z.number(),
  resultScrollTop: z.number(),
  resultScrollLeft: z.number(),
  selection: proofSelectionSchema.nullable(),
  selectedRow: z.number().int().nullable(),
  expanded: z.array(z.string()),
  columnWidths: z.record(z.string(), z.number()),
});
export type ProofViewState = z.infer<typeof proofViewStateSchema>;

export const proofSummarySchema = /*#__PURE__*/ z.object({
  id: z.string(),
  name: z.string(),
  closedAt: z.number(),
  steps: z.number().int(),
  pending: z.boolean(),
  seen: z.boolean(),
});
export type ProofSummary = z.infer<typeof proofSummarySchema>;

export const proofStepMetaSchema = /*#__PURE__*/ z.object({
  ordinal: z.number().int(),
  description: z.string(),
  language: proofLanguageSchema,
  source: z.string(),
  view: proofViewSchema,
  bytes: z.number().int(),
  diff: proofDiffSchema,
  originOrdinal: z.number().int().nullable(),
});
export type ProofStepMeta = z.infer<typeof proofStepMetaSchema>;

export const proofRevisionSchema = /*#__PURE__*/ z.object({
  rev: z.number().int(),
  reason: z.string(),
  createdAt: z.number(),
  steps: z.array(proofStepMetaSchema),
});
export type ProofRevision = z.infer<typeof proofRevisionSchema>;

export const proofDetailSchema = /*#__PURE__*/ z.object({
  id: z.string(),
  name: z.string(),
  summary: z.string(),
  closedAt: z.number(),
  current: proofRevisionSchema,
  pending: proofRevisionSchema.nullable(),
  removed: z.array(proofStepMetaSchema),
});
export type ProofDetail = z.infer<typeof proofDetailSchema>;

export const proofStepDetailSchema = /*#__PURE__*/ proofStepMetaSchema.extend({
  query: z.string(),
  data: z.unknown(),
});
export type ProofStepDetail = z.infer<typeof proofStepDetailSchema>;

export const proofViewStateEntrySchema = /*#__PURE__*/ z.object({
  ordinal: z.number().int(),
  state: proofViewStateSchema,
});
export type ProofViewStateEntry = z.infer<typeof proofViewStateEntrySchema>;

export const proofOpenResultSchema = /*#__PURE__*/ z.object({
  key: z.string(),
  opened: z.boolean(),
});
export const proofWindowTargetSchema = /*#__PURE__*/ z.object({ sessionId: z.string().nullable() });
export const proofSavePngResultSchema = /*#__PURE__*/ z.object({
  saved: z.boolean(),
  path: z.string().nullable(),
});
export type ProofOpenResult = z.infer<typeof proofOpenResultSchema>;
export type ProofWindowTarget = z.infer<typeof proofWindowTargetSchema>;
export type ProofSavePngResult = z.infer<typeof proofSavePngResultSchema>;

// kira:proof:changed and kira:proof:select payloads.
export const proofChangedSchema = /*#__PURE__*/ z.object({ sessionId: z.string() });
export const proofSelectSchema = /*#__PURE__*/ z.object({ sessionId: z.string() });
export type ProofChanged = z.infer<typeof proofChangedSchema>;
export type ProofSelect = z.infer<typeof proofSelectSchema>;
