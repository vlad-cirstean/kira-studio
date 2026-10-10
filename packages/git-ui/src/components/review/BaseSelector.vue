<script setup lang="ts">
/**
 * `docs/plans/P7.md` W12 — §6.8: "shown in the view's header as a picker — never as static text —
 * naming the base and how it was resolved ('upstream', 'default branch')." The trigger names the
 * current base (or "Choose a base…" while `reason: "none"`) plus a quiet reason label; the
 * dropdown has two sections — Suggested (`resolution.candidates`, each carrying its own reason)
 * and All branches (`refsState`'s own branches/remote-tracking branches, through the same
 * `refListModel.ts` fold `BranchPicker.vue` uses, so the two lists sort/filter/cap identically).
 * Tags are never offered here — `<base>..<branch>` is a question about two branches (§6.8),
 * mirroring W14's "not offered for tags" rule on the row menu's own entry.
 */
import type { BaseCandidate, BaseResolution, BaseResolutionReason } from '@kira/git-ipc';
import CodiconIcon from '@theme/CodiconIcon.vue';
import { rowVariants } from '@theme/components/rowVariants';
import SearchField from '@theme/components/SearchField.vue';
import SectionHeading from '@theme/components/SectionHeading.vue';
import { Button } from '@theme/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@theme/components/ui/popover';
import { cn } from '@theme/lib/utils';
import { computed, ref, useTemplateRef } from 'vue';
import { codiconName, STATE_ICONS } from '../../icons/index.ts';
import type { RefsState } from '../../state/refs.ts';
import { buildRefListSections } from '../refListModel.ts';

const props = defineProps<{
  resolution: BaseResolution | undefined;
  refsState: RefsState;
}>();

const emit = defineEmits<(e: 'select-base', ref: string) => void>();

/** `"override"` and `"none"` both render nothing — an overridden base needs no explanation of
 *  where it came from, and `reason: "none"` never reaches this (paired only with `base: null`,
 *  which the trigger already renders as the placeholder text rather than a labelled name). */
function reasonLabel(reason: BaseResolutionReason): string | undefined {
  switch (reason) {
    case 'upstream':
      return 'upstream';
    case 'defaultBranch':
      return 'default branch';
    case 'override':
    case 'none':
      return undefined;
  }
}

const triggerLabel = computed(() => props.resolution?.base ?? 'Choose a base…');
const triggerReason = computed(() => {
  const resolution = props.resolution;
  if (!resolution || resolution.base === null) return undefined;
  return reasonLabel(resolution.reason);
});

const isOpen = ref(false);
const filter = ref('');
// P131 Part 3 §5.2: reka's modal Popover owns focus trap, outside-click and Escape, and returns
// focus to the trigger on close — the same contract `useModalFocus`/`onClickOutside`/the rootEl
// Escape listener existed to provide by hand.
const filterEl = useTemplateRef<{ focus: () => void }>('filterEl');

function open(): void {
  isOpen.value = true;
}

function close(): void {
  isOpen.value = false;
  filter.value = '';
}

const sections = computed(() =>
  buildRefListSections(
    {
      branches: props.refsState.branches.value,
      remoteBranches: props.refsState.remoteBranches.value,
      tags: [],
    },
    filter.value,
  ),
);

/** `head` stays `undefined` until the first `refs.list` lands (and after a repo switch), so an
 *  empty list then means "not loaded yet", not "no branch matches". */
const refsLoading = computed(() => props.refsState.head.value === undefined);
const hiddenCount = computed(
  () => sections.value.branches.hiddenCount + sections.value.remoteBranches.hiddenCount,
);

/** The candidate shortlist minus whichever entry is already the current base — picking it again
 *  would be a no-op re-resolve for nothing the user could see change. */
const suggested = computed<readonly BaseCandidate[]>(() => {
  const current = props.resolution?.base;
  return (props.resolution?.candidates ?? []).filter((c) => c.ref !== current);
});

function candidateReason(candidate: BaseCandidate): string {
  return reasonLabel(candidate.reason) ?? '';
}

function pick(ref: string): void {
  close();
  emit('select-base', ref);
}

/** §5.2: reka's own default (the panel's first focusable element) loses to the filter input
 *  explicitly, mirroring BranchPicker.vue's own `onOpenAutoFocus`. */
function onOpenAutoFocus(e: Event): void {
  e.preventDefault();
  filterEl.value?.focus();
}
</script>

<template>
  <div class="relative">
    <Popover modal :open="isOpen" @update:open="(o) => (o ? open() : close())">
      <PopoverTrigger as-child>
        <Button variant="toolbar" size="kira" class="max-w-full" data-testid="base-selector-trigger">
          <span class="truncate">{{ triggerLabel }}</span>
          <span v-if="triggerReason" class="text-muted-foreground text-kira-sm">{{ triggerReason }}</span>
          <CodiconIcon :name="codiconName(STATE_ICONS.chevronDown)" :size="13" />
        </Button>
      </PopoverTrigger>

      <PopoverContent
        align="start"
        class="w-80 p-0 gap-0"
        aria-label="Choose a comparison base"
        @open-auto-focus="onOpenAutoFocus"
      >
        <div class="max-h-80 flex flex-col min-h-0">
          <div class="m-1">
            <SearchField
              ref="filterEl"
              v-model="filter"
              placeholder="Filter branches"
              aria-label="Filter branches"
            />
          </div>
          <div class="overflow-auto min-h-0">
            <section v-if="suggested.length > 0" aria-label="Suggested">
              <SectionHeading label="Suggested" />
              <button
                v-for="candidate in suggested"
                :key="candidate.ref"
                type="button"
                :class="cn(rowVariants(), 'w-full')"
                @click="pick(candidate.ref)"
              >
                <span class="truncate">{{ candidate.ref }}</span>
                <span class="ml-auto text-muted-foreground text-kira-sm">{{ candidateReason(candidate) }}</span>
              </button>
            </section>

            <section aria-label="All branches">
              <SectionHeading label="All branches" />
              <button
                v-for="row in sections.branches.visible"
                :key="row.refname"
                type="button"
                :class="cn(rowVariants(), 'w-full')"
                @click="pick(row.shortName)"
              >
                <span class="truncate">{{ row.shortName }}</span>
              </button>
              <button
                v-for="row in sections.remoteBranches.visible"
                :key="row.refname"
                type="button"
                :class="cn(rowVariants(), 'w-full')"
                @click="pick(row.shortName)"
              >
                <CodiconIcon name="cloud" :size="13" />
                <span class="truncate">{{ row.shortName }}</span>
              </button>
              <div
                v-if="hiddenCount > 0"
                class="text-kira-sm text-subtle py-1 px-1.5"
                data-testid="base-selector-hidden"
              >
                {{ hiddenCount }} more — type to filter
              </div>
              <div
                v-if="sections.branches.visible.length === 0 && sections.remoteBranches.visible.length === 0"
                class="px-1.5 py-1 text-kira-sm text-subtle"
              >
                {{ refsLoading ? 'Loading branches…' : 'No matching branches' }}
              </div>
            </section>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  </div>
</template>
