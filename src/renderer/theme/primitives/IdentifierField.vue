<script setup lang="ts">
import { computed, nextTick, ref } from 'vue';

// Mirrors TextField.vue's own inheritAttrs:false — data-testid and friends belong on the real
// <input>, not on the wrapping <span class="p-input">.
defineOptions({ inheritAttrs: false });

// P18: identifier autocomplete for a filter surface's free-text input (SQL's WHERE/ORDER BY,
// Mongo's filter/sort) — a drop-in TextField look-alike (same .p-input box, same
// v-model/prefix/placeholder/invalid contract, same enter/blur events) rather than a wrapper
// around TextField itself: accepting a suggestion and applying the filter both key off Enter, and
// the two need to disagree about what a bare Enter does depending on whether the suggestion list
// is open — juggling that split across two components each with their own @keydown.enter would
// leave the outcome to Vue's same-element multi-listener merge order (attrs-forwarded vs.
// template-inline), which is not a well-defined enough contract to hang correctness on. Owning
// the one <input> here keeps the decision in one place instead.
const props = withDefaults(
  defineProps<{
    modelValue: string;
    candidates: string[];
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
}>();

const inputRef = ref<HTMLInputElement | null>(null);
const open = ref(false);
const activeIndex = ref(0);
const query = ref('');
const wordStart = ref(0);
// Enter only accepts a suggestion once the user has explicitly arrowed onto one — otherwise a
// bare "finish typing, hit Enter to submit" (WHERE/ORDER BY's own contract) would get silently
// hijacked whenever the trailing word happens to substring-match a candidate (e.g. typing
// "...IS NOT NULL" and hitting Enter would accept "IS NULL" instead of running the filter). Tab
// always accepts the current (possibly un-navigated) top match — that's the one explicit
// "complete this" key with no competing submit meaning.
const hasNavigated = ref(false);
// Keys onKeydown already special-cases while the dropdown is open — their keyup must not re-run
// recomputeSuggestions (it would reset activeIndex/hasNavigated right back after onKeydown just
// set them, since none of these keys actually move the text cursor).
const NAV_KEYS = new Set(['ArrowUp', 'ArrowDown', 'Enter', 'Tab', 'Escape']);

// A "word" ends at any of: whitespace, SQL/Mongo punctuation that never appears inside a bare
// identifier. Good enough for suggesting the identifier someone is mid-way through typing without
// attempting a real tokenizer for either language.
const BOUNDARY_RE = /[\s()=<>!,:{}[\]'"]/;

function wordBefore(value: string, cursor: number): { start: number; text: string } {
  let start = cursor;
  while (start > 0 && !BOUNDARY_RE.test(value[start - 1])) start--;
  return { start, text: value.slice(start, cursor) };
}

const filtered = computed(() => {
  const q = query.value.toLowerCase();
  if (!q) return [];
  // Prefix matches first, then anywhere-matches — a prefix match is almost always what someone
  // typing the start of a column/field name wants to see ranked first.
  const starts: string[] = [];
  const contains: string[] = [];
  for (const c of props.candidates) {
    const lower = c.toLowerCase();
    if (lower === q) continue; // already typed in full — nothing to suggest
    if (lower.startsWith(q)) starts.push(c);
    else if (lower.includes(q)) contains.push(c);
  }
  return [...starts, ...contains].slice(0, 8);
});

function recomputeSuggestions(el: HTMLInputElement): void {
  const cursor = el.selectionStart ?? el.value.length;
  const word = wordBefore(el.value, cursor);
  wordStart.value = word.start;
  query.value = word.text;
  activeIndex.value = 0;
  hasNavigated.value = false;
}

function onInput(e: Event): void {
  const el = e.target as HTMLInputElement;
  emit('update:modelValue', el.value);
  recomputeSuggestions(el);
  open.value = query.value.length > 0;
}

// Cursor-move-only events (click, arrow-left/right, Home/End with no text change) still need the
// suggestion window to track wherever the cursor lands, or a click into an earlier word would
// keep suggesting whatever was typed last. Excludes the nav keys onKeydown already handles above
// (see NAV_KEYS) — those never move the text cursor and must not stomp the activeIndex/
// hasNavigated state onKeydown just set.
function onClick(e: Event): void {
  if (!open.value) return;
  recomputeSuggestions(e.target as HTMLInputElement);
}
function onKeyup(e: KeyboardEvent): void {
  if (!open.value || NAV_KEYS.has(e.key)) return;
  recomputeSuggestions(e.target as HTMLInputElement);
}

function accept(candidate: string): void {
  const el = inputRef.value;
  if (!el) return;
  const cursor = el.selectionStart ?? el.value.length;
  const next = `${el.value.slice(0, wordStart.value)}${candidate}${el.value.slice(cursor)}`;
  emit('update:modelValue', next);
  open.value = false;
  void nextTick(() => {
    const pos = wordStart.value + candidate.length;
    el.setSelectionRange(pos, pos);
    el.focus();
  });
}

function onKeydown(e: KeyboardEvent): void {
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
  emit('blur', e);
}
</script>

<template>
  <span
    class="p-input identifier-field"
    :class="{ 'is-invalid': invalid }"
    :style="invalid ? { borderColor: 'var(--kira-error)' } : undefined"
  >
    <span v-if="prefix" class="ph">{{ prefix }}</span>
    <input
      ref="inputRef"
      v-bind="$attrs"
      :value="modelValue"
      :placeholder="placeholder"
      autocomplete="off"
      spellcheck="false"
      @input="onInput"
      @click="onClick"
      @keyup="onKeyup"
      @keydown="onKeydown"
      @blur="onBlur"
    />
    <ul v-if="open && filtered.length > 0" class="suggestions p-float" @mousedown.prevent>
      <li
        v-for="(candidate, i) in filtered"
        :key="candidate"
        :class="{ 'is-active': i === activeIndex }"
        @mouseenter="activeIndex = i"
        @click="accept(candidate)"
      >
        {{ candidate }}
      </li>
    </ul>
  </span>
</template>

<style scoped>
.identifier-field {
  position: relative;
}

.suggestions {
  position: absolute;
  top: calc(100% + var(--kira-s-1));
  left: 0;
  z-index: 20;
  min-width: 160px;
  max-height: 200px;
  overflow-y: auto;
  padding: var(--kira-s-1);
  list-style: none;
  margin: 0;
}

.suggestions li {
  padding: var(--kira-s-2) var(--kira-s-3);
  border-radius: var(--kira-radius-sm);
  font-size: var(--kira-t-sm);
  cursor: pointer;
  white-space: nowrap;
}

.suggestions li.is-active {
  background: var(--kira-select);
  color: var(--kira-fg);
}
</style>
