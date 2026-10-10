<script setup lang="ts">
import SecondaryTabs from '@theme/components/SecondaryTabs.vue';
import PanelBar from '@workbench/components/PanelBar.vue';
import PanelHeader from '@workbench/components/PanelHeader.vue';
import { computed } from 'vue';

// Panel body shared by task and branch mode: the panel header, a summary slot, the tab strip, then the active tab.
const props = defineProps<{ title: string; tabs: { value: string; label: string }[] }>();
const items = computed(() => props.tabs.map((t) => ({ ...t, testid: `ade-panel-tab-${t.value}` })));
const tab = defineModel<string>({ required: true });
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <PanelHeader>
      {{ title }}
      <template #actions><slot name="actions" /></template>
    </PanelHeader>
    <div class="flex shrink-0 flex-col gap-1.5 border-b border-border px-3 py-2" data-testid="ade-panel-head">
      <slot name="header" />
    </div>
    <PanelBar>
      <SecondaryTabs v-model="tab" :items="items" />
    </PanelBar>
    <slot />
  </div>
</template>
