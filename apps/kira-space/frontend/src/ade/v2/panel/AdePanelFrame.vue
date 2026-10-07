<script setup lang="ts">
import { Tabs, TabsList, TabsTrigger, tabChipVariants } from '@theme/components/ui/tabs';
import PanelHeader from '@workbench/components/PanelHeader.vue';

// Panel body shared by task and branch mode: the panel header, a summary slot, the tab strip, then the active tab.
defineProps<{ title: string; tabs: { value: string; label: string }[] }>();
const tab = defineModel<string>({ required: true });
</script>

<template>
  <Tabs v-model="tab" class="flex min-h-0 flex-1 flex-col gap-0">
    <PanelHeader>
      {{ title }}
      <template #actions><slot name="actions" /></template>
    </PanelHeader>
    <div class="flex shrink-0 flex-col gap-1.5 border-b border-border px-3 py-2" data-testid="ade-panel-head">
      <slot name="header" />
    </div>
    <TabsList class="w-full shrink-0 justify-start border-b border-border px-1.5 py-1">
      <TabsTrigger
        v-for="t in tabs"
        :key="t.value"
        :value="t.value"
        :class="tabChipVariants({ active: tab === t.value })"
        :data-testid="`ade-panel-tab-${t.value}`"
      >
        {{ t.label }}
      </TabsTrigger>
    </TabsList>
    <slot />
  </Tabs>
</template>
