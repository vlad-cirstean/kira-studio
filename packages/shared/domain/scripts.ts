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
  // '' means the host app's own default directory — Kira Studio's own $HOME
  // (internal/bridge/terminal.go's DefaultCwd), its only real consumer today; this schema lives
  // here, not in Kira Studio's own settingsDomain.ts, in case Kira Space ever grows the same
  // custom-scripts feature.
  workingDir: z.string(),
  color: paletteColorSchema,
  // null = ungrouped; the panel groups rows under their collection.
  collectionId: z.string().nullable(),
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

// scriptCollectionSchema mirrors quickcommands.Collection — one custom_script_collections row.
export const scriptCollectionSchema = /*#__PURE__*/ z.object({
  id: z.string(),
  name: z.string(),
  sortOrder: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ScriptCollection = z.infer<typeof scriptCollectionSchema>;

// quickCommandsSnapshotSchema mirrors quickcommands.Snapshot — what List answers and every
// mutation broadcasts.
export const quickCommandsSnapshotSchema = /*#__PURE__*/ z.object({
  collections: z.array(scriptCollectionSchema),
  scripts: z.array(customScriptSchema),
});
export type QuickCommandsSnapshot = z.infer<typeof quickCommandsSnapshotSchema>;
