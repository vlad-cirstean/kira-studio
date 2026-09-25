<script setup lang="ts">
/**
 * `docs/plans/P11.md` W11/W12: §6.2's search box. One text input, three toggle buttons
 * (case-sensitive / whole-word / regex) as `aria-pressed` icon buttons with VS Code's own
 * icon-button styling, a Commits/Refs/Both scope `<select>` living *inside* the box (OQ6: §6.2
 * gave the toolbar one slot and §6.3's 600px breakpoint had no room for a second control — G-UX
 * D9/item 9 later moved this whole component out of the toolbar into its own row below it, but
 * the box's own internal anatomy is unchanged), the inline `n of N` match count, an inline regex
 * error wired to the input via `aria-describedby` (probe 4) — and, nested inside this same root
 * the way `BranchPicker.vue` nests `TagList.vue`/`StashList.vue` inside its own open panel,
 * `SearchResults.vue`'s grouped dropdown.
 *
 * **Why the dropdown lives here, not as an `App.vue`-positioned sibling.** `SearchResults.vue`
 * follows the ARIA combobox pattern (`role="listbox"` + `aria-activedescendant`), which requires
 * DOM focus to stay on the input the whole time an option is "active" — arrow keys move a virtual
 * cursor, never real focus, so typing and arrowing interleave freely and a mouse click on a row
 * never blurs the box. That means the arrow-key/Enter/Escape handling for the dropdown has to
 * live wherever the input's own `keydown` fires, which is this file; `SearchResults.vue` itself
 * stays a pure renderer over `searchResultsModel.ts`'s fold plus the `highlightedId` this file
 * hands it, emitting only a plain `select`/`hover`/`runBodySearch` this file forwards or acts on.
 *
 * **Reconciling `Enter` with "next match" (hard part 8, judgment call 6).** Two different things
 * both want `Enter`: `§7.8`'s "step through commit matches" and the listbox's own "accept the
 * highlighted option". `#highlightedIndex` is the tie-break: `-1` (nothing arrowed to yet) means
 * `Enter`/`Shift+Enter` step `SearchState.next()`/`previous()` exactly as `§7.8` describes commit
 * matches only, never refs; the moment an arrow key has moved that cursor onto some option,
 * `Enter` accepts *that* option instead (ref or commit alike) and `Shift+Enter` reverts to no-op,
 * since the dropdown has no symmetric "previous option" gesture of its own to give it.
 *
 * **`Escape`'s two-stage order (spec edit 6, OQ5).** OQ5 says closing the dropdown must not erase
 * the in-place highlights — a user closing it to look at the graph is still mid-search. So a
 * first `Escape` while the dropdown is open only dismisses it (`#dropdownDismissed`), leaving the
 * query and every derived highlight untouched; a second `Escape` (or the first, when the dropdown
 * was already closed or never open) clears the query via `SearchState.clear()` and asks the
 * parent to move focus back to the grid (`focusGrid`). An empty box with no dropdown open lets
 * the key fall through undisturbed to `App.vue`'s own Esc chain (diff view, then detail pane) —
 * together this *is* spec edit 6's "an open menu, then the search results dropdown, then the diff
 * view, then the detail pane" without `App.vue`'s own handler needing to know anything about
 * search at all.
 *
 * **`/` and `Ctrl/Cmd+F`** no longer live here (G-UX D9, item 9): the search row this component
 * mounts inside is now conditionally rendered (`App.vue`'s `searchOpen`), so a listener mounted
 * for "this component's own whole lifetime" would only ever fire while the row is already open —
 * exactly backwards for a shortcut whose whole job is opening it. `App.vue` owns that listener
 * now, alongside the toggle-closed gesture (`Ctrl/Cmd+F` a second time) and the new
 * `Ctrl+Alt+F` VS Code keybinding, none of which this component needs to know about.
 *
 * G-UX D9: the main query input is `KuiSearchInput` now, not a raw `<input>` — G21's own
 * "duplication G19 D3a/G21 D2 closed at its source" argument finally reaches this file too, now
 * that `KuiSearchInput` (`packages/kira-ui`) carries the ARIA/keydown passthrough props a
 * combobox needs (its own doc comment explains why they had to be added rather than assumed).
 */
import type { SearchScope } from '@kira/git-core';
import type { KuiSelectOption } from '@kira/kira-ui';
// `KuiSearchInput` is a plain (not `import type`) import even though this file's own script only
// ever reads it through `InstanceType<typeof KuiSearchInput>` (`searchInputRef`) — the template's
// own `<KuiSearchInput>` tag instantiates it as a component; biome's static analysis sees neither
// use and would otherwise "fix" this to `import type`, silently erasing the import —
// `biome.json`'s own `**/*.vue` override turns `useImportType` off for exactly this class of
// false positive (P96 §5.2).
import { computeFloatPosition, KuiButton, KuiSearchInput, KuiSelect } from '@kira/kira-ui';
import { onClickOutside } from '@vueuse/core';
import { computed, nextTick, ref, watch } from 'vue';
import type { SearchState } from '../state/search.ts';
import { MIN_TAIL_QUERY_LENGTH } from '../state/search.ts';
import SearchResults from './SearchResults.vue';
import { SEARCH_LISTBOX_ID } from './searchListboxId.ts';
import type { SearchOption } from './searchResultsModel.ts';
import { buildSearchResultsModel } from './searchResultsModel.ts';

const props = defineProps<{ search: SearchState }>();
const emit = defineEmits<{
  (e: 'focusGrid'): void;
  (e: 'select', option: SearchOption): void;
  /** The row's own close (X) button — `App.vue` owns `closeSearch()` (close, clear the query, and
   *  return focus to the grid), the same "emit, don't own" shape this component already follows
   *  for `focusGrid`. */
  (e: 'close'): void;
}>();

const rootEl = ref<HTMLElement | null>(null);
const searchInputRef = ref<InstanceType<typeof KuiSearchInput> | null>(null);

const ERROR_ID = 'kv-search-error';

// G20 D5, deviation: the plan's own file-by-file table calls for wrapping `.kv-search-error` in
// `KuiPopoverPanel` like the other 6 dropdowns — but that component's backdrop is a full-viewport,
// `position: fixed` click-catcher (by design, for a user-opened menu). This element is a passive
// inline validation message that appears/disappears as a side effect of typing a regex, never
// something the user affirmatively "opens" — wrapping it in that backdrop would block every other
// click in the UI (the graph, the toolbar) for as long as a regex error happens to be showing,
// a real interaction regression the plan's own read of this file (as one of "7 dropdowns," all
// assumed click-triggered) did not surface. Positioned directly via `computeFloatPosition`
// instead — real flip/shift, no backdrop, no Escape/click-outside handling of its own (it was
// never modal) — mirroring `App.vue`'s own one-off force-delete-popup treatment (D4) rather than
// `KuiPopoverPanel`.
const errorEl = ref<HTMLElement | null>(null);
const errorStyle = ref({ left: '-9999px', top: '-9999px' });
watch(
  () => props.search.error.value,
  async (error) => {
    if (!error) return;
    errorStyle.value = { left: '-9999px', top: '-9999px' };
    await nextTick();
    const anchor = rootEl.value;
    const el = errorEl.value;
    if (!anchor || !el) return;
    const { left, top } = await computeFloatPosition(anchor, el, { placement: 'bottom-start' });
    errorStyle.value = { left: `${left}px`, top: `${top}px` };
  },
);

/** The inline `n of N` indicator mirrors exactly what `Enter`/`Shift+Enter` step through —
 *  commit matches (judgment call 6) — so it is hidden entirely in `Refs` scope, where there is
 *  nothing to page through at all; `SearchResults.vue`'s own group counts are what show a
 *  ref-hit count, in both `Refs` and `Both` scope alike. */
const countLabel = computed(() => {
  if (props.search.compiled.value.kind !== 'ok') return '';
  if (props.search.scope.value === 'refs') return '';
  const { n, exact } = props.search.matchCount.value;
  if (n === 0) return 'No matches';
  const position = props.search.activeIndex.value >= 0 ? props.search.activeIndex.value + 1 : 1;
  return `${position} of ${n}${exact ? '' : '+'}`;
});

// ---------------------------------------------------------------------------------------
// The dropdown: visible whenever the query compiles to something real, dismissible without
// touching the query (OQ5), reopened by the next keystroke.
// ---------------------------------------------------------------------------------------
const dropdownDismissed = ref(false);
const highlightedIndex = ref(-1);

const resultsModel = computed(() =>
  buildSearchResultsModel({
    scope: props.search.scope.value,
    refHits: props.search.refHits.value,
    commitHits: props.search.commitHits.value,
    loaded: props.search.loaded.value,
    loadedRowCount: props.search.loadedRowCount.value,
    tail: props.search.tail.value,
  }),
);

const dropdownVisible = computed(
  () => props.search.compiled.value.kind === 'ok' && !dropdownDismissed.value,
);

const highlightedOption = computed<SearchOption | undefined>(
  () => resultsModel.value.flatOptions[highlightedIndex.value],
);

/** OQ1's on-demand override, shown only when that is the *actual* reason the tail has not run —
 *  never for a too-short query or `Refs` scope, where offering it would be a lie about what it
 *  does. */
const showBodySearchAffordance = computed(
  () =>
    props.search.compiled.value.kind === 'ok' &&
    props.search.scope.value !== 'refs' &&
    props.search.text.value.length >= MIN_TAIL_QUERY_LENGTH &&
    props.search.tail.value === undefined &&
    props.search.tailSkippedByExhaustion.value,
);

// Typing (or a toggle/scope change producing a new query) always reopens a dismissed dropdown
// and drops whatever option an earlier query's arrow-key nav had reached — that cursor no longer
// refers to anything meaningful once the option list has been rebuilt.
watch(
  () => props.search.compiled.value,
  () => {
    dropdownDismissed.value = false;
    highlightedIndex.value = -1;
  },
);

function onInput(value: string): void {
  props.search.text.value = value;
}

function selectOption(option: SearchOption): void {
  dropdownDismissed.value = true;
  emit('select', option);
}

function onKeydown(event: KeyboardEvent): void {
  const flat = resultsModel.value.flatOptions;
  if (event.key === 'ArrowDown' && dropdownVisible.value && flat.length > 0) {
    event.preventDefault();
    highlightedIndex.value = (highlightedIndex.value + 1) % flat.length;
    return;
  }
  if (event.key === 'ArrowUp' && dropdownVisible.value && flat.length > 0) {
    event.preventDefault();
    highlightedIndex.value = (highlightedIndex.value - 1 + flat.length) % flat.length;
    return;
  }
  if (event.key === 'Enter') {
    event.preventDefault();
    const option = highlightedOption.value;
    if (option !== undefined) {
      selectOption(option);
    } else if (event.shiftKey) {
      props.search.previous();
    } else {
      props.search.next();
    }
    return;
  }
  if (event.key === 'Escape') {
    if (dropdownVisible.value) {
      event.preventDefault();
      event.stopPropagation();
      dropdownDismissed.value = true;
      return;
    }
    if (props.search.text.value === '') return; // fall through to App.vue's own Esc chain
    event.preventDefault();
    event.stopPropagation();
    props.search.clear();
    emit('focusGrid');
  }
}

const scopeOptions: readonly KuiSelectOption[] = [
  { value: 'both', label: 'Both' },
  { value: 'commits', label: 'Commits' },
  { value: 'refs', label: 'Refs' },
];

function onScopeChange(value: string): void {
  props.search.scope.value = value as SearchScope;
}

onClickOutside(rootEl, () => {
  if (dropdownVisible.value) dropdownDismissed.value = true;
});

defineExpose({ focus: () => searchInputRef.value?.focus() });
</script>

<template>
  <div ref="rootEl" class="kv:relative kv:flex-1 kv:min-w-0">
    <div class="kv:flex kv:items-center kv:gap-1">
      <KuiSearchInput
        ref="searchInputRef"
        class="kv:flex-1 kv:min-w-0"
        :model-value="search.text.value"
        placeholder="Search"
        ariaLabel="Search"
        role="combobox"
        aria-haspopup="listbox"
        data-testid="search-input"
        :aria-expanded="dropdownVisible && resultsModel.sections.length > 0"
        :aria-controls="dropdownVisible ? SEARCH_LISTBOX_ID : undefined"
        :ariaActivedescendant="highlightedOption?.id"
        :aria-describedby="search.error.value ? ERROR_ID : undefined"
        :aria-invalid="!!search.error.value"
        @update:model-value="onInput"
        @keydown="onKeydown"
      />
      <section class="kv:flex kv:gap-0.25" aria-label="Search options">
        <KuiButton
          icon="codicon-case-sensitive"
          class="kv:text-muted-foreground kv:text-xs"
          :active="search.caseSensitive.value"
          :aria-pressed="search.caseSensitive.value"
          v-kui-tooltip="'Match case'"
          aria-label="Match case"
          data-testid="search-toggle-case"
          @click="search.caseSensitive.value = !search.caseSensitive.value"
        />
        <KuiButton
          icon="codicon-whole-word"
          class="kv:text-muted-foreground kv:text-xs"
          :active="search.wholeWord.value"
          :aria-pressed="search.wholeWord.value"
          v-kui-tooltip="'Match whole word'"
          aria-label="Match whole word"
          data-testid="search-toggle-whole-word"
          @click="search.wholeWord.value = !search.wholeWord.value"
        />
        <KuiButton
          icon="codicon-regex"
          class="kv:text-muted-foreground kv:text-xs"
          :active="search.regex.value"
          :aria-pressed="search.regex.value"
          v-kui-tooltip="'Use regular expression'"
          aria-label="Use regular expression"
          data-testid="search-toggle-regex"
          @click="search.regex.value = !search.regex.value"
        />
      </section>
      <KuiSelect
        class="kv:text-xs"
        ariaLabel="Search scope"
        data-testid="search-scope"
        :model-value="search.scope.value"
        :options="scopeOptions"
        @update:model-value="onScopeChange"
      />
      <span v-if="countLabel" class="kv:px-0.5 kv:text-muted-foreground kv:text-xs kv:whitespace-nowrap" data-testid="search-count">{{ countLabel }}</span>
      <KuiButton
        variant="icon"
        icon="codicon-close"
        v-kui-tooltip="'Close search'"
        aria-label="Close search"
        data-testid="search-close-button"
        @click="emit('close')"
      />
    </div>
    <div
      v-if="search.error.value"
      :id="ERROR_ID"
      ref="errorEl"
      class="kv:fixed kv:z-[var(--kui-z-popover,20)] kv:max-w-[var(--kui-float-max-w,none)] kv:py-0.5 kv:px-1 kv:bg-panel kv:text-error kv:border kv:border-border-strong kv:rounded-lg kv:shadow-float kv:text-xs"
      role="alert"
      data-testid="search-error"
      :style="errorStyle"
    >
      {{ search.error.value }}
    </div>
    <SearchResults
      v-if="dropdownVisible"
      :model="resultsModel"
      :highlighted-id="highlightedOption?.id"
      :searching="search.searching.value"
      :tail-stale="search.tailStale.value"
      :show-body-search-affordance="showBodySearchAffordance"
      @select="selectOption"
      @hover="(option) => (highlightedIndex = resultsModel.flatOptions.indexOf(option))"
      @run-body-search="search.runBodySearch()"
    />
  </div>
</template>

