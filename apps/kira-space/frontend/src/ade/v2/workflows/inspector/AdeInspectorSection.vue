<script setup lang="ts">
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@theme/components/ui/collapsible';
import { usePersistedState } from '@workbench/behaviour/persisted';

const props = defineProps<{ title: string; name: string; collapsible?: boolean }>();
const open = usePersistedState(`ade.wf.inspector.${props.name}`, false);
</script>

<template>
  <Collapsible
    v-if="collapsible"
    v-model:open="open"
    class="flex flex-col gap-2 border-t pt-2"
    :data-testid="`ade-wf-step-section-${name}`"
  >
    <CollapsibleTrigger
      class="flex items-center gap-1 text-left text-kira-sm font-medium text-muted-foreground"
      :data-testid="`ade-wf-step-${name}`"
    >
      {{ open ? '▾' : '▸' }} {{ title }}
    </CollapsibleTrigger>
    <CollapsibleContent class="flex flex-col gap-3">
      <slot />
    </CollapsibleContent>
  </Collapsible>
  <section
    v-else
    class="flex flex-col gap-2 border-t pt-2"
    :data-testid="`ade-wf-step-section-${name}`"
  >
    <div class="text-kira-sm font-medium text-muted-foreground">{{ title }}</div>
    <slot />
  </section>
</template>
