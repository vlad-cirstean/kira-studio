import { type Binding, type Chord, SHORTCUTS, type ShortcutId } from '@shared/domain/shortcuts';

// Kira Studio's own shortcuts/keys.ts, ported verbatim — generic chord matching/formatting, no
// Studio-specific content. Kira Space's own Go menu (internal/shell/menutemplate.go) emits no
// accelerator-driven channels (P100 Part 1's own minimal menu), so every shortcut this app binds
// is a local keydown match (workbench/WorkbenchShell.vue) regardless of a given id's own
// `global` flag in the shared SHORTCUTS table — that flag only ever meant "which OS-level
// mechanism fires it" in Kira Studio, and matchesShortcut below does not care either way.
const isMac = navigator.userAgent.includes('Mac');

function resolveChord(id: ShortcutId): Chord {
  const binding: Binding = SHORTCUTS[id];
  return isMac ? (binding.mac ?? binding.chord) : binding.chord;
}

const MAC_KEY_GLYPH: Record<string, string> = {
  Return: '⏎',
  Backspace: '⌫',
  Delete: '⌦',
  Tab: '⇥',
  Escape: '⎋',
};

const KEY_DISPLAY: Record<string, string> = {
  Return: 'Enter',
  Escape: 'Esc',
};

/** 'Ctrl+C' / '⌘C', matching VS Code's own display order and glyphs. */
export function formatShortcut(id: ShortcutId): string {
  const chord = resolveChord(id);
  if (isMac) {
    const mods = [
      chord.ctrl ? '⌃' : '',
      chord.alt ? '⌥' : '',
      chord.shift ? '⇧' : '',
      chord.cmdOrCtrl ? '⌘' : '',
    ].join('');
    return `${mods}${MAC_KEY_GLYPH[chord.key] ?? chord.key}`;
  }
  const mods = [
    chord.cmdOrCtrl || chord.ctrl ? 'Ctrl' : '',
    chord.shift ? 'Shift' : '',
    chord.alt ? 'Alt' : '',
  ].filter(Boolean);
  return [...mods, KEY_DISPLAY[chord.key] ?? chord.key].join('+');
}

const DOM_KEY: Record<string, string> = { Return: 'Enter' };

function matchesShortcut(id: ShortcutId, e: KeyboardEvent): boolean {
  const chord = resolveChord(id);
  const cmdOrCtrlPressed = isMac ? e.metaKey : e.ctrlKey;
  const otherPlatformModPressed = isMac ? e.ctrlKey : e.metaKey;
  if (Boolean(chord.cmdOrCtrl) !== cmdOrCtrlPressed) return false;
  if (otherPlatformModPressed) return false;
  if (Boolean(chord.shift) !== e.shiftKey) return false;
  if (Boolean(chord.alt) !== e.altKey) return false;
  const domKey = DOM_KEY[chord.key] ?? chord.key;
  return e.key.toUpperCase() === domKey.toUpperCase();
}

/** The first id in `ids` whose binding matches `e`, else null. */
export function shortcutFor(e: KeyboardEvent, ids: readonly ShortcutId[]): ShortcutId | null {
  return ids.find((id) => matchesShortcut(id, e)) ?? null;
}
