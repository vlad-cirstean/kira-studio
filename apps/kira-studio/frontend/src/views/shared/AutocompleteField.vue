<script setup lang="ts">
import type { EditorLanguageId } from '@shared/domain/editor';
import CodiconIcon from '@theme/CodiconIcon.vue';
import { autoClosePairsOnType, wrapSelectionOnType } from '@theme/wrapSelection';
import { useEventListener, useTimeoutFn } from '@vueuse/core';
import { loadMonaco, type MonacoModule } from '@workbench/editor/monaco';
import { computeFloatPosition, pointReference } from '@workbench/util/floatingPosition';
import { AutocompleteRoot, ComboboxAnchor, ComboboxContent, ComboboxItem, ComboboxPortal, ComboboxViewport } from 'reka-ui';
import { computed, nextTick, onMounted, ref, shallowRef, watch } from 'vue';
import { monacoLanguageIdFor } from '../../editor/monacoLanguages';
import { overlayOffsetAtPoint, paintOverlayHtml } from '../../editor/paintSpans';
import type { RangeHighlight } from '../../editor/ranges';
import { type Completion, MAX_VISIBLE, rankCandidates, tokenAt } from '../../theme/completion';
import type { SqlDialect } from './sqlIdent';

// Mirrors TextField.vue's own inheritAttrs:false — data-testid and friends belong on the real
// <input>, not on the wrapping <span class="p-input">.
defineOptions({ inheritAttrs: false });

// reka's `ListboxRoot` (which underlies `AutocompleteRoot`/`Combobox*`) `watch`es `modelValue`
// (`immediate: true, deep: true`) and calls `highlightSelected()` on every change — every
// keystroke here, since this field's `modelValue` is its raw text, not a "committed selection".
// `highlightSelected` -> `changeHighlight` then really `.focus()`s the first (or previously
// highlighted) suggestion `<li>` whenever `scroll` isn't explicitly `false` (reka-ui 2.10.5's own
// source: `node_modules/reka-ui/dist/Listbox/ListboxRoot.js`), which is the case for every
// keystroke after the first. No public prop suppresses it — `changeHighlight`'s own `focusable`
// ref is never exposed. `onBlur` below is this field's fix: reclaim focus synchronously,
// in-tick, whenever a blur's `relatedTarget` lands inside this popup — matching this field's
// whole contract, that the real <input>/<textarea> keeps DOM focus throughout, with
// `activeIndex` alone driving which suggestion looks current.

// P104 §3.2: the reka `AutocompleteRoot`/`Combobox*` swap for the old hand-rolled autocomplete
// field — a Stream B-owned sibling rather than an edit to that file, since one of its 7 call
// sites (DocumentView.vue) is Stream A territory. Keeps every behaviour the old file's own
// header comment named as having no combobox equivalent (a real
// <input>/<textarea> for Playwright's `locator.fill()` and keydown-time enter interception, the
// Monaco paint overlay, the pointer-hit-tested hover panel) entirely unchanged — this file still
// owns the real element and its own keyboard model. reka supplies only what it actually has an
// equivalent for: `AutocompleteRoot`/`Combobox*` own the floating-list's Popper positioning
// (`ComboboxContent position="popper"`) and portal/dismiss-outside, replacing the old hand-rolled
// `getBoundingClientRect`-based `position: fixed` calc. `ignore-filter` + `highlight-on-hover:false`
// keep reka's own text-filter/hover-highlight machinery inert — `filtered`/`activeIndex` below stay
// the single source of truth for which candidates render and which one is current, unchanged from
// the original. No `AutocompleteInput`/`ListboxFilter`: both unconditionally `preventDefault()`
// every ArrowUp/Down/Home/End keydown regardless of open state (verified against reka-ui 2.10.5's
// own source), which would break a `grow` textarea's native up/down line-cursor movement while the
// popup is closed — a real requirement no wrapper input meets, so this field keeps driving its own
// `<input>`/`<textarea>` keydown handler exactly as before.

// P18: identifier/keyword autocomplete for a filter surface's free-text input (SQL's WHERE/ORDER
// BY, Mongo's filter/sort) — a drop-in TextField look-alike (same .p-input box, same
// v-model/prefix/placeholder/invalid contract, same enter/blur events) rather than a wrapper
// around TextField itself. A completion popup also needs the <input> element itself
// (selectionStart/setSelectionRange/getBoundingClientRect), which TextField never exposes. Owning
// the one <input> here keeps accept-vs-apply an explicit, testable branch in one place.
const props = withDefaults(
  defineProps<{
    modelValue: string;
    /** A plain array for a static candidate list (every call site but the URL/header fields'
     *  `{{...}}` completion), or a function of the current token's context for a list that depends
     *  on *where* the caret is — `variableSupport` (variableCompletion.ts) returns the six
     *  transforms after a `|` and the variable/dynamic names before one. `text` is the field's own
     *  full value, `from`/`word` are `tokenAt`'s own current token. */
    candidates:
      | readonly Completion[]
      | ((ctx: { text: string; from: number; word: string }) => readonly Completion[]);
    prefix?: string;
    /** Lights the prefix label up in `--kira-accent` instead of the default disabled grey — set by
     * a filter/sort field's caller when the underlying (applied, not just typed) value is set.
     * Unrelated to `active` on IconButton/AppButton (that means "toggled open"). */
    prefixActive?: boolean;
    placeholder?: string;
    invalid?: boolean;
    /** A read-only, paint-only overlay stacked behind this field's own (still fully in charge)
     *  `<input>`, painting the same text through Monaco's own tokenizer and the app's `kira-editor`
     *  theme colours — `undefined`/`'plain'` keeps today's unstyled look. Never a real editor
     *  instance and never the interactive surface itself — the actual blocker for either is the
     *  same: it would break every existing `locator.fill()` call across the SQL/Mongo engine specs,
     *  which only works on a real `<input>`/`<textarea>`/`[contenteditable]` element, not a wrapper
     *  div around one. */
    language?: EditorLanguageId;
    /** Monaco's built-in `sql` Monarch has no per-dialect keyword set (MonacoHost.vue's own
     *  `sqlDialect` prop carries the identical limitation). Kept for call-site compatibility. */
    sqlDialect?: SqlDialect;
    /** Painted onto the overlay verbatim — a field with no *grammar* (no `language`) still gets the
     *  read-only overlay when it has *ranges* to paint (the URL and header/param value fields'
     *  `{{variable}}` colouring). */
    rangeHighlights?: (doc: string) => readonly RangeHighlight[];
    /** Overrides the default word-run tokenizer (`completion.ts`'s own `tokenAt`) —
     *  `wholeFieldToken` for a field holding exactly one identifier (a header name), `templateToken`
     *  for `{{variable}}` completion. A `null` result clears the current word and closes the popup,
     *  so a variable field only suggests while the caret is actually inside `{{…}}`. */
    tokenAt?: (text: string, caret: number) => { from: number; to: number; word: string } | null;
    /** A pure text-in lookup for the token under the pointer — absent by default, which is every
     *  call site but the URL/header-value fields' hover. No hover machinery (listener, timer,
     *  panel) exists at all when this is absent. */
    hoverAt?: (text: string, offset: number) => string[] | null;
    /** TextField.vue's own opt-in 4-row auto-grow — the control becomes a `<textarea>`. Off by
     *  default: every existing call site renders byte-identically. */
    grow?: boolean;
  }>(),
  { candidates: () => [] },
);

const highlighted = computed(() => !!props.language && props.language !== 'plain');
// The overlay's own render condition — a grammar (`highlighted`) or ranges to paint, either is
// reason enough for the paint-only overlay to exist behind the real input.
const showOverlay = computed(() => highlighted.value || !!props.rangeHighlights);

// Monaco is loaded lazily and shared (`loadMonaco()` is memoised app-wide) — a filter field on a
// fresh session pulls the chunk the first time any editor surface does, not before. Until it
// resolves the overlay repaints as plain, unstyled text (paintOverlayHtml's own `mod`-less early
// exit below), the same graceful degradation MonacoHost.vue's own pending state uses.
const monacoMod = shallowRef<MonacoModule | null>(null);
onMounted(() => {
  void loadMonaco().then((mod) => {
    monacoMod.value = mod;
  });
});

function escapePlain(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const overlayHtml = ref('');
let paintGeneration = 0;
async function repaintOverlay(): Promise<void> {
  if (!showOverlay.value) {
    overlayHtml.value = '';
    return;
  }
  const text = props.modelValue;
  const mod = monacoMod.value;
  if (!mod) {
    overlayHtml.value = escapePlain(text);
    return;
  }
  const languageId = monacoLanguageIdFor(props.language ?? 'plain');
  const ranges = props.rangeHighlights ? props.rangeHighlights(text) : [];
  // A generation counter, not a debounce — two paints can be in flight (a fast retype outrunning
  // colorize()'s own async grammar load) and only the one started last is allowed to win.
  const generation = ++paintGeneration;
  const html = await paintOverlayHtml(mod, text, languageId, ranges);
  if (generation !== paintGeneration) return;
  overlayHtml.value = html;
}
watch(
  () => [props.modelValue, props.language, props.rangeHighlights, monacoMod.value] as const,
  () => void repaintOverlay(),
  { immediate: true },
);

const emit = defineEmits<{
  'update:modelValue': [value: string];
  enter: [];
  escape: [];
  blur: [event: FocusEvent];
  /** Fired after a suggestion is inserted, so a caller can re-run its own parser/validator. */
  accept: [completion: Completion];
  /** The pasted text, plus its own event so a host can `preventDefault()` and handle the paste
   *  itself. Unhandled (no listener, or one that does not preventDefault) the paste proceeds
   *  exactly as before. */
  pasteText: [text: string, event: ClipboardEvent];
}>();

function onPaste(e: ClipboardEvent): void {
  const text = e.clipboardData?.getData('text') ?? '';
  if (text !== '') emit('pasteText', text, e);
}

const listId = `ac-${Math.random().toString(36).slice(2)}`;

const inputRef = ref<HTMLInputElement | HTMLTextAreaElement | null>(null);
const open = ref(false);

// reka's `ListboxRoot` (which underlies `AutocompleteRoot`/`Combobox*`) auto-highlights — and via
// `changeHighlight`'s own `focus ?? focusable.value` fallback, really `.focus()`s — a suggestion
// every time this popup's content gains "entry focus" (mount, and every re-render while open;
// reka-ui 2.10.5's own source: `focusable` is never exposed as a settable prop for the
// Combobox/Autocomplete case). That's a real requirement no reka composition meets for a
// *free-text* field: the real <input>/<textarea> must keep DOM focus throughout, with
// `activeIndex` alone driving which suggestion looks current — never a rewritten popup/listbox,
// per the file header above. `ListboxRoot.onEnter` (node_modules/reka-ui/dist/Listbox/
// ListboxRoot.js) dispatches a cancelable `entryFocusEvent` and checks its own
// `defaultPrevented` before calling `changeHighlight` at all — `AutocompleteRoot` forwards
// `$attrs` (so `onEntryFocus` below) straight onto the underlying `ListboxRoot` vnode, so this
// stops the steal at its one source instead of clawing focus back after it already happened.
// The one reliable way to identify the popup's real DOM node for `onBlur`'s own containment
// check below — `ComboboxContent`'s own `:id` binding in the template is never actually applied:
// `ComboboxContentImpl`'s render merges its internal `rootContext.contentId` in *after* `$attrs`
// (reka-ui 2.10.5's own source), so an outside `:id` is silently overridden (and, specific to
// `AutocompleteRoot`, that internal id is a hardcoded `""` besides). A template `ref` on a
// component yields its instance, not its DOM node — `.$el` is that node (a component ref works
// for either, so this stays a component instance rather than importing reka's own internal
// exposed-element type just for this).
const contentRef = ref<{ $el?: HTMLElement } | null>(null);
const activeIndex = ref(0);
const wordStart = ref(0);
const currentWord = ref('');
// Ctrl+Space: lists every candidate regardless of the token under the caret, capped the same as a
// normal prefix match — distinct from the ordinary "matches what's typed" path below.
const forceAll = ref(false);
// Enter only accepts a suggestion once the user has explicitly arrowed onto one — otherwise a bare
// "finish typing, hit Enter to submit" would get silently hijacked whenever the trailing word
// happens to substring-match a candidate. Tab always accepts the current (possibly un-navigated)
// top match — that's the one explicit "complete this" key with no competing submit meaning.
const hasNavigated = ref(false);
// Keys onKeydown already special-cases while the dropdown is open — their keyup must not re-run
// recompute() (it would reset activeIndex/hasNavigated right back after onKeydown just set them,
// since none of these keys actually move the text cursor).
const NAV_KEYS = new Set(['ArrowUp', 'ArrowDown', 'Enter', 'Tab', 'Escape']);

// Resolved fresh on every recompute — a function candidates list is re-evaluated with the current
// token context (text/from/word), so typing past a `|` swaps the list from variable names to
// transform names without any extra wiring at the call site.
const resolvedCandidates = computed<readonly Completion[]>(() =>
  typeof props.candidates === 'function'
    ? props.candidates({ text: props.modelValue, from: wordStart.value, word: currentWord.value })
    : props.candidates,
);

const filtered = computed(() =>
  forceAll.value
    ? resolvedCandidates.value.slice(0, MAX_VISIBLE)
    : rankCandidates(resolvedCandidates.value, currentWord.value),
);

function recompute(el: HTMLInputElement | HTMLTextAreaElement): void {
  const cursor = el.selectionStart ?? el.value.length;
  const tokenizer = props.tokenAt ?? tokenAt;
  const token = tokenizer(el.value, cursor);
  // A null result (templateToken outside any `{{…}}`) clears the word and, via onInput's own
  // `currentWord.value.length > 0` gate below, closes the popup — a variable field only suggests
  // while the caret is actually inside a reference.
  wordStart.value = token?.from ?? cursor;
  currentWord.value = token?.word ?? '';
  activeIndex.value = 0;
  hasNavigated.value = false;
}

function onInput(e: Event): void {
  const el = e.target as HTMLInputElement | HTMLTextAreaElement;
  emit('update:modelValue', el.value);
  forceAll.value = false;
  recompute(el);
  open.value = currentWord.value.length > 0 && filtered.value.length > 0;
  closeHover();
}

// Cursor-move-only events (click, arrow-left/right, Home/End with no text change) still need the
// suggestion window to track wherever the cursor lands, or a click into an earlier word would keep
// suggesting whatever was typed last. Excludes the nav keys onKeydown already handles below
// (NAV_KEYS) — those never move the text cursor and must not stomp the activeIndex/hasNavigated
// state onKeydown just set.
function onClick(e: Event): void {
  if (!open.value) return;
  recompute(e.target as HTMLInputElement | HTMLTextAreaElement);
}
function onKeyup(e: KeyboardEvent): void {
  if (!open.value || NAV_KEYS.has(e.key)) return;
  recompute(e.target as HTMLInputElement | HTMLTextAreaElement);
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
  // Any keystroke closes the hover panel — the same close set the completion popup uses.
  closeHover();
  // A bracket/quote typed over a selection wraps it, a collapsed caret auto-closes it
  // (theme/wrapSelection.ts, the two can never both fire for one keystroke) — rather than running
  // through the completion machinery below; onInput's own listener picks up the synthetic 'input'
  // event either one dispatches, same as any other edit.
  const before = (e.target as HTMLInputElement | HTMLTextAreaElement).value;
  wrapSelectionOnType(e);
  autoClosePairsOnType(e);
  if ((e.target as HTMLInputElement | HTMLTextAreaElement).value !== before) return;
  // Ctrl+Space / Cmd+Space: explicit "show me everything", matching completionKeymap's own binding
  // so the console and these plain fields share one muscle memory.
  if (e.key === ' ' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    recompute(e.target as HTMLInputElement | HTMLTextAreaElement);
    forceAll.value = true;
    open.value = filtered.value.length > 0;
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
    // No newline is ever inserted under `grow` — growth comes from soft wrapping alone.
    if (props.grow) e.preventDefault();
    open.value = false;
    emit('enter');
  } else if (e.key === 'Escape') emit('escape');
}

// The overlay is `pointer-events: none` (purely paint, see the template) and never scrolls on its
// own — it has no scrollbar and the user can never focus it to drag one. A native text `<input>`
// fires its own 'scroll' event as its internal text pans to keep the caret in view once the value
// overflows the box; mirroring that onto the overlay root itself (`overflow: hidden`, which honours
// a programmatic scrollLeft same as any other overflow value) keeps the coloured text panned to the
// exact same offset as the invisible real text sitting on top of it.
const overlayRootRef = ref<HTMLElement | null>(null);
function onInputScroll(e: Event): void {
  // scrollTop mirrored too, alongside scrollLeft — a no-op for a plain single-line input (scrollTop
  // is always 0 there) and what keeps the overlay panned to the same offset as a `grow` textarea's
  // own internal vertical scroll past 4 rows.
  const el = e.target as HTMLInputElement | HTMLTextAreaElement;
  if (!overlayRootRef.value) return;
  overlayRootRef.value.scrollLeft = el.scrollLeft;
  overlayRootRef.value.scrollTop = el.scrollTop;
}

// A field-local floating tooltip for the token under the pointer, built on
// theme/floatingPosition.ts's pointReference — the app's element-anchored tooltip singleton
// (workbench/state/tooltip.ts) cannot serve this: it hit-tests per *element*, never re-resolving
// within one input as the pointer crosses from ordinary text onto a `{{ref}}`, and `theme/` may not
// import `workbench/` regardless. No hover machinery does anything when `hoverAt` is absent — every
// call site but the URL/header-value fields — since `onInputMouseMove` below returns immediately.
//
// 400 mirrors workbench/state/tooltip.ts's own TOOLTIP_DELAY_MS (itself already shared with
// MonacoHost.vue's own hover delay).
const HOVER_DELAY_MS = 400;

const hoverPanelRef = ref<HTMLElement | null>(null);
const hoverLines = ref<string[] | null>(null);
const hoverStyle = ref<{ left: string; top: string } | null>(null);
// A "different token than last time" check without needing the token's own span — `hoverAt`'s
// contract is text-in/lines-out, no offsets — comparing the lines it returns for the pointer's
// current offset is exactly that: the same token yields the same lines every time.
let lastHoverKey: string | null = null;

const { start: startHoverTimer, stop: stopHoverTimer } = useTimeoutFn(
  (x: number, top: number, lines: string[]) => void openHoverAt(x, top, lines),
  HOVER_DELAY_MS,
  { immediate: false },
);

function closeHover(): void {
  stopHoverTimer();
  hoverLines.value = null;
  lastHoverKey = null;
}

async function openHoverAt(x: number, y: number, lines: string[]): Promise<void> {
  hoverLines.value = lines;
  await nextTick();
  const panel = hoverPanelRef.value;
  if (!panel) return;
  const { left, top } = await computeFloatPosition(pointReference(x, y), panel, {
    placement: 'bottom-start',
  });
  hoverStyle.value = { left: `${left}px`, top: `${top}px` };
}

function onInputMouseMove(e: MouseEvent): void {
  if (!props.hoverAt) return;
  const overlay = overlayRootRef.value;
  const el = inputRef.value;
  if (!overlay || !el) return;
  // DOM-native coordinate hit-testing (caretPositionFromPoint/caretRangeFromPoint) on the overlay
  // that is already painting the same text at the same viewport coordinates as this real input —
  // exact, and it does not re-assume the monospace grid the overlay's *painted* alignment depends
  // on.
  //
  // Both elements' own `pointer-events` normally point a hit-test at the *input* — the overlay is
  // `pointer-events: none` (so a real click/drag always reaches the input underneath) and the input
  // itself paints on top with `z-index: 1` (`.has-overlay` CSS), so caretPositionFromPoint would
  // otherwise resolve to the input every time, never a text node inside the overlay. Flipped for the
  // span of this one synchronous hit-test only, restored in a `finally` immediately after — no real
  // user click/drag is ever at risk of hitting the overlay instead of the input.
  el.style.pointerEvents = 'none';
  overlay.style.pointerEvents = 'auto';
  let offset: number | null;
  try {
    offset = overlayOffsetAtPoint(overlay, e.clientX, e.clientY);
  } finally {
    overlay.style.pointerEvents = 'none';
    el.style.pointerEvents = '';
  }
  const lines = offset === null ? null : props.hoverAt(props.modelValue, offset);
  const key = lines ? JSON.stringify(lines) : null;
  if (key === lastHoverKey) return; // same token (or still no token) as the last move
  lastHoverKey = key;
  stopHoverTimer();
  hoverLines.value = null;
  if (!lines) return;
  const rect = el.getBoundingClientRect();
  const x = e.clientX;
  startHoverTimer(x, rect.top, lines);
}

function onBlur(e: FocusEvent): void {
  // Belt-and-suspenders alongside `onEntryFocus` above: if focus is headed into this popup for
  // any other reason (reka's own dismiss/pointer handling), reclaim it synchronously rather than
  // treat it as the field being left — matching the "real input stays focused" contract.
  // `contentRef` (not an id selector): `ComboboxContentImpl`'s own render explicitly merges its
  // internal `rootContext.contentId` in *after* `$attrs`, so a `:id` passed to `ComboboxContent`
  // from outside is silently overridden (confirmed against reka-ui 2.10.5's own source) — the
  // real DOM id is never `listId`, only `contentRef.value.id` is.
  const related = e.relatedTarget as HTMLElement | null;
  if (related && contentRef.value?.$el?.contains(related)) {
    inputRef.value?.focus();
    return;
  }
  open.value = false;
  forceAll.value = false;
  closeHover();
  emit('blur', e);
}

// Closes on window resize/scroll rather than re-following the input — a scroll or resize
// mid-selection is rare enough that a stale-then-gone popup is fine, and ComboboxContent's own
// Popper positioning only tracks the anchor while mounted, not across a scroll that might move it
// out of view entirely.
function closeOnViewportChange(): void {
  closeHover();
  if (!open.value) return;
  open.value = false;
  forceAll.value = false;
}
useEventListener(window, 'resize', closeOnViewportChange);
useEventListener(window, 'scroll', closeOnViewportChange, true);

// P107 I2-38: the textarea/input pair below bound the same 19 attributes/listeners — this is the
// one thing that differs between them (plus each tag's own rows/wrap).
const fieldAttrs = computed(
  () =>
    ({
      value: props.modelValue,
      placeholder: props.placeholder,
      class: { 'has-overlay': showOverlay.value },
      autocomplete: 'off',
      spellcheck: 'false',
      role: 'combobox',
      'aria-autocomplete': 'list',
      'aria-expanded': open.value,
      'aria-controls': listId,
      'aria-activedescendant':
        open.value && filtered.value[activeIndex.value]
          ? `${listId}-${activeIndex.value}`
          : undefined,
      onInput,
      onPaste,
      onClick,
      onKeyup,
      onKeydown,
      onBlur,
      onScroll: onInputScroll,
      onMousemove: onInputMouseMove,
      onMouseleave: closeHover,
    }) as const,
);
</script>

<template>
  <AutocompleteRoot
    class="contents"
    :model-value="modelValue"
    :open="open"
    ignore-filter
    :highlight-on-hover="false"
  >
    <span
      class="p-input autocomplete-field relative"
      :class="{ 'is-invalid': invalid, 'is-grow': grow }"
    >
      <span v-if="prefix" class="ph" :class="{ 'ph-active': prefixActive }">{{ prefix }}</span>
      <span class="input-wrap relative flex min-w-0 flex-1 items-center" :data-value="modelValue">
        <!-- Paint-only: see `language`'s own doc comment above for why this is a second element
             behind the real input rather than the input itself. `overlayHtml` is built entirely by
             `paintOverlayHtml` — every character of the field's own text, HTML-escaped, wrapped
             only in this module's own static class names — never raw markup from anywhere else, so
             `v-html` here paints exactly what `escapeHtml`/`mergeHighlightRanges` produced and
             nothing else. -->
        <div
          v-if="showOverlay"
          ref="overlayRootRef"
          class="highlight-overlay"
          aria-hidden="true"
          v-html="overlayHtml"
        ></div>
        <textarea
          v-if="grow"
          ref="inputRef"
          rows="1"
          wrap="soft"
          v-bind="{ ...$attrs, ...fieldAttrs }"
        />
        <input v-else ref="inputRef" v-bind="{ ...$attrs, ...fieldAttrs }" />
        <ComboboxAnchor :reference="inputRef ?? undefined" />
      </span>
    </span>
    <ComboboxPortal>
      <ComboboxContent
        v-if="filtered.length > 0"
        ref="contentRef"
        as="ul"
        position="popper"
        side="bottom"
        align="start"
        :side-offset="4"
        class="autocomplete-suggestions p-completion p-float z-[var(--kira-z-autocomplete)] m-0 list-none"
        @mousedown.prevent
      >
        <ComboboxViewport>
          <ComboboxItem
            v-for="(c, i) in filtered"
            :id="`${listId}-${i}`"
            :key="c.label"
            as="li"
            :value="i"
            class="p-completion-row"
            :class="{ 'is-on': i === activeIndex }"
            @mouseenter="activeIndex = i"
            @mousedown.prevent="accept(c)"
          >
            <CodiconIcon v-if="c.icon" :name="c.icon" :size="13" class="p-completion-icon" />
            <span class="p-completion-label">{{ c.label }}</span>
            <span v-if="c.detail" class="p-completion-detail">{{ c.detail }}</span>
          </ComboboxItem>
        </ComboboxViewport>
      </ComboboxContent>
    </ComboboxPortal>
    <div
      v-if="hoverLines"
      ref="hoverPanelRef"
      class="var-hover-panel p-float fixed z-[var(--kira-z-autocomplete)] max-w-96 px-1.5 py-1 font-data text-kira-sm text-fg pointer-events-none"
      role="tooltip"
      data-testid="autocomplete-hover"
      :style="hoverStyle ?? undefined"
    >
      <div
        v-for="(line, i) in hoverLines"
        :key="i"
        class="hover-line whitespace-pre-wrap [overflow-wrap:anywhere]"
        :class="{ 'mt-0.5 text-muted': i > 0 }"
        >{{ line }}</div
      >
    </div>
  </AutocompleteRoot>
</template>

<style scoped>
/* Paint-only and never scrolled by the user directly (see onInputScroll) — sized/positioned to sit
   exactly under the real `<input>` next to it, not the whole `.p-input` box (which may also carry a
   `prefix` span ahead of this wrapper). `kira-font-family` is a monospace stack, so the overlay's
   character grid lines up with the native input's own character-for-character regardless of which
   of the two engines is laying out any given glyph — the one property this trick actually depends
   on. */
.highlight-overlay {
  position: absolute;
  inset: 0;
  pointer-events: none;
  overflow: hidden;
  white-space: pre;
  font-family: var(--kira-font-data);
  font-size: var(--kira-t-sm);
  line-height: normal;
  background: transparent;
  /* The painted text sizes to its own one line of content, not to this inset:0 box — centering it
     here is what lines it up with the native input's own vertically-centered line box
     (`.input-wrap`'s own align-items: center) regardless of the current font-size setting.
     `onInputScroll` pans this element's own `scrollLeft`, so the overflowing (flex, non-shrinking)
     text content is what actually needs the horizontal scroll, not a nested child. */
  display: flex;
  align-items: center;
}

/* Mirrors MonacoHost.vue's own identical rules — `classFor` (api/state/variableCompletion.ts)
   paints the same three classes into this overlay's `v-html` content, which never reaches
   MonacoHost's own scoped styles (they're two separate components' DOM). `:deep()` is required
   either way: `v-html` content carries no `data-v-*` scoping attribute of its own. */
.highlight-overlay :deep(.kira-ed-var) {
  color: var(--kira-var-resolved);
}

.highlight-overlay :deep(.kira-ed-var-secret) {
  color: var(--kira-var-resolved);
  text-decoration: underline dotted var(--kira-syntax-meta);
}

.highlight-overlay :deep(.kira-ed-var-unknown) {
  color: var(--kira-warn);
  text-decoration: underline wavy var(--kira-warn);
}

/* The overlay must wrap on exactly the same boundaries as a `grow` textarea — same font, same
   width, same white-space/overflow-wrap — and top-align rather than vertically centre a single
   line. `line-height: inherit` picks up `1.45` from `.p-input.is-grow` — a `grow` textarea's own
   line height comes from there, not from `normal` below, and the two must agree or the overlay's
   lines and the textarea's own lines drift apart by line 2. `line-height: normal` on
   `.highlight-overlay` above stays for every non-grow field, so no single-line field moves by a
   pixel. */
.autocomplete-field.is-grow .highlight-overlay {
  display: block;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  line-height: inherit;
}

/* The real input/textarea stays the only interactive/focusable/selectable element — its own text is
   painted transparent so only the overlay's coloured glyphs underneath show through, while its
   native caret (caret-color, unaffected by `color`) and selection painting keep working exactly as
   before, and the overlay paints *behind* whichever of the two is rendered. Only applied when an
   overlay actually exists (`highlighted`) — every other field using this component keeps today's
   plain look untouched. No padding rule is needed here either — this box is `inset: 0` on
   `.input-wrap`, and the textarea is zero-padded inside the same box (primitives.css), so the two
   elements' first glyphs land on the same pixel; do not add a compensating offset. */
.input-wrap input.has-overlay,
.input-wrap textarea.has-overlay {
  position: relative;
  z-index: 1;
  color: transparent;
  caret-color: var(--kira-fg);
}
</style>
