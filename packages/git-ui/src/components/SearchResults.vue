<script setup lang="ts">
/**
 * `docs/plans/P11.md` W12: the grouped dropdown `SearchBox.vue` renders inside its own panel
 * (the same nesting `BranchPicker.vue` uses for `TagList.vue`/`StashList.vue`) — refs first
 * (local / remote / tag subsections, each labelled), then commits, each hit showing its kind and,
 * when it matched somewhere other than the subject or ref name, a field label. `role="listbox"`
 * with `aria-activedescendant` set on the *input* (`SearchBox.vue`'s own, per the ARIA combobox
 * pattern — this file never moves DOM focus onto a row), so option elements here carry no
 * `tabindex` of their own and clicking one never blurs the input; `searchResultsModel.ts` owns
 * every grouping/ordering/cap decision, this file only renders it.
 *
 * Keyboard (arrow-key nav, `Enter` to select, `Escape` to close) lives in `SearchBox.vue` — the
 * element that actually holds focus throughout — not here; this file only reflects
 * `highlightedId` back as `aria-selected` and forwards a click as `select`.
 */
import { cn, computeFloatPosition, KuiButton, kuiRowVariants } from "@kira/kira-ui";
import { computed, nextTick, onMounted, ref } from "vue";
import { formatRelativeDate } from "./dateFormat.ts";
import { SEARCH_LISTBOX_ID } from "./searchListboxId.ts";
import type { SearchOption, SearchResultsModel } from "./searchResultsModel.ts";
import { fieldLabel } from "./searchResultsModel.ts";

const props = defineProps<{
  model: SearchResultsModel;
  highlightedId: string | undefined;
  searching: boolean;
  tailStale: boolean;
  showBodySearchAffordance: boolean;
}>();

const emit = defineEmits<{
  (e: "select", option: SearchOption): void;
  (e: "hover", option: SearchOption): void;
  (e: "runBodySearch"): void;
}>();

const isEmpty = computed(() => props.model.sections.length === 0);

// G20 D5, deviation: the plan's own file-by-file table calls for wrapping this in
// `KuiPopoverPanel`, like the other 6 dropdowns — but this one, uniquely among the 7, is an ARIA
// combobox listbox (see the file's own doc comment): `SearchBox.vue`'s `<input>` must keep real
// DOM focus the whole time this is open, and its own Escape handling (a two-stage
// dismiss-then-clear, OQ5) is bound directly to that input, not to a document-level listener.
// `KuiPopoverPanel`'s own document-level, capture-phase Escape handler would intercept every
// Escape keystroke before it ever reaches the input's own bubble-phase handler, silently
// replacing that two-stage behaviour with a plain close — the exact "positioning-coupled
// interaction logic" §7 item 2 anticipated as a reason to special-case one of the 7 rather than
// force it through the shared wrapper. Positioned directly via `computeFloatPosition` instead —
// real flip/shift, no backdrop, no Escape/click-outside handling of its own (both already live in
// `SearchBox.vue`, untouched) — anchored to this component's own DOM parent (`SearchBox.vue`'s
// `rootEl`), the same "read the wrapper, no prop needed" trick `KuiPopoverPanel` itself uses.
const resultsEl = ref<HTMLElement | null>(null);
const resultsStyle = ref({ left: '-9999px', top: '-9999px' });

async function reposition(): Promise<void> {
  await nextTick();
  const el = resultsEl.value;
  const anchor = el?.parentElement;
  if (!el || !anchor) return;
  const { left, top } = await computeFloatPosition(anchor, el, { placement: 'bottom-start' });
  resultsStyle.value = { left: `${left}px`, top: `${top}px` };
}

onMounted(() => void reposition());

/** P110 A17: `.kv-search-option`'s own gap/px are already exactly `kuiRowVariants()`'s own
 *  `gap-kui-2`/`px-kui-3` — `--kui-space-2`/`--kui-space-3` bridge to the same `--kv-s-2`/`--kv-s-3`
 *  values (`kui-bridge.css`). Only the vertical padding and the "active" (keyboard-highlighted,
 *  not a real `:hover`) background need adding — through `cn()` since `kv:px-2` below replaces
 *  the variant's own `px-kui-3` (different value, same property; §1.3). */
function optionClass(option: SearchOption): string {
  return cn(
    kuiRowVariants(),
    'kv:px-2 kv:py-0.5',
    option.id === props.highlightedId ? 'kv:bg-hover' : '',
  );
}
</script>

<template>
  <div
    ref="resultsEl"
    class="kv:fixed kv:z-[var(--kui-z-popover,20)] kv:w-105 kv:max-h-90 kv:overflow-y-auto kv:py-0.5 kv:bg-panel kv:text-fg kv:border kv:border-border-strong kv:rounded-lg kv:shadow-float"
    data-testid="search-results"
    :style="resultsStyle"
  >
    <!-- ARIA's listbox role only permits `option`/`group` children (`aria-required-children`) —
         the status line, section titles and options live inside this inner listbox div; the
         stale hint, footers and the body-search button are its *siblings*, not its children. -->
    <div :id="SEARCH_LISTBOX_ID" role="listbox" aria-label="Search results">
      <div
        v-if="searching"
        class="kv:py-0.5 kv:px-2 kv:text-muted kv:text-xs"
        data-testid="search-status"
      >
        Searching…
      </div>

      <template v-for="section in model.sections" :key="section.title">
        <div class="kv:py-0.5 kv:px-2 kv:text-xs kv:font-semibold kv:text-muted">
          {{ section.title }} <span class="kv:font-normal">({{ section.options.length }})</span>
        </div>

        <template v-for="option in section.options" :key="option.id">
          <div
            :id="option.id"
            role="option"
            :class="optionClass(option)"
            :aria-selected="option.id === highlightedId"
            tabindex="-1"
            @click="emit('select', option)"
            @mouseenter="emit('hover', option)"
            @keydown.enter="emit('select', option)"
          >
            <template v-if="option.kind === 'ref'">
              <span
                class="codicon"
                :class="{
                  'codicon-git-branch': option.hit.ref.kind === 'branch',
                  'codicon-cloud': option.hit.ref.kind === 'remoteBranch',
                  'codicon-tag': option.hit.ref.kind === 'tag',
                }"
                aria-hidden="true"
              ></span>
              <span class="kv:flex-1 kv:min-w-0 kv:truncate">{{ option.hit.ref.shortName }}</span>
              <span
                v-if="fieldLabel(option.hit.fields)"
                class="kv:px-0.5 kv:text-muted kv:text-xs kv:border kv:border-dashed kv:border-panel-border kv:rounded-sm"
              >
                {{ fieldLabel(option.hit.fields) }}
              </span>
            </template>
            <template v-else>
              <span class="kv:font-data kv:text-muted">{{ option.hit.sha.slice(0, 7) }}</span>
              <span class="kv:flex-1 kv:min-w-0 kv:truncate">{{ option.hit.subject }}</span>
              <span class="kv:text-muted kv:text-xs">{{ option.hit.authorName }}</span>
              <span class="kv:text-muted kv:text-xs">{{ formatRelativeDate(option.hit.authorTime) }}</span>
              <span
                v-if="fieldLabel(option.hit.fields)"
                class="kv:px-0.5 kv:text-muted kv:text-xs kv:border kv:border-dashed kv:border-panel-border kv:rounded-sm"
              >
                {{ fieldLabel(option.hit.fields) }}
              </span>
            </template>
          </div>
        </template>
        <div v-if="section.hiddenCount > 0" class="kv:py-0.5 kv:px-2 kv:text-muted kv:text-xs">
          {{ section.hiddenCount }} more — refine your search
        </div>
      </template>

      <div v-if="isEmpty" class="kv:py-0.5 kv:px-2 kv:text-muted kv:text-xs">No results</div>
    </div>

    <div
      v-if="tailStale"
      class="kv:py-0.5 kv:px-2 kv:text-muted kv:text-xs"
      data-testid="search-tail-stale"
    >
      Refs changed since this search ran
    </div>
    <div v-if="model.loadedFooter" class="kv:py-0.5 kv:px-2 kv:text-muted kv:text-xs">
      {{ model.loadedFooter }}
    </div>
    <div v-if="model.tailFooter" class="kv:py-0.5 kv:px-2 kv:text-muted kv:text-xs">
      {{ model.tailFooter }}
    </div>
    <div
      v-if="model.tailNotice"
      class="kv:py-0.5 kv:px-2 kv:text-muted kv:text-xs"
      data-testid="search-tail-notice"
    >
      {{ model.tailNotice }}
    </div>
    <KuiButton
      v-if="showBodySearchAffordance"
      class="kv:block kv:w-full kv:text-left"
      data-testid="search-body-button"
      @click="emit('runBodySearch')"
    >
      Search message bodies
    </KuiButton>
  </div>
</template>
