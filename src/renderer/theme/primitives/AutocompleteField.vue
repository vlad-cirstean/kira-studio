<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import CodiconIcon from '../CodiconIcon.vue';
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
  }>(),
  { candidates: () => [] },
);

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
    const pos = wordStart.value + insertText.length;
    el.setSelectionRange(pos, pos);
    el.focus();
  });
}

function onKeydown(e: KeyboardEvent): void {
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
    <input
      ref="inputRef"
      v-bind="$attrs"
      :value="modelValue"
      :placeholder="placeholder"
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
    />
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
