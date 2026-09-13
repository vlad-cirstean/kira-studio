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
import type { MenuSection } from '@kira/kira-ui';
// `KuiMenuList` is a plain (not `import type`) import even though this file's own script only
// ever reads it through `InstanceType<typeof KuiMenuList>` — that is still a genuine *value* read
// (`typeof` on an identifier requires the runtime binding in scope), and the template's own
// `<KuiMenuList>` tag instantiates it as a component; biome's own static analysis sees neither use
// and would otherwise "fix" this to `import type`, silently erasing the import (AppToolbar.vue's
// own `useImportType` biome-ignore precedent, for the same reason).
// biome-ignore lint/style/useImportType: see above
import { KuiButton, KuiMenuList, KuiPopoverPanel } from '@kira/kira-ui';
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import type { OpsState } from '../state/ops.ts';
import { describePullStrategySource, PULL_STRATEGY_LABELS } from './pullStrategyModel.ts';

const props = defineProps<{
  ops: OpsState;
  remote: string;
  branch: string;
  disabled: boolean;
}>();

const isOpen = ref(false);
const rootEl = ref<HTMLElement | null>(null);
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
const menuListRef = ref<InstanceType<typeof KuiMenuList> | null>(null);

// G34 D8: driving `<KuiMenuList>` — one section, "Follow your configuration" (the live-resolved
// preview as its `detail` line) plus the three explicit strategies. Row ids double as their own
// `data-testid` (KuiMenuList derives one from the other), so `pull-strategy-default`/
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

function onDocumentClick(event: MouseEvent): void {
  if (rootEl.value && !rootEl.value.contains(event.target as Node)) close();
}

function close(): void {
  isOpen.value = false;
  document.removeEventListener('mousedown', onDocumentClick);
}

async function toggle(): Promise<void> {
  if (isOpen.value) {
    close();
    return;
  }
  isOpen.value = true;
  document.addEventListener('mousedown', onDocumentClick);
  await nextTick();
  menuListRef.value?.focusFirst();
  previewLoading.value = true;
  try {
    const pre = await props.ops.previewPullStrategy(props.branch);
    if (pre) preview.value = { strategy: pre.strategy, source: pre.source };
  } finally {
    previewLoading.value = false;
  }
}

watch(
  () => props.branch,
  () => {
    preview.value = undefined;
  },
);

onBeforeUnmount(() => {
  document.removeEventListener('mousedown', onDocumentClick);
});

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
  <div ref="rootEl" class="kv-pull-picker">
    <KuiButton
      icon="codicon-repo-pull"
      class="kv-pull-picker-main"
      :disabled="disabled"
      v-kui-tooltip="mainTitle"
      data-testid="pull-button"
      @click="runDefault"
    >
      {{ mainLabel }}
    </KuiButton>
    <KuiButton
      icon="codicon-chevron-down"
      class="kv-pull-picker-chevron"
      :disabled="disabled"
      aria-label="Pull strategy options"
      :aria-expanded="isOpen"
      data-testid="pull-strategy-trigger"
      @click="toggle"
    />

    <KuiPopoverPanel v-if="isOpen" anchor="left" :width="260" @close="close">
      <KuiMenuList
        ref="menuListRef"
        :sections="menuSections"
        label="Pull strategy"
        @select="onMenuSelect"
        @close="close"
      />
    </KuiPopoverPanel>
  </div>
</template>

<style>
/* G19 D3a: the trigger's own look now comes from @kira/kira-ui's KuiButton (matching
   `AppToolbar.vue`'s own Fetch/Push buttons) — the `.kv-toolbar-button` rule that used to be
   defined identically in both files is closed at its source, not restyled around. */
.kv-pull-picker {
  position: relative;
  display: inline-flex;
}

.kv-pull-picker-main {
  border-top-right-radius: 0;
  border-bottom-right-radius: 0;
}

.kv-pull-picker-chevron {
  padding: 0 var(--kv-s-1);
  border-left: none;
  border-top-left-radius: 0;
  border-bottom-left-radius: 0;
}

/* G34 D8: `.kv-pull-picker-panel`/`.kv-pull-picker-item*` are gone — the popover now wraps a
   `<KuiMenuList>`, the same menu a right-click renders, instead of a hand-rolled one. */
</style>
