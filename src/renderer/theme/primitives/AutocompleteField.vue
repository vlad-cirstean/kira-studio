<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import CodeMirrorHost from '../../editor/CodeMirrorHost.vue';
import type { EditorLanguageId } from '../../editor/languages';
import type { SqlDialect } from '../../views/shared/sqlIdent';
import CodiconIcon from '../CodiconIcon.vue';
import { wrapSelectionOnType } from '../wrapSelection';
import { type Completion, MAX_VISIBLE, rankCandidates, tokenAt } from './completion';

// Mirrors TextField.vue's own inheritAttrs:false — data-testid and friends belong on the real
// <input>, not on the wrapping <span class="p-input">.
defineOptions({ inheritAttrs: false });

// P18: identifier/keyword autocomplete for a filter surface's free-text input (SQL's WHERE/ORDER
// BY, Mongo's filter/sort) — a drop-in TextField look-alike (same .p-input box, same
// v-model/prefix/placeholder/invalid contract, same enter/blur events) rather than a wrapper
// around TextField itself. Verified against the pinned vue@3.5.41 sources before choosing this
// shape (docs/v1/plans/P18-autocomplete.md §1): TextField spreads $attrs onto its <input> *before*
// its own inline handlers, so a caller's keydown listener always runs first in Vue's merged-array
// invoker and can only suppress TextField's own `enter` emit via three undocumented internals
// (attrs-before-handlers ordering, array-concat merge order, the array invoker's private
// stop-propagation flag) — and that still wouldn't reach DocumentView.vue's `@keyup.enter`, a
// *keyup*-time fallthrough attr a keydown-time preventDefault can never intercept. A completion
// popup also needs the <input> element itself (selectionStart/setSelectionRange/
// getBoundingClientRect), which TextField never exposes. Owning the one <input> here keeps
// accept-vs-apply an explicit, testable branch in one place instead of resting on Vue internals.
const props = withDefaults(
  defineProps<{
    modelValue: string;
    candidates: Completion[];
    prefix?: string;
    placeholder?: string;
    invalid?: boolean;
    /** Item 2: a read-only CodeMirrorHost, stacked behind this field's own (still fully in
     *  charge) `<input>`, painting the same text through the query console's own SQL/Mongo
     *  grammar and colours (kiraHighlightStyle) — `undefined`/`'plain'` keeps today's unstyled
     *  look. Never the interactive surface itself: switching this field over to CodeMirror
     *  outright would trade its own hand-rolled completion popup for CodeMirror's, and — the
     *  actual blocker — break every existing `locator.fill()` call across the SQL/Mongo engine
     *  specs, which only works on a real `<input>`/`<textarea>`/`[contenteditable]` element, not a
     *  wrapper div around one. */
    language?: EditorLanguageId;
    /** Only consulted when `language === 'sql'`, forwarded to CodeMirrorHost unchanged. */
    sqlDialect?: SqlDialect;
  }>(),
  { candidates: () => [] },
);

const highlighted = computed(() => !!props.language && props.language !== 'plain');

const emit = defineEmits<{
  'update:modelValue': [value: string];
  enter: [];
  escape: [];
  blur: [event: FocusEvent];
  /** Fired after a suggestion is inserted, so a caller can re-run its own parser/validator. */
  accept: [completion: Completion];
}>();

const listId = `ac-${Math.random().toString(36).slice(2)}`;

const inputRef = ref<HTMLInputElement | null>(null);
const open = ref(false);
const activeIndex = ref(0);
const wordStart = ref(0);
const currentWord = ref('');
// Ctrl+Space (D4): lists every candidate regardless of the token under the caret, capped the same
// as a normal prefix match — distinct from the ordinary "matches what's typed" path below.
const forceAll = ref(false);
const listStyle = ref<{ top: string; left: string } | null>(null);
// Enter only accepts a suggestion once the user has explicitly arrowed onto one — otherwise a
// bare "finish typing, hit Enter to submit" (this box's contract since P2/P8) would get silently
// hijacked whenever the trailing word happens to substring-match a candidate (e.g. typing
// "...IS NOT NULL" in a WHERE box and hitting Enter would accept "IS NULL" instead of running the
// filter). Tab always accepts the current (possibly un-navigated) top match — that's the one
// explicit "complete this" key with no competing submit meaning.
const hasNavigated = ref(false);
// Keys onKeydown already special-cases while the dropdown is open — their keyup must not re-run
// recompute() (it would reset activeIndex/hasNavigated right back after onKeydown just set them,
// since none of these keys actually move the text cursor).
const NAV_KEYS = new Set(['ArrowUp', 'ArrowDown', 'Enter', 'Tab', 'Escape']);

const filtered = computed(() =>
  forceAll.value
    ? props.candidates.slice(0, MAX_VISIBLE)
    : rankCandidates(props.candidates, currentWord.value),
);

function recompute(el: HTMLInputElement): void {
  const cursor = el.selectionStart ?? el.value.length;
  const token = tokenAt(el.value, cursor);
  wordStart.value = token.from;
  currentWord.value = token.word;
  activeIndex.value = 0;
  hasNavigated.value = false;
}

// D3: a `position: fixed` list positioned from the input's own rect, not Teleported and not
// anchored via CSS (`position: absolute` relative to this field) — a toolbar row is exactly the
// kind of fixed-height, easily-overflow-clipped ancestor task #58 already ran into with
// PopoverPanel.vue, and `fixed` sidesteps that regardless of what any ancestor's `overflow` says.
function positionList(): void {
  const el = inputRef.value;
  if (!el) return;
  const rect = el.getBoundingClientRect();
  listStyle.value = { top: `${rect.bottom + 4}px`, left: `${rect.left}px` };
}

function onInput(e: Event): void {
  const el = e.target as HTMLInputElement;
  emit('update:modelValue', el.value);
  forceAll.value = false;
  recompute(el);
  open.value = currentWord.value.length > 0 && filtered.value.length > 0;
  if (open.value) positionList();
}

// Cursor-move-only events (click, arrow-left/right, Home/End with no text change) still need the
// suggestion window to track wherever the cursor lands, or a click into an earlier word would
// keep suggesting whatever was typed last. Excludes the nav keys onKeydown already handles below
// (NAV_KEYS) — those never move the text cursor and must not stomp the activeIndex/hasNavigated
// state onKeydown just set.
function onClick(e: Event): void {
  if (!open.value) return;
  recompute(e.target as HTMLInputElement);
  positionList();
}
function onKeyup(e: KeyboardEvent): void {
  if (!open.value || NAV_KEYS.has(e.key)) return;
  recompute(e.target as HTMLInputElement);
}

function accept(completion: Completion): void {
  const el = inputRef.value;
  if (!el) return;
  const insertText = completion.insert ?? completion.label;
  const cursor = el.selectionStart ?? el.value.length;
  const next = `${el.value.slice(0, wordStart.value)}${insertText}${el.value.slice(cursor)}`;
  emit('update:modelValue', next);
  emit('accept', completion);
  open.value = false;
  forceAll.value = false;
  void nextTick(() => {
    const pos = wordStart.value + insertText.length - (completion.caretOffsetFromEnd ?? 0);
    el.setSelectionRange(pos, pos);
    el.focus();
  });
}

function onKeydown(e: KeyboardEvent): void {
  // Item 5: a bracket/quote typed over a selection wraps it (wrapSelection.ts) rather than
  // running through the completion machinery below — onInput's own listener picks up the
  // synthetic 'input' event this dispatches, same as any other edit.
  const before = (e.target as HTMLInputElement).value;
  wrapSelectionOnType(e);
  if ((e.target as HTMLInputElement).value !== before) return;
  // Ctrl+Space / Cmd+Space: explicit "show me everything", matching completionKeymap's own
  // binding (docs/v1/plans/P18-autocomplete.md realities #8) so the console and these plain fields
  // share one muscle memory.
  if (e.key === ' ' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    recompute(e.target as HTMLInputElement);
    forceAll.value = true;
    open.value = filtered.value.length > 0;
    if (open.value) positionList();
    return;
  }
  if (open.value && filtered.value.length > 0) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      hasNavigated.value = true;
      activeIndex.value = Math.min(filtered.value.length - 1, activeIndex.value + 1);
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      hasNavigated.value = true;
      activeIndex.value = Math.max(0, activeIndex.value - 1);
      return;
    }
    if (e.key === 'Tab' || (e.key === 'Enter' && hasNavigated.value)) {
      e.preventDefault();
      accept(filtered.value[activeIndex.value]);
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      open.value = false;
      forceAll.value = false;
      return;
    }
  }
  if (e.key === 'Enter') {
    open.value = false;
    emit('enter');
  } else if (e.key === 'Escape') emit('escape');
}

// The overlay is `pointer-events: none` (purely paint, see the template) and never scrolls on its
// own — it has no scrollbar and the user can never focus it to drag one. A native text `<input>`
// fires its own 'scroll' event as its internal text pans to keep the caret in view once the value
// overflows the box; mirroring that onto the overlay's `.cm-scroller` (still `overflow: hidden`,
// which honours a programmatic scrollLeft same as any other overflow value) keeps the coloured
// text panned to the exact same offset as the invisible real text sitting on top of it.
const overlayRootRef = ref<HTMLElement | null>(null);
function onInputScroll(e: Event): void {
  const scroller = overlayRootRef.value?.querySelector<HTMLElement>('.cm-scroller');
  if (scroller) scroller.scrollLeft = (e.target as HTMLInputElement).scrollLeft;
}

function onBlur(e: FocusEvent): void {
  // A click on a suggestion fires this blur first (mousedown steals focus before the click
  // handler runs) — closing here first would make the click land on nothing. The suggestion
  // list's own @mousedown.prevent (below) keeps focus on the input instead, so this only ever
  // fires for a genuine "left the field" blur.
  open.value = false;
  forceAll.value = false;
  emit('blur', e);
}

// D3: closes on window resize/scroll rather than re-following the input — a scroll or resize
// mid-selection is rare enough that a stale-then-gone popup is fine, and it avoids a
// scroll-listener-driven reposition loop for what is, in every current use, a single-line toolbar
// input that never itself scrolls.
function closeOnViewportChange(): void {
  if (!open.value) return;
  open.value = false;
  forceAll.value = false;
}
onMounted(() => {
  window.addEventListener('resize', closeOnViewportChange);
  window.addEventListener('scroll', closeOnViewportChange, true);
});
onBeforeUnmount(() => {
  window.removeEventListener('resize', closeOnViewportChange);
  window.removeEventListener('scroll', closeOnViewportChange, true);
});
</script>

<template>
  <span
    class="p-input autocomplete-field"
    :class="{ 'is-invalid': invalid }"
  >
    <span v-if="prefix" class="ph">{{ prefix }}</span>
    <span class="input-wrap">
      <!-- Paint-only: see `language`'s own doc comment above for why this is a second element
           behind the real input rather than the input itself. `key` remounts it on a language
           change (there are only ever two call sites today, each fixed to one language for its
           whole lifetime, so this never actually fires — cheap insurance all the same). The
           surrounding div (not the component itself) is what `overlayRootRef` needs to be an
           actual DOM node `.querySelector` can walk — a `ref` on <CodeMirrorHost> would resolve to
           its exposed `{ focus }` object instead (defineExpose), not its root element. -->
      <div v-if="highlighted" ref="overlayRootRef" class="highlight-overlay" aria-hidden="true">
        <CodeMirrorHost
          :key="language"
          :doc="modelValue"
          :language="language ?? 'plain'"
          :sql-dialect="sqlDialect"
          :read-only="true"
          single-line
        />
      </div>
      <input
        ref="inputRef"
        v-bind="$attrs"
        :value="modelValue"
        :placeholder="placeholder"
        :class="{ 'has-overlay': highlighted }"
        autocomplete="off"
        spellcheck="false"
        role="combobox"
        aria-autocomplete="list"
        :aria-expanded="open"
        :aria-controls="listId"
        :aria-activedescendant="open && filtered[activeIndex] ? `${listId}-${activeIndex}` : undefined"
        @input="onInput"
        @click="onClick"
        @keyup="onKeyup"
        @keydown="onKeydown"
        @blur="onBlur"
        @scroll="onInputScroll"
      />
    </span>
  </span>
  <ul
    v-if="open && filtered.length > 0"
    :id="listId"
    class="autocomplete-suggestions p-float"
    role="listbox"
    :style="listStyle ?? undefined"
    @mousedown.prevent
  >
    <li
      v-for="(c, i) in filtered"
      :id="`${listId}-${i}`"
      :key="c.label"
      role="option"
      :aria-selected="i === activeIndex"
      :class="{ 'is-active': i === activeIndex }"
      @mouseenter="activeIndex = i"
      @mousedown.prevent="accept(c)"
    >
      <CodiconIcon v-if="c.icon" :name="c.icon" :size="13" class="sugg-icon" />
      <span class="sugg-label">{{ c.label }}</span>
      <span v-if="c.detail" class="sugg-detail">{{ c.detail }}</span>
    </li>
  </ul>
</template>

<style scoped>
.autocomplete-field {
  position: relative;
}

.input-wrap {
  position: relative;
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
}

/* Paint-only and never scrolled by the user directly (see onInputScroll) — sized/positioned to
   sit exactly under the real `<input>` next to it, not the whole `.p-input` box (which may also
   carry a `prefix` span ahead of this wrapper). `kira-font-family` is a monospace stack
   (tokens.css), so the overlay's character grid lines up with the native input's own
   character-for-character regardless of which of the two engines is laying out any given glyph —
   the one property this trick actually depends on. */
.highlight-overlay {
  position: absolute;
  inset: 0;
  pointer-events: none;
  overflow: hidden;
  /* `.cm-editor` sizes to its one line of content (CodeMirrorHost's own singleLine CSS), not to
     this inset:0 box — centering it here is what lines its text up with the native input's own
     vertically-centered line box (`.input-wrap`'s own align-items: center) regardless of the
     current font-size setting. */
  display: flex;
  align-items: center;
}

.highlight-overlay :deep(.cm-editor) {
  width: 100%;
  background: transparent !important;
}

.highlight-overlay :deep(.cm-scroller) {
  font-family: var(--kira-font-family) !important;
  font-size: var(--kira-t-sm) !important;
  line-height: normal !important;
  background: transparent !important;
}

.highlight-overlay :deep(.cm-content) {
  caret-color: transparent;
}

/* The real input stays the only interactive/focusable/selectable element — its own text is
   painted transparent so only the overlay's coloured glyphs underneath show through, while its
   native caret (caret-color, unaffected by `color`) and selection painting keep working exactly
   as before. Only applied when an overlay actually exists (`highlighted`) — every other field
   using this component keeps today's plain look untouched. */
.input-wrap input.has-overlay {
  position: relative;
  z-index: 1;
  color: transparent;
  caret-color: var(--kira-fg);
}

.autocomplete-suggestions {
  position: fixed;
  z-index: 200;
  min-width: 200px;
  max-width: min(480px, 90vw);
  max-height: 240px;
  overflow-y: auto;
  padding: var(--kira-s-1);
  list-style: none;
  margin: 0;
}

.autocomplete-suggestions li {
  display: flex;
  align-items: center;
  gap: var(--kira-s-2);
  padding: var(--kira-s-2) var(--kira-s-3);
  border-radius: var(--kira-radius-sm);
  font-size: var(--kira-t-sm);
  cursor: pointer;
  white-space: nowrap;
}

.autocomplete-suggestions li.is-active {
  background: var(--kira-select);
  color: var(--kira-fg);
}

.sugg-icon {
  flex-shrink: 0;
  color: var(--kira-fg-muted);
}

.sugg-label {
  overflow: hidden;
  text-overflow: ellipsis;
}

.sugg-detail {
  margin-left: auto;
  padding-left: var(--kira-s-3);
  color: var(--kira-fg-muted);
  font-size: var(--kira-t-xs);
  flex-shrink: 0;
}
</style>
