// The one table the context menu's displayed shortcut text (formatShortcut) and the local
// DOM-scoped keydown handlers (matchesShortcut) both read by id, so a displayed shortcut and the
// one that runs cannot drift. The native menu accelerators are Go's own copy
// (apps/*/internal/shell/accel.go).
export interface Chord {
  /** Key name: 'C', 'F2', 'Return', 'Delete', 'Backspace', 'Tab', ','. */
  key: string;
  cmdOrCtrl?: true;
  /** Literal Control on every platform, unlike cmdOrCtrl — what Control+Tab needs. */
  ctrl?: true;
  shift?: true;
  alt?: true;
}

export interface Binding {
  chord: Chord;
  /** Platform override, read by the local keydown matcher. */
  mac?: Chord;
}

export const SHORTCUTS = {
  'app.settings': { chord: { key: ',', cmdOrCtrl: true } },
  'app.newConnection': { chord: { key: 'N', cmdOrCtrl: true } },
  'view.toggleProjectPanel': { chord: { key: 'B', cmdOrCtrl: true } },
  'view.toggleOperationsPanel': { chord: { key: 'J', cmdOrCtrl: true } },
  'view.commandPalette': { chord: { key: 'P', cmdOrCtrl: true, shift: true } },
  'view.find': { chord: { key: 'F', cmdOrCtrl: true } },
  'view.refresh': { chord: { key: 'F5' } },
  'view.run': { chord: { key: 'Return', cmdOrCtrl: true } },
  'view.runAll': { chord: { key: 'Return', cmdOrCtrl: true, shift: true } },
  // P13 D7: VS Code's own Format Document chord — ⌥⇧F on macOS — so it's the one a user already
  // has in their fingers.
  'view.format': { chord: { key: 'F', shift: true, alt: true } },
  'tab.next': { chord: { key: 'Tab', ctrl: true } },
  'tab.prev': { chord: { key: 'Tab', ctrl: true, shift: true } },
  'tab.close': { chord: { key: 'W', cmdOrCtrl: true } },
  'window.new': { chord: { key: 'N', cmdOrCtrl: true, shift: true } },
  'window.close': { chord: { key: 'W', cmdOrCtrl: true, shift: true } },

  'ade.reviewCode': { chord: { key: 'R', cmdOrCtrl: true, shift: true } },

  'grid.copy': { chord: { key: 'C', cmdOrCtrl: true } },
  'grid.paste': { chord: { key: 'V', cmdOrCtrl: true } },
  'grid.edit': { chord: { key: 'Return' } },
  'grid.duplicateRows': { chord: { key: 'D', cmdOrCtrl: true } },
  'grid.deleteRows': {
    chord: { key: 'Delete' },
    mac: { key: 'Backspace', cmdOrCtrl: true },
  },

  'tree.open': { chord: { key: 'Return' } },
  'tree.copyName': { chord: { key: 'C', cmdOrCtrl: true } },
  'tree.copyUri': {
    chord: { key: 'C', shift: true, alt: true },
    mac: { key: 'C', alt: true, cmdOrCtrl: true },
  },
  'tree.rename': { chord: { key: 'F2' } },
  'tree.duplicate': { chord: { key: 'D', cmdOrCtrl: true } },
  'tree.delete': {
    chord: { key: 'Delete' },
    mac: { key: 'Backspace', cmdOrCtrl: true },
  },
} satisfies Record<string, Binding>;

export type ShortcutId = keyof typeof SHORTCUTS;
