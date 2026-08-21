import {
  defaultLayout,
  type Layout,
  type LayoutPatch,
  type WindowBounds,
} from '../../shared/layout';
import type { Db } from './db';

function read(db: Db): Map<string, unknown> {
  const rows = db.all('SELECT key, value FROM ui_layout') as { key: string; value: string }[];
  return new Map(rows.map((r) => [r.key, JSON.parse(r.value) as unknown]));
}

function pick<T>(stored: Map<string, unknown>, key: string, fallback: T): T {
  return stored.has(key) ? (stored.get(key) as T) : fallback;
}

export function getAllLayout(db: Db): Layout {
  const stored = read(db);
  return {
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
        visible: pick(stored, 'panel.cellEditor.visible', defaultLayout.panel.cellEditor.visible),
        height: pick(stored, 'panel.cellEditor.height', defaultLayout.panel.cellEditor.height),
      },
    },
    window: {
      bounds: pick<WindowBounds | null>(stored, 'window.bounds', defaultLayout.window.bounds),
    },
  };
}

function flatten(layout: Layout): [string, unknown][] {
  return [
    ['panel.project.visible', layout.panel.project.visible],
    ['panel.project.width', layout.panel.project.width],
    ['panel.operations.visible', layout.panel.operations.visible],
    ['panel.operations.height', layout.panel.operations.height],
    ['panel.cellEditor.visible', layout.panel.cellEditor.visible],
    ['panel.cellEditor.height', layout.panel.cellEditor.height],
    ['window.bounds', layout.window.bounds],
  ];
}

export function setLayout(db: Db, patch: LayoutPatch): Layout {
  const current = getAllLayout(db);
  const merged: Layout = {
    panel: {
      project: { ...current.panel.project, ...patch.panel?.project },
      operations: { ...current.panel.operations, ...patch.panel?.operations },
      cellEditor: { ...current.panel.cellEditor, ...patch.panel?.cellEditor },
    },
    window: { ...current.window, ...patch.window },
  };

  db.transaction(() => {
    for (const [key, value] of flatten(merged)) {
      db.run(
        'INSERT INTO ui_layout (key, value) VALUES (?, ?) ' +
          'ON CONFLICT(key) DO UPDATE SET value = excluded.value',
        [key, JSON.stringify(value)],
      );
    }
  });

  return merged;
}
