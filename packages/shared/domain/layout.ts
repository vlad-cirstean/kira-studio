import { z } from 'zod';

// widthUserSet distinguishes a width the user dragged (setProjectWidth,
// state/layout.ts's own sole caller of it) from one this app set for them — the signal "has the
// user resized this panel" the review segment's first-activation widen needs and no existing field
// answers. `.default(false)` keeps a layout saved before this field existed valid
// (never treated as user-set, so the one-time widen still applies).
const projectSizeSchema = /*#__PURE__*/ z.object({
  width: z.number(),
  widthUserSet: z.boolean().default(false),
});
const operationsSizeSchema = /*#__PURE__*/ z.object({ height: z.number() });
// P312: panel sizes are per module (keyed by the app's mode); visibility toggles stay app-wide.
const panelSizesSchema = /*#__PURE__*/ z.object({
  project: projectSizeSchema,
  operations: operationsSizeSchema,
});
const panelProjectSchema = /*#__PURE__*/ z.object({ visible: z.boolean() });
const panelOperationsSchema = /*#__PURE__*/ z.object({ visible: z.boolean() });
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
  modes: /*#__PURE__*/ z.record(z.string(), panelSizesSchema),
});
export type PanelSizes = z.infer<typeof panelSizesSchema>;
export type Layout = z.infer<typeof layoutSchema>;

export const layoutPatchSchema = /*#__PURE__*/ z.object({
  panel: z
    .object({
      project: panelProjectSchema.partial().optional(),
      operations: panelOperationsSchema.partial().optional(),
      cellEditor: panelCellEditorSchema.partial().optional(),
    })
    .optional(),
  modes: z
    .record(
      z.string(),
      z.object({
        project: projectSizeSchema.partial().optional(),
        operations: operationsSizeSchema.partial().optional(),
      }),
    )
    .optional(),
});
export type LayoutPatch = z.infer<typeof layoutPatchSchema>;

export const defaultPanelSizes: PanelSizes = {
  project: { width: 260, widthUserSet: false },
  operations: { height: 200 },
};

export const defaultLayout: Layout = {
  panel: {
    project: { visible: true },
    operations: { visible: false },
    cellEditor: { height: 180 },
  },
  modes: {},
};
