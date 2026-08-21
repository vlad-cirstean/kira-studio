import { z } from 'zod';

export const windowBoundsSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
});
export type WindowBounds = z.infer<typeof windowBoundsSchema>;

const panelProjectSchema = z.object({ visible: z.boolean(), width: z.number() });
const panelOperationsSchema = z.object({ visible: z.boolean(), height: z.number() });
const panelCellEditorSchema = z.object({ visible: z.boolean(), height: z.number() });

export const layoutSchema = z.object({
  panel: z.object({
    project: panelProjectSchema,
    operations: panelOperationsSchema,
    cellEditor: panelCellEditorSchema,
  }),
  window: z.object({
    bounds: windowBoundsSchema.nullable(),
  }),
});
export type Layout = z.infer<typeof layoutSchema>;

export const layoutPatchSchema = z.object({
  panel: z
    .object({
      project: panelProjectSchema.partial().optional(),
      operations: panelOperationsSchema.partial().optional(),
      cellEditor: panelCellEditorSchema.partial().optional(),
    })
    .optional(),
  window: z
    .object({
      bounds: windowBoundsSchema.nullable().optional(),
    })
    .optional(),
});
export type LayoutPatch = z.infer<typeof layoutPatchSchema>;

export const defaultLayout: Layout = {
  panel: {
    project: { visible: true, width: 260 },
    operations: { visible: false, height: 200 },
    cellEditor: { visible: true, height: 180 },
  },
  window: {
    bounds: null,
  },
};
