import { z } from 'zod';

// P285 Part 4: bridge/memorydistill.go's wire shapes. Sizes count characters (runes) and tokens
// (runes / 3) of the input and of the output as Copy puts it on the clipboard.
export const distillResultSchema = /*#__PURE__*/ z.object({
  lines: z.array(z.string()),
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
});
export type DistillLimits = z.infer<typeof distillLimitsSchema>;

export const distillChoiceSchema = /*#__PURE__*/ z.object({
  canceled: z.boolean(),
  path: z.string(),
});
export type DistillChoice = z.infer<typeof distillChoiceSchema>;

export const distillProgressSchema = /*#__PURE__*/ z.object({
  requestId: z.string(),
  done: z.number().int(),
  total: z.number().int(),
  costUsd: z.number(),
});
export type DistillProgress = z.infer<typeof distillProgressSchema>;

export type DistillMode = 'facts' | 'instructions';

/** Exactly one of `text` and `path`. `requestId` tags the progress pushes. */
export interface DistillArgs {
  requestId: string;
  text?: string;
  path?: string;
  mode: DistillMode;
}
