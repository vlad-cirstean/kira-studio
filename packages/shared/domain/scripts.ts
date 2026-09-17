import { z } from 'zod';
import { paletteColorSchema } from './color';

// P85 §9.2: zod schemas mirroring internal/storage/model/customscript.go — mask.ts's own
// Fields/full split (maskRuleFieldsSchema/maskRuleSchema).

// customScriptFieldsSchema mirrors model.CustomScriptFields — what the Create/Update bound calls
// accept. The Go check (model.CustomScriptFields.Validate, P85 §10.3) is the authority; this is
// only the dialog's own affordance for disabling Add before a round trip.
export const customScriptFieldsSchema = /*#__PURE__*/ z.object({
  name: z.string(),
  command: z.string(),
  // '' means "the active repo workspace's own worktree directory" (plan §7).
  workingDir: z.string(),
  color: paletteColorSchema,
});
export type CustomScriptFields = z.infer<typeof customScriptFieldsSchema>;

// customScriptSchema mirrors model.CustomScript — one custom_scripts row.
export const customScriptSchema = /*#__PURE__*/ customScriptFieldsSchema.extend({
  id: z.string(),
  sortOrder: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type CustomScript = z.infer<typeof customScriptSchema>;
