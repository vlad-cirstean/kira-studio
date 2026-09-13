// P21 §8.16's "single data file" promise, finally true: the one table every consumer derives
// from — main/menu.ts's native accelerators, the context menu's displayed shortcut text
// (renderer/shortcuts/keys.ts's formatShortcut), and the local DOM-scoped keydown handlers
// (matchesShortcut) that own every `global: false` row. A displayed shortcut and the shortcut
// that actually runs can no longer drift, because both read the same entry by id.
export interface Chord {
  /** Electron accelerator key name: 'C', 'F2', 'Return', 'Delete', 'Backspace', 'Tab', ','. */
  key: string;
  cmdOrCtrl?: true;
  /** Literal Control on every platform, unlike cmdOrCtrl — what Control+Tab needs. */
  ctrl?: true;
  shift?: true;
  alt?: true;
}

export interface Binding {
  chord: Chord;
  /** Platform override. Only ever set on global: false bindings — accelerator() never needs it. */
  mac?: Chord;
  /** true => main/menu.ts emits it as an Electron accelerator; false => a local keydown owns it. */
  global: boolean;
}

export const SHORTCUTS = {
  'app.settings': { chord: { key: ',', cmdOrCtrl: true }, global: true },
  'app.newConnection': { chord: { key: 'N', cmdOrCtrl: true }, global: true },
  'view.toggleProjectPanel': { chord: { key: 'B', cmdOrCtrl: true }, global: true },
  'view.toggleOperationsPanel': { chord: { key: 'J', cmdOrCtrl: true }, global: true },
  'view.commandPalette': { chord: { key: 'P', cmdOrCtrl: true, shift: true }, global: true },
  'view.find': { chord: { key: 'F', cmdOrCtrl: true }, global: true },
  'view.refresh': { chord: { key: 'F5' }, global: true },
  'view.run': { chord: { key: 'Return', cmdOrCtrl: true }, global: true },
  'view.runAll': { chord: { key: 'Return', cmdOrCtrl: true, shift: true }, global: true },
  // P13 D7: VS Code's own Format Document chord — ⌥⇧F on macOS — so it's the one a user already
  // has in their fingers.
  'view.format': { chord: { key: 'F', shift: true, alt: true }, global: true },
  'tab.next': { chord: { key: 'Tab', ctrl: true }, global: true },
  'tab.prev': { chord: { key: 'Tab', ctrl: true, shift: true }, global: true },
  'tab.close': { chord: { key: 'W', cmdOrCtrl: true }, global: true },
  'window.new': { chord: { key: 'N', cmdOrCtrl: true, shift: true }, global: true },
  'window.close': { chord: { key: 'W', cmdOrCtrl: true, shift: true }, global: true },

  'grid.copy': { chord: { key: 'C', cmdOrCtrl: true }, global: false },
  'grid.paste': { chord: { key: 'V', cmdOrCtrl: true }, global: false },
  'grid.edit': { chord: { key: 'Return' }, global: false },
  'grid.duplicateRows': { chord: { key: 'D', cmdOrCtrl: true }, global: false },
  'grid.deleteRows': {
    chord: { key: 'Delete' },
    mac: { key: 'Backspace', cmdOrCtrl: true },
    global: false,
  },

  'tree.open': { chord: { key: 'Return' }, global: false },
  'tree.copyName': { chord: { key: 'C', cmdOrCtrl: true }, global: false },
  'tree.copyUri': {
    chord: { key: 'C', shift: true, alt: true },
    mac: { key: 'C', alt: true, cmdOrCtrl: true },
    global: false,
  },
  'tree.rename': { chord: { key: 'F2' }, global: false },
  'tree.duplicate': { chord: { key: 'D', cmdOrCtrl: true }, global: false },
  'tree.delete': {
    chord: { key: 'Delete' },
    mac: { key: 'Backspace', cmdOrCtrl: true },
    global: false,
  },
} satisfies Record<string, Binding>;

export type ShortcutId = keyof typeof SHORTCUTS;

function chordToAccelerator(chord: Chord): string {
  const parts: string[] = [];
  if (chord.cmdOrCtrl) parts.push('CmdOrCtrl');
  if (chord.ctrl) parts.push('Control');
  if (chord.shift) parts.push('Shift');
  if (chord.alt) parts.push('Alt');
  parts.push(chord.key);
  return parts.join('+');
}

/** 'CmdOrCtrl+Shift+P'. Called only by main/menu.ts, only over global bindings. */
export function accelerator(id: ShortcutId): string {
  const binding: Binding = SHORTCUTS[id];
  return chordToAccelerator(binding.chord);
}
