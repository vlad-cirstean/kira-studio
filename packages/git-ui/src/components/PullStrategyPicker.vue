<script setup lang="ts">
/**
 * `docs/plans/P8.md` W17: the toolbar's Pull control — a split button, `[Pull] [▾]`, mirroring
 * `BranchPicker.vue`'s own trigger/panel shape but at toolbar scale. The main button runs Pull
 * following the resolved default (§7.3's ladder, no override); the chevron opens a small popover
 * offering the three explicit strategies plus that same default, each running Pull immediately
 * on selection rather than staging a separate confirm step — a second click to *run* what the
 * user just picked would be friction §7.3 never asked for (only "show it before it runs", which
 * `OpsState.runPull` already guarantees by resolving-then-announcing before `remote.run`).
 *
 * The popover's own "Default" row previews the ladder's live resolution (`previewPullStrategy`)
 * the moment it opens — a read, not a commitment — so a user who has never run Pull this session
 * still sees "rebase, from your pull.rebase setting" before choosing anything.
 */

import type { PullStrategy, PullStrategySource } from '@kira/git-ipc';
import CodiconIcon from '@theme/CodiconIcon.vue';
import { Button } from '@theme/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@theme/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@theme/components/ui/tooltip';
import { computed, ref, watch } from 'vue';
import type { MenuSection } from '../lib/menuModel.ts';
import type { OpsState } from '../state/ops.ts';
import MenuSections from './MenuSections.vue';
import { describePullStrategySource, PULL_STRATEGY_LABELS } from './pullStrategyModel.ts';

const props = defineProps<{
  ops: OpsState;
  remote: string;
  branch: string;
  disabled: boolean;
}>();

const isOpen = ref(false);
const preview = ref<{ strategy: PullStrategy; source: PullStrategySource } | undefined>(undefined);
const previewLoading = ref(false);

const lastRun = computed(() => props.ops.pullStrategy.value);
const mainLabel = computed(() => 'Pull');
const mainTitle = computed(() => {
  const last = lastRun.value;
  return last
    ? `Pull — last ran ${PULL_STRATEGY_LABELS[last.strategy]} (${describePullStrategySource(last.source)})`
    : 'Pull — resolves a strategy from your git configuration before running (§7.3)';
});

const STRATEGIES: readonly PullStrategy[] = ['ff-only', 'merge', 'rebase'];
const DEFAULT_ID = 'pull-strategy-default';

// G34 D8: driving `MenuSections` — one section, "Follow your configuration" (the live-resolved
// preview as its `detail` line) plus the three explicit strategies. Row ids double as their own
// `data-testid` (MenuSections derives one from the other), so `pull-strategy-default`/
// `pull-strategy-<strategy>` are unchanged from before this adoption.
const menuSections = computed<MenuSection[]>(() => [
  {
    items: [
      {
        id: DEFAULT_ID,
        label: 'Follow your configuration',
        disabled: false,
        disabledReason: undefined,
        detail: previewLoading.value
          ? 'resolving…'
          : preview.value
            ? `${PULL_STRATEGY_LABELS[preview.value.strategy]} — ${describePullStrategySource(preview.value.source)}`
            : undefined,
      },
      ...STRATEGIES.map((strategy) => ({
        id: `pull-strategy-${strategy}`,
        label: PULL_STRATEGY_LABELS[strategy],
        disabled: false,
        disabledReason: undefined,
      })),
    ],
  },
]);

function onMenuSelect(id: string): void {
  if (id === DEFAULT_ID) {
    void runDefault();
    return;
  }
  const strategy = id.slice('pull-strategy-'.length) as PullStrategy;
  void runWith(strategy);
}

function close(): void {
  isOpen.value = false;
}

// Drops a slow preflight answer that no longer matches the current open/branch.
let previewSeq = 0;

async function onOpenChange(value: boolean): Promise<void> {
  isOpen.value = value;
  if (!value) return;
  const seq = ++previewSeq;
  previewLoading.value = true;
  try {
    const pre = await props.ops.previewPullStrategy(props.branch);
    if (seq === previewSeq && pre) preview.value = { strategy: pre.strategy, source: pre.source };
  } catch {
    // The preview is a hint only; without it the item shows no detail and Pull still works.
  } finally {
    if (seq === previewSeq) previewLoading.value = false;
  }
}

watch(
  () => props.branch,
  () => {
    previewSeq++;
    previewLoading.value = false;
    preview.value = undefined;
  },
);

async function runDefault(): Promise<void> {
  close();
  await props.ops.runPull(props.remote, props.branch);
}

async function runWith(strategy: PullStrategy): Promise<void> {
  close();
  await props.ops.runPull(props.remote, props.branch, strategy);
}

// G10 D17: forwarded so App.vue's palette dispatcher's `pull` action reaches the same default-
// strategy path the toolbar's own Pull button click does.
defineExpose({ run: runDefault });
</script>

<template>
  <div class="relative inline-flex">
    <Tooltip>
      <TooltipTrigger as-child>
        <Button
          variant="toolbar"
          size="kira"
          class="rounded-r-none"
          :disabled="disabled"
          data-testid="pull-button"
          @click="runDefault"
        >
          <CodiconIcon name="repo-pull" :size="13" />
          {{ mainLabel }}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{{ mainTitle }}</TooltipContent>
    </Tooltip>

    <DropdownMenu :open="isOpen" @update:open="onOpenChange">
      <DropdownMenuTrigger as-child>
        <Button
          variant="toolbar"
          size="kira-icon"
          class="rounded-l-none border-l-0 px-0.5"
          :disabled="disabled"
          aria-label="Pull strategy options"
          data-testid="pull-strategy-trigger"
        >
          <CodiconIcon name="chevron-down" :size="13" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" class="w-65" aria-label="Pull strategy">
        <MenuSections :sections="menuSections" @select="onMenuSelect" />
      </DropdownMenuContent>
    </DropdownMenu>
  </div>
</template>
