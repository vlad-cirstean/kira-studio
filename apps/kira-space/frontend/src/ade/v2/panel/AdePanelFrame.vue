<script setup lang="ts">
import { Tabs, TabsList, TabsTrigger, tabChipVariants } from '@theme/components/ui/tabs';

// Panel body shared by task and branch mode: a header slot, the tab strip, then the active tab.
defineProps<{ tabs: { value: string; label: string }[] }>();
const tab = defineModel<string>({ required: true });
</script>

<template>
  <Tabs v-model="tab" class="flex min-h-0 flex-1 flex-col gap-0">
    <div class="flex shrink-0 flex-col gap-[5px] border-b border-border px-3.5 pb-2.5 pt-3" data-testid="ade-panel-head">
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
