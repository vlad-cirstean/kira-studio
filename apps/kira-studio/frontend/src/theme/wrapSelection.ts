// Item 5 (task batch P46-2): editor/wrapSelection.ts gives every CodeMirror-backed surface
// (console, cell editor, document editor) "type a bracket/quote over a selection to wrap it, not
// replace it" already. TextField.vue and AutocompleteField.vue's own real <input> (item 2's design
// keeps that element plain and native, never CodeMirror — see its own doc comment) need the same
// behavior spelled out by hand, since there is no CodeMirror instance underneath to do it.
const WRAP_PAIRS: Record<string, string> = {
  '(': ')',
  '[': ']',
  '{': '}',
  "'": "'",
  '"': '"',
  '`': '`',
};

/** Attach as a plain `keydown` listener on a text `<input>`/`<textarea>`. Wraps the current
 *  selection in the typed pair and dispatches a real `input` event (mirrors TextField.vue's own
 *  stepBy(), which does the same for its stepper buttons) so a v-model/`@input` caller sees the
 *  change exactly as if the browser had inserted it. A collapsed selection (the common case — no
 *  text selected) is left alone entirely, falling through to the browser's own plain insert. */
export function wrapSelectionOnType(e: KeyboardEvent): void {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const close = WRAP_PAIRS[e.key];
  if (!close) return;
  const el = e.target;
  if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) return;
  const start = el.selectionStart;
  const end = el.selectionEnd;
  if (start === null || end === null || start === end) return;
  // A whole-field selection (Select All, then retype) is a "replace everything" gesture, not a
  // "wrap everything" one — see editor/wrapSelection.ts's own identical guard and its doc comment
  // for the real regression (mongo.spec.ts's document-body edit flow) this avoids repeating here.
  if (start === 0 && end === el.value.length) return;

  e.preventDefault();
  const value = el.value;
  el.value = `${value.slice(0, start)}${e.key}${value.slice(start, end)}${close}${value.slice(end)}`;
  el.selectionStart = start + 1;
  el.selectionEnd = end + 1;
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

// P15b D5(b): every close character this pair table can produce — a quote is its own closer too
// (WRAP_PAIRS['\''] === '\''), so this Set has one entry per distinct closing character regardless
// of how many opening keys map to it.
const CLOSERS = new Set(Object.values(WRAP_PAIRS));

/** Attach as a plain `keydown` listener (alongside `wrapSelectionOnType`, never instead of it — a
 *  non-empty selection wraps, a collapsed caret auto-closes, and the two can never both fire for
 *  one keystroke) on a text `<input>`/`<textarea>`. Three rules, none needing remembered state —
 *  each is decided purely from the text immediately around the caret, so paste/undo can never
 *  leave this somewhere it doesn't understand:
 *
 *  1. a collapsed caret plus a typed opening char inserts the pair, caret left between them;
 *  2. typing a closing char immediately before an identical one already there steps over it
 *     instead of inserting a second (`{}` then `}` → `{}`, caret after — checked *before* rule 1,
 *     since a quote is both an opener and its own closer);
 *  3. Backspace with the caret between an empty pair (`{|}`) deletes both in one keystroke.
 *
 *  `e.isComposing` bails out — a CJK/IME composition keydown must never be mistaken for a literal
 *  bracket/quote keystroke (not exercised by this sandbox's tests; recorded, not claimed, per the
 *  plan's own §4). */
export function autoClosePairsOnType(e: KeyboardEvent): void {
  if (e.metaKey || e.ctrlKey || e.altKey || e.isComposing) return;
  const el = e.target;
  if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) return;
  const start = el.selectionStart;
  const end = el.selectionEnd;
  // Every rule below is a collapsed-caret rule — a real (non-empty) selection is wrapSelectionOnType's
  // own territory, never this function's.
  if (start === null || end === null || start !== end) return;

  if (e.key === 'Backspace') {
    if (start === 0) return;
    const before = el.value[start - 1];
    const after = el.value[start];
    if (WRAP_PAIRS[before] !== after) return;
    e.preventDefault();
    const value = el.value;
    el.value = value.slice(0, start - 1) + value.slice(start + 1);
    el.selectionStart = start - 1;
    el.selectionEnd = start - 1;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return;
  }

  if (CLOSERS.has(e.key) && el.value[start] === e.key) {
    // The value itself is unchanged — only the caret moves past the character already there — so
    // no 'input' event fires, matching what a real "step over" keystroke does to a v-model.
    e.preventDefault();
    el.selectionStart = start + 1;
    el.selectionEnd = start + 1;
    return;
  }

  const close = WRAP_PAIRS[e.key];
  if (!close) return;
  e.preventDefault();
  const value = el.value;
  el.value = `${value.slice(0, start)}${e.key}${close}${value.slice(start)}`;
  el.selectionStart = start + 1;
  el.selectionEnd = start + 1;
  el.dispatchEvent(new Event('input', { bubbles: true }));
}
