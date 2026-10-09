import { z } from 'zod';
import { paletteColorSchema } from './color';

// P85 §9.2: zod schemas mirroring internal/scripts — mask.ts's own
// Fields/full split (maskRuleFieldsSchema/maskRuleSchema).

// Where a script runs: the app's automations folder, a picked folder, or (legacy rows only) $HOME.
export const scriptDirModeSchema = /*#__PURE__*/ z.enum(['kira', 'fixed', 'home']);
export type ScriptDirMode = z.infer<typeof scriptDirModeSchema>;

// customScriptFieldsSchema mirrors scripts.CustomScriptFields — what the Create/Update bound calls
// accept. The Go check (scripts.CustomScriptFields.Validate) is the authority; this is
// only the dialog's own affordance for disabling Add before a round trip.
export const customScriptFieldsSchema = /*#__PURE__*/ z.object({
  name: z.string(),
  command: z.string(),
  dirMode: scriptDirModeSchema,
  // The picked folder when dirMode is 'fixed'; '' otherwise.
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

// scriptCollectionSchema mirrors scripts.Collection — one custom_script_collections row.
export const scriptCollectionSchema = /*#__PURE__*/ z.object({
  id: z.string(),
  name: z.string(),
  sortOrder: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ScriptCollection = z.infer<typeof scriptCollectionSchema>;

// scriptsSnapshotSchema mirrors scripts.Snapshot — what List answers and every
// mutation broadcasts.
export const scriptsSnapshotSchema = /*#__PURE__*/ z.object({
  collections: z.array(scriptCollectionSchema),
  scripts: z.array(customScriptSchema),
});
export type ScriptsSnapshot = z.infer<typeof scriptsSnapshotSchema>;

// scriptDirSchema mirrors scripts.Dir — where a saved script runs, and why it cannot.
export const scriptDirSchema = /*#__PURE__*/ z.object({
  path: z.string(),
  mode: scriptDirModeSchema,
  base: z.string(),
  blocker: z.string(),
});
export type ScriptDir = z.infer<typeof scriptDirSchema>;
