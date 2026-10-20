import { z } from 'zod';
import { memoryKindSchema } from './memory';

// P285 Part 4, P297: bridge/memorydistill.go's wire shapes. Sizes count characters (runes) and tokens
// (runes / 3) of the input and of the output as Copy puts it on the clipboard (line texts joined).
export const distillLineSchema = /*#__PURE__*/ z.object({
  text: z.string(),
  kind: memoryKindSchema,
});
export type DistillLine = z.infer<typeof distillLineSchema>;

// A fact the input leaves open, with the questions that would settle it.
export const distillUnresolvedSchema = /*#__PURE__*/ z.object({
  fact: z.string(),
  questions: z.array(z.string()),
});

export const distillModeSchema = /*#__PURE__*/ z.enum(['facts', 'rewrite']);
export type DistillMode = z.infer<typeof distillModeSchema>;

// Rewrite mode: gate is the check that rejected the draft ('' when none did); unchanged is
// changed false with gate ''. The wire also carries draft for audit; the UI never reads it.
export const distillRewriteSchema = /*#__PURE__*/ z.object({
  text: z.string(),
  changed: z.boolean(),
  gate: z.enum(['', 'grew', 'form', 'indent', 'width', 'directive', 'tokens', 'output']),
  reason: z.string(),
  dropped: z.array(
    z.object({
      text: z.string(),
      why: z.enum(['tag', 'history', 'restatesCode', 'trivia']),
    }),
  ),
});
export type DistillRewrite = z.infer<typeof distillRewriteSchema>;

export const distillResultSchema = /*#__PURE__*/ z.object({
  mode: distillModeSchema,
  rewrite: distillRewriteSchema.nullable(),
  lines: z.array(distillLineSchema),
  unresolved: z.array(distillUnresolvedSchema),
  costUsd: z.number(),
  chunks: z.number().int(),
  inChars: z.number().int(),
  outChars: z.number().int(),
  inTokens: z.number().int(),
  outTokens: z.number().int(),
});
export type DistillResult = z.infer<typeof distillResultSchema>;

export const distillLimitsSchema = /*#__PURE__*/ z.object({
  maxChars: z.number().int(),
  maxParts: z.number().int(),
  spendCapUsd: z.number(),
  storeMaxLines: z.number().int(),
  rewriteMaxChars: z.number().int(),
});
export type DistillLimits = z.infer<typeof distillLimitsSchema>;

export const distillChoiceSchema = /*#__PURE__*/ z.object({
  canceled: z.boolean(),
  path: z.string(),
});
export type DistillChoice = z.infer<typeof distillChoiceSchema>;

// Stage: extract counts parts, verify counts cross-check batches, merge is the one merge call;
// rewrite is the one call of rewrite mode.
export const distillStageSchema = /*#__PURE__*/ z.enum(['extract', 'verify', 'merge', 'rewrite']);
export type DistillStage = z.infer<typeof distillStageSchema>;

export const distillProgressSchema = /*#__PURE__*/ z.object({
  requestId: z.string(),
  stage: distillStageSchema,
  done: z.number().int(),
  total: z.number().int(),
  costUsd: z.number(),
});
export type DistillProgress = z.infer<typeof distillProgressSchema>;

/** Exactly one of `text` and `path`. `requestId` tags the progress pushes. */
export interface DistillArgs {
  requestId: string;
  text?: string;
  path?: string;
  mode?: DistillMode;
}
