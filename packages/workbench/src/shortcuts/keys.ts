import { type Binding, type Chord, SHORTCUTS, type ShortcutId } from '@shared/domain/shortcuts';

// Menus build synchronously and AppInfo (bridge/control.ts's appInfo()) is fetched async, so a UA
// sniff beats plumbing a platform bridge through for one boolean that never changes for the
// process's lifetime.
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

// Layout-correct match: `e.key` first, so Dvorak/Colemak follow the printed label. Falls back to
// the physical `e.code` only when `e.key` is not ASCII — macOS composes Option+letter into a symbol
// (⌥⌘C reports `"ç"`), and a non-Latin layout reports its own script.
function domCodeForKey(key: string): string | null {
  if (/^[A-Za-z]$/.test(key)) return `Key${key.toUpperCase()}`;
  if (/^[0-9]$/.test(key)) return `Digit${key}`;
  return null;
}

// `chord.ctrl` (a literal Control, distinct from cmdOrCtrl) only appears on the two
// tab-navigation bindings (shared/domain/shortcuts.ts), which the Go menu accelerator owns, never a
// local keydown handler — so a local match only needs cmdOrCtrl/shift/alt.
function matchesShortcut(id: ShortcutId, e: KeyboardEvent): boolean {
  const chord = resolveChord(id);
  const cmdOrCtrlPressed = isMac ? e.metaKey : e.ctrlKey;
  const otherPlatformModPressed = isMac ? e.ctrlKey : e.metaKey;
  if (Boolean(chord.cmdOrCtrl) !== cmdOrCtrlPressed) return false;
  if (otherPlatformModPressed) return false;
  if (Boolean(chord.shift) !== e.shiftKey) return false;
  if (Boolean(chord.alt) !== e.altKey) return false;
  const domCode = domCodeForKey(chord.key);
  if (domCode) {
    if (/^[A-Za-z0-9]$/.test(e.key)) return e.key.toUpperCase() === chord.key.toUpperCase();
    return e.code === domCode;
  }
  const domKey = DOM_KEY[chord.key] ?? chord.key;
  return e.key.toUpperCase() === domKey.toUpperCase();
}

/** The first id in `ids` whose binding matches `e`, else null. */
export function shortcutFor(e: KeyboardEvent, ids: readonly ShortcutId[]): ShortcutId | null {
  return ids.find((id) => matchesShortcut(id, e)) ?? null;
}
