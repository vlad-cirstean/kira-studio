import { z } from 'zod';

// C11 §14 OQ2 (S14): widthUserSet distinguishes a width the user actually dragged (setProjectWidth,
// state/layout.ts's own sole caller of it) from one this app set for them — the signal "has the
// user resized this panel" the review segment's first-activation widen needs and no existing field
// answers. `.default(false)` keeps a layout saved before this phase valid (never treated as
// user-set, so the one-time widen still applies for a window that saved before this field existed).
const panelProjectSchema = /*#__PURE__*/ z.object({
  visible: z.boolean(),
  width: z.number(),
  widthUserSet: z.boolean().default(false),
});
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
    project: { visible: true, width: 260, widthUserSet: false },
    operations: { visible: false, height: 200 },
    cellEditor: { height: 180 },
  },
};
