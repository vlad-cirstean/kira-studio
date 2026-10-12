import { z } from 'zod';

// Wire types of internal/llmprompts.Bound: the editable LLM prompt registry. Go nil slices
// marshal to null, so every list tolerates it.
const list = <T extends z.ZodType>(item: T) =>
  z
    .array(item)
    .nullish()
    .transform((v) => v ?? []);

export const llmPromptKindSchema = /*#__PURE__*/ z.enum([
  'system',
  'message',
  'suffix',
  'instructions',
  'tool',
  'argument',
  'toolResult',
  'fragment',
]);
export type LlmPromptKind = z.infer<typeof llmPromptKindSchema>;

export const llmPromptVarSchema = /*#__PURE__*/ z.object({
  name: z.string(),
  required: z.boolean(),
  example: z.string(),
});
export type LlmPromptVar = z.infer<typeof llmPromptVarSchema>;

export const llmPromptViewSchema = /*#__PURE__*/ z.object({
  id: z.string(),
  kind: llmPromptKindSchema,
  parent: z.string(),
  field: z.string(),
  name: z.string(),
  titleKey: z.string(),
  purposeKey: z.string(),
  usedByKey: z.string(),
  applies: z.enum(['nextCall', 'newSession']),
  vars: list(llmPromptVarSchema),
  fragments: list(z.string()),
  schema: z.string(),
  defaultText: z.string(),
  text: z.string(),
  hash: z.string(),
  overridden: z.boolean(),
  invalid: z.string(),
  defaultChanged: z.boolean(),
  updatedAt: z.number(),
});
export type LlmPromptView = z.infer<typeof llmPromptViewSchema>;

export const llmPromptListSchema = /*#__PURE__*/ z.object({
  prompts: list(llmPromptViewSchema),
  storeError: z.string(),
  revision: z.number(),
});
export type LlmPromptList = z.infer<typeof llmPromptListSchema>;

export const llmPromptProblemSchema = /*#__PURE__*/ z.object({
  id: z.string(),
  message: z.string(),
  line: z.number(),
  col: z.number(),
});
export type LlmPromptProblem = z.infer<typeof llmPromptProblemSchema>;

export const llmPromptPartSchema = /*#__PURE__*/ z.object({
  text: z.string(),
  var: z.string(),
  value: z.string(),
});
export type LlmPromptPart = z.infer<typeof llmPromptPartSchema>;

export const llmPromptPreviewSchema = /*#__PURE__*/ z.object({
  errors: list(llmPromptProblemSchema),
  parts: list(llmPromptPartSchema),
});
export type LlmPromptPreview = z.infer<typeof llmPromptPreviewSchema>;

/** One edit: `baseHash` is the `hash` of the view the text was edited from. */
export interface LlmPromptChange {
  id: string;
  text: string;
  baseHash: string;
}

/** A preview request: `text` defaults to the effective text, `vars` to the example values. */
export interface LlmPromptPreviewArgs {
  id: string;
  text?: string;
  vars?: Record<string, unknown>;
}

/** Pushed on `kira:llmPrompts:changed` after the overrides file changed. */
export interface LlmPromptsChangedEvent {
  revision: number;
}
