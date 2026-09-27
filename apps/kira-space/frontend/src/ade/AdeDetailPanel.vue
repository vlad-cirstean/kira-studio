<script setup lang="ts">
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@theme/components/ui/tabs';
import { computed } from 'vue';
import AdeChangesTab from './AdeChangesTab.vue';
import AdeDetailsTab from './AdeDetailsTab.vue';
import AdePanelHeader from './AdePanelHeader.vue';
import type { DialogCtx } from './dialogCompose';
import { useAdeUiStore } from './state/adeUi';
import type { QueueItem, QueuePanel } from './useQueue';
import type { AdeRepoPrs } from './wire';

// P129 Part 6 §0.3/§0.22: the panel shell — `<aside>`, header, tab bar (mockup 299-303), tab bodies
// (mockup 305-447). §0.1 "no split": commit 4 wired only Changes; this commit adds Details
// (`AdeDetailsTab`) — Agents lands with its own trigger and body in commit 7, still not as a
// placeholder now.
const props = defineProps<{
  panel: QueuePanel;
  dialogCtx: DialogCtx | null;
  codeRepoId: string;
  itemsById: ReadonlyMap<string, QueueItem>;
  prs: AdeRepoPrs | undefined;
  /** The panel's own effective width in px — already resolved (settings, drag override, clamp) by
   *  `AdeRepoView.vue`, this module's own layout owner (§0.3). */
  width: number;
}>();

const adeUiStore = useAdeUiStore();

const style = computed(() => ({ width: `${props.width}px` }));

function onTabChange(v: string | number): void {
  adeUiStore.setPanelTab(v as 'details' | 'changes' | 'agents');
}
</script>

<template>
  <aside
    class="flex min-h-0 flex-col bg-[#16171b]"
    :style="style"
    data-testid="ade-detail-panel"
  >
    <AdePanelHeader :panel="panel" :dialog-ctx="dialogCtx" :code-repo-id="codeRepoId" />

    <Tabs
      :model-value="adeUiStore.panelTab"
      class="min-h-0 flex-1 gap-0"
      @update:model-value="onTabChange"
    >
      <TabsList
        class="h-[34px] w-full shrink-0 justify-start gap-0 rounded-none border-b border-[#2a2d35] bg-transparent px-2 py-0"
      >
        <TabsTrigger
          value="details"
          data-testid="ade-panel-tab-details"
          class="h-full rounded-none border-b-2 border-transparent px-2.5 text-kira-sm font-medium text-[#9a9ca5] data-[state=active]:border-b-[#e8a33d] data-[state=active]:font-semibold data-[state=active]:text-fg"
        >
          Details
        </TabsTrigger>
        <TabsTrigger
          value="changes"
          data-testid="ade-panel-tab-changes"
          class="h-full rounded-none border-b-2 border-transparent px-2.5 text-kira-sm font-medium text-[#9a9ca5] data-[state=active]:border-b-[#e8a33d] data-[state=active]:font-semibold data-[state=active]:text-fg"
        >
          Changes
        </TabsTrigger>
      </TabsList>

      <TabsContent value="details" class="flex min-h-0 flex-1 flex-col">
        <AdeDetailsTab :panel="panel" :prs="prs" :code-repo-id="codeRepoId" />
      </TabsContent>
      <TabsContent value="changes" class="flex min-h-0 flex-1 flex-col">
        <AdeChangesTab :changes="panel.changes" :items-by-id="itemsById" />
      </TabsContent>
    </Tabs>
  </aside>
</template>
