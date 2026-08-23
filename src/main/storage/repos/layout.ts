import {
  defaultLayout,
  type Layout,
  type LayoutPatch,
  layoutPatchSchema,
  layoutSchema,
} from '../../../shared/layout';
import type { KiraDb } from '../db';
import { uiLayout } from '../schema/layout';

async function read(db: KiraDb): Promise<Map<string, unknown>> {
  const rows = await db.select().from(uiLayout);
  return new Map(rows.map((r) => [r.key, JSON.parse(r.value) as unknown]));
}

function pick(stored: Map<string, unknown>, key: string, fallback: unknown): unknown {
  return stored.has(key) ? stored.get(key) : fallback;
}

export async function getAllLayout(db: KiraDb): Promise<Layout> {
  const stored = await read(db);
  const candidate = {
    panel: {
      project: {
        visible: pick(stored, 'panel.project.visible', defaultLayout.panel.project.visible),
        width: pick(stored, 'panel.project.width', defaultLayout.panel.project.width),
      },
      operations: {
        visible: pick(stored, 'panel.operations.visible', defaultLayout.panel.operations.visible),
        height: pick(stored, 'panel.operations.height', defaultLayout.panel.operations.height),
      },
      cellEditor: {
        height: pick(stored, 'panel.cellEditor.height', defaultLayout.panel.cellEditor.height),
      },
    },
    window: {
      bounds: pick(stored, 'window.bounds', defaultLayout.window.bounds),
    },
  };
  // A hand-edited or stale-shape row must fail loudly here, not propagate `undefined`s into the UI.
  return layoutSchema.parse(candidate);
}

function flatten(layout: Layout): [string, unknown][] {
  return [
    ['panel.project.visible', layout.panel.project.visible],
    ['panel.project.width', layout.panel.project.width],
    ['panel.operations.visible', layout.panel.operations.visible],
    ['panel.operations.height', layout.panel.operations.height],
    ['panel.cellEditor.height', layout.panel.cellEditor.height],
    ['window.bounds', layout.window.bounds],
  ];
}

export async function setLayout(db: KiraDb, patch: LayoutPatch): Promise<Layout> {
  const validPatch = layoutPatchSchema.parse(patch);
  const current = await getAllLayout(db);
  const merged: Layout = {
    panel: {
      project: { ...current.panel.project, ...validPatch.panel?.project },
      operations: { ...current.panel.operations, ...validPatch.panel?.operations },
      cellEditor: { ...current.panel.cellEditor, ...validPatch.panel?.cellEditor },
    },
    window: { ...current.window, ...validPatch.window },
  };

  await db.transaction(async (tx) => {
    for (const [key, value] of flatten(merged)) {
      await tx
        .insert(uiLayout)
        .values({ key, value: JSON.stringify(value) })
        .onConflictDoUpdate({
          target: uiLayout.key,
          set: { value: JSON.stringify(value) },
        });
    }
  });

  return merged;
}
