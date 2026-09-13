import { z } from 'zod';

const panelProjectSchema = /*#__PURE__*/ z.object({ visible: z.boolean(), width: z.number() });
const panelOperationsSchema = /*#__PURE__*/ z.object({ visible: z.boolean(), height: z.number() });
// No `visible` field (unlike its project/operations siblings): the cell editor panel's
// visibility is driven entirely by whether a cell is currently selected (session-only, never
// persisted — see `state/cellSelection.ts`), not by a manual toggle. Height stays user-adjustable
// and persisted like the other panels.
const panelCellEditorSchema = /*#__PURE__*/ z.object({ height: z.number() });

export const layoutSchema = /*#__PURE__*/ z.object({
  panel: /*#__PURE__*/ z.object({
    project: panelProjectSchema,
    operations: panelOperationsSchema,
    cellEditor: panelCellEditorSchema,
  }),
});
export type Layout = z.infer<typeof layoutSchema>;

export const layoutPatchSchema = /*#__PURE__*/ z.object({
  panel: z
    .object({
      project: panelProjectSchema.partial().optional(),
      operations: panelOperationsSchema.partial().optional(),
      cellEditor: panelCellEditorSchema.partial().optional(),
    })
    .optional(),
});
export type LayoutPatch = z.infer<typeof layoutPatchSchema>;

export const defaultLayout: Layout = {
  panel: {
    project: { visible: true, width: 260 },
    operations: { visible: false, height: 200 },
    cellEditor: { height: 180 },
  },
};
