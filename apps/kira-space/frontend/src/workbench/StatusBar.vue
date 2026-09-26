<script setup lang="ts">
import CodiconIcon from '@theme/CodiconIcon.vue';
import {
  Tooltip,
  TooltipContent,
  TooltipDisabledTrigger,
  TooltipTrigger,
} from '@theme/components/ui/tooltip';
import AppMetricsItem from '@workbench/components/AppMetricsItem.vue';
import StatusBarBase from '@workbench/components/StatusBar.vue';
import UpdateAvailableItem from '@workbench/components/UpdateAvailableItem.vue';
import { computed } from 'vue';
import { useAppMetricsStore } from '../state/appMetrics';
import { useAppUpdateStore } from '../state/appUpdate';
import { useBlameStatusStore } from '../state/blameStatus';
import { blameLineText, blameLineTooltip } from '../views/repo/blameLine';

// P103 Part 2 (§5.4): Kira Studio's own workbench/StatusBar.vue, trimmed to the blame item (P76
// §5.2) beside the shared caret-status slot. Now a thin composition over the shared bar chrome
// (packages/workbench/src/components/StatusBar.vue). P116 G7 adds the app-metrics item back —
// AppMetricsItem.vue, shared with Kira Studio's own copy of this file. P119 adds the update item,
// same shared component (UpdateAvailableItem.vue) and the same in-app dialog Kira Studio's own
// copy opens.
const blameStatusStore = useBlameStatusStore();
const appMetricsStore = useAppMetricsStore();
const appUpdateStore = useAppUpdateStore();

// P76 §5.2: 'none' and 'uncommitted' both render nothing — an always-present "Uncommitted" readout
// is the extension's own choice; this bar hides items with nothing to say instead.
const blame = computed(() =>
  blameStatusStore.status.kind === 'resolved' ? blameStatusStore.status : null,
);
const blameText = computed(() => (blame.value ? blameLineText(blame.value) : ''));
const blameTooltip = computed(() => (blame.value ? blameLineTooltip(blame.value).join(' — ') : ''));

function onRevealBlameCommit(): void {
  if (blame.value) blameStatusStore.reveal?.(blame.value.sha);
}
</script>

<template>
  <StatusBarBase>
    <template #left-extra>
      <!-- P76 §5.2: a sibling fact, not the caret-status slot — that readout stays unwired. -->
      <Tooltip v-if="blame">
        <TooltipTrigger as-child>
          <TooltipDisabledTrigger>
            <button
              type="button"
              class="h-control-sm inline-flex items-center gap-1 px-1.5 rounded-kira-sm text-fg cursor-pointer border-0 bg-none hover:bg-hover disabled:cursor-default"
              data-testid="blame-status"
              :disabled="!blameStatusStore.reveal"
              @click="onRevealBlameCommit"
            >
              <CodiconIcon name="git-commit" :size="13" />
              <span class="max-w-80 overflow-hidden text-ellipsis whitespace-nowrap">{{ blameText }}</span>
            </button>
          </TooltipDisabledTrigger>
        </TooltipTrigger>
        <TooltipContent>{{ blameTooltip }}</TooltipContent>
      </Tooltip>
    </template>
    <template #right>
      <UpdateAvailableItem
        v-if="appUpdateStore.available"
        :latest-version="appUpdateStore.latestVersion"
        :current-version="appUpdateStore.currentVersion"
        @open="appUpdateStore.openUpdateDialog()"
      />
      <AppMetricsItem :sample="appMetricsStore.sample" />
    </template>
    <!-- P110 I2-19 (§3.5.3): `.blame`'s font: inherit + color/disabled rules, and `.blame-text`'s
         truncation, folded onto the button/span above -- Preflight already sets `font: inherit` on
         every <button>, so `text-kira-sm` was redundant with what the button already inherits and
         was dropped; `text-fg` and `disabled:cursor-default` stay explicit (a plain <button> resets
         color to black otherwise). Measured getComputedStyle(button) on `[data-testid="blame-
         status"]` before/after: fontSize 12px -> 12px, fontFamily unchanged, color rgb(204, 204,
         204) -> rgb(204, 204, 204) (text-fg). max-w-80 (320px): ~48ch in the body's system-ui font
         at the 12px default, the nearest default step. -->
  </StatusBarBase>
</template>
