// P18: pure helpers behind AutocompleteField.vue — no Vue, so they're trivial to reason about (and
// test) independently of the component's DOM/event wiring.

/** One suggestion. `insert` defaults to `label` — they differ when the label is the
 *  human-readable name and the insertion needs quoting (grid/filterCompletion.ts) or a trailing
 *  token (documents/filterCompletion.ts's `field: `). */
export interface Completion {
  label: string;
  insert?: string;
  /** Right-aligned dim text: a column's dataType, or "keyword" / "operator". Never required. */
  detail?: string;
  /** A codicon name (`symbol-field`, `symbol-keyword`, `symbol-operator`) — the same set
   *  `theme/icons.ts` already draws from. */
  icon?: string;
  /** How many characters from the end of `insert` (or `label`) the caret lands after acceptance —
   *  0 (the default) means "at the very end". A BSON constructor completion (P27 D17) inserts
   *  `ObjectId('')` with this set to 2, landing the caret between the quotes rather than after
   *  the closing paren. */
  caretOffsetFromEnd?: number;
}

// The run of identifier-ish characters ending at the caret: covers a bare SQL column (`stat`), a
// Mongo `$`-operator token (`$g`), and a dotted/quoted-free path segment alike. One rule serves
// every surface this primitive is used from.
const WORD_CHAR_RE = /[A-Za-z0-9_$.]/;

export function tokenAt(text: string, caret: number): { from: number; to: number; word: string } {
  let from = caret;
  while (from > 0 && WORD_CHAR_RE.test(text[from - 1])) from--;
  return { from, to: caret, word: text.slice(from, caret) };
}

// A wider list is a scrollbar nobody reads — also the cap Ctrl+Space's "list everything" applies.
export const MAX_VISIBLE = 12;

// Case-insensitive: exact-prefix matches first (stable within the group, i.e. in candidate-list
// order), then substring matches — a prefix match is almost always what someone typing the start
// of an identifier wants to see ranked first.
export function rankCandidates(candidates: Completion[], word: string): Completion[] {
  const w = word.toLowerCase();
  if (!w) return [];
  const starts: Completion[] = [];
  const contains: Completion[] = [];
  for (const c of candidates) {
    const label = c.label.toLowerCase();
    if (label === w) continue; // already typed in full — nothing to suggest
    if (label.startsWith(w)) starts.push(c);
    else if (label.includes(w)) contains.push(c);
  }
  return [...starts, ...contains].slice(0, MAX_VISIBLE);
}
