import { z } from 'zod';

// P216: bridge/dictation.go's Status and stt.Frame, validated at the edge. Go omits empty
// strings and zero numbers (omitempty), so those fields default here.
export const dictationStatusSchema = /*#__PURE__*/ z.object({
  state: /*#__PURE__*/ z.enum(['off', 'notInstalled', 'downloading', 'unavailable', 'ready']),
  message: z.string(),
  done: z.number().int(),
  total: z.number().int(),
});
export type DictationStatus = z.infer<typeof dictationStatusSchema>;

export const dictationErrorCodeSchema = /*#__PURE__*/ z.enum([
  'busy',
  'notInstalled',
  'mic',
  'worker',
]);
export type DictationErrorCode = z.infer<typeof dictationErrorCodeSchema>;

export const dictationFrameSchema = /*#__PURE__*/ z.discriminatedUnion('type', [
  z.object({
    type: z.literal('state'),
    state: z.enum(['starting', 'listening', 'finishing']),
    level: z.number().default(0),
  }),
  z.object({
    type: z.literal('text'),
    text: z.string().default(''),
    committed: z.number().int().default(0),
  }),
  z.object({ type: z.literal('final'), text: z.string().default('') }),
  z.object({
    type: z.literal('error'),
    code: dictationErrorCodeSchema,
    message: z.string().default(''),
    text: z.string().default(''),
  }),
]);
export type DictationFrame = z.infer<typeof dictationFrameSchema>;
