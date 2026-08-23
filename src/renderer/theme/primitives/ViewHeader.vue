<script setup lang="ts">
import type { ConnectionColor } from '@shared/domain/connection';
import { computed } from 'vue';
import Codicon from '../Codicon.vue';

// P16 design system: "every non-grid view opens with this" 28px identity band — a connection
// dot, an icon, a target (optional dimmed path prefix + name), then badges, then a trailing
// slot pushed to the right. The grid (Main.html) has no view-head; it opens straight on its
// toolbar, so DataView.vue doesn't use this component.
const props = defineProps<{
  icon: string;
  iconColor?: string;
  path?: string;
  name: string;
  connColor?: ConnectionColor | null;
  // Per-view data-testid hooks: several views assert on the target text via a Playwright
  // data-testid that predates this shared component. targetTestid covers the whole
  // path+name span (most views); nameTestid scopes to just the name when a view's test
  // asserts on the name alone, excluding a non-empty path prefix (e.g. StreamView).
  targetTestid?: string;
  nameTestid?: string;
}>();

const railStyle = computed(() => ({
  '--kira-rail': props.connColor ? `var(--kira-conn-${props.connColor})` : undefined,
}));
</script>

<template>
  <div class="p-view-head">
    <span v-if="connColor !== undefined" class="p-conn-dot" :class="{ none: !connColor }" :style="railStyle" />
    <span class="icon-box" :style="iconColor ? { color: iconColor } : undefined">
      <Codicon :name="icon" :size="14" />
    </span>
    <span class="p-view-target" :data-testid="targetTestid">
      <span v-if="path" class="path">{{ path }}</span
      ><span v-if="nameTestid" :data-testid="nameTestid">{{ name }}</span
      ><template v-else>{{ name }}</template>
    </span>
    <slot />
    <span class="p-push" style="display: flex; align-items: center; gap: var(--kira-s-2)">
      <slot name="trailing" />
    </span>
  </div>
</template>
