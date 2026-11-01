// Maps a keydown to the Wails accelerator syntax Go's shell.ParseChord accepts: modifiers in the
// order CmdOrCtrl, Ctrl, Alt, Shift, then the key. A library would not help: nothing records a
// chord in this exact syntax.

const PUNCTUATION: Record<string, string> = {
  Comma: ',',
  Period: '.',
  Slash: '/',
  Semicolon: ';',
  Quote: "'",
  BracketLeft: '[',
  BracketRight: ']',
  Minus: '-',
  Equal: '=',
  Backquote: '`',
};

function keyOf(code: string): string | null {
  const letter = /^Key([A-Z])$/.exec(code);
  if (letter) return letter[1] as string;
  const digit = /^Digit([0-9])$/.exec(code);
  if (digit) return digit[1] as string;
  if (/^F([1-9]|1[0-2])$/.test(code)) return code;
  if (code === 'Space') return 'Space';
  return PUNCTUATION[code] ?? null;
}

type KeyInput = Pick<KeyboardEvent, 'code' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>;

/**
 * The accelerator for a keydown, or null while it is not a complete global chord (a bare modifier,
 * an unsupported key, or no CmdOrCtrl/Ctrl/Alt). `mac` decides what Cmd and Ctrl mean.
 */
export function chordFromEvent(e: KeyInput, mac: boolean): string | null {
  const key = keyOf(e.code);
  if (!key) return null;
  if (e.metaKey && !mac) return null;
  const cmdOrCtrl = mac ? e.metaKey : e.ctrlKey;
  const ctrl = mac && e.ctrlKey;
  if (!cmdOrCtrl && !ctrl && !e.altKey) return null;
  const parts: string[] = [];
  if (cmdOrCtrl) parts.push('CmdOrCtrl');
  if (ctrl) parts.push('Ctrl');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  parts.push(key);
  return parts.join('+');
}
