import { z } from 'zod';

// P178: one credential prompt the ADE board or git stream raised, relayed to every
// Kira Space window. `source` is the asking caller's label; `repoLabel` the repository folder name.
export const gitCredentialPromptSchema = /*#__PURE__*/ z.object({
  requestId: z.string(),
  source: z.string(),
  repoLabel: z.string(),
  prompt: z.string(),
  masked: z.boolean(),
});
export type GitCredentialPrompt = z.infer<typeof gitCredentialPromptSchema>;
