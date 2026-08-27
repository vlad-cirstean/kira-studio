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
