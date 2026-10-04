<script setup lang="ts">
import { Tabs, TabsList, TabsTrigger } from '@theme/components/ui/tabs';
import { ref } from 'vue';
import AdeAddPopover from '../AdeAddPopover.vue';
import AdePlanView from '../plan/AdePlanView.vue';
import { TONE } from '../tones';
import AdeCaptureBox from './AdeCaptureBox.vue';

// Top bar (tabs, capture box, Add) over the active tab. Plan is the only tab so far.
const tab = ref('plan');
</script>

<template>
  <Tabs v-model="tab" class="flex min-h-0 flex-1 flex-col gap-0" data-testid="ade-shell">
    <nav class="flex h-10 shrink-0 items-stretch border-b border-border bg-chrome pl-2">
      <TabsList class="gap-0">
        <TabsTrigger
          value="plan"
          class="h-full cursor-pointer gap-1.5 border-b-2 border-transparent px-3.5 text-kira-lg text-muted-foreground data-[state=active]:font-semibold data-[state=active]:text-fg"
          :style="tab === 'plan' ? { borderBottomColor: TONE.amber[2] } : undefined"
          data-testid="ade-tab-plan"
        >
          Plan
        </TabsTrigger>
      </TabsList>
      <span class="flex-1" />
      <div class="flex items-center gap-2 px-3">
        <AdeCaptureBox />
        <AdeAddPopover />
      </div>
    </nav>
    <AdePlanView v-if="tab === 'plan'" />
  </Tabs>
</template>
