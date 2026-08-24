<script setup lang="ts">
import type { ConnectionColor, ConnectionKind } from '@shared/domain/connection';
import { computed } from 'vue';
import CodiconIcon from '../CodiconIcon.vue';
import { connColorVar } from '../connColor';
import EngineIcon from '../EngineIcon.vue';

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
  /** The connection's engine — every data view's target starts with this, ahead of the
   * view-specific object icon, so which vendor a tab belongs to is never a guess. */
  connKind?: ConnectionKind;
  // Per-view data-testid hooks: several views assert on the target text via a Playwright
  // data-testid that predates this shared component. targetTestid covers the whole
  // path+name span (most views); nameTestid scopes to just the name when a view's test
  // asserts on the name alone, excluding a non-empty path prefix (e.g. StreamView).
  targetTestid?: string;
  nameTestid?: string;
}>();

const railStyle = computed(() => ({ '--kira-rail': connColorVar(props.connColor) }));
const isNoColor = computed(() => !props.connColor || props.connColor === 'none');
</script>

<template>
  <div class="p-view-head">
    <span v-if="connColor !== undefined" class="p-conn-dot" :class="{ none: isNoColor }" :style="railStyle" />
    <span v-if="connKind" class="icon-box">
      <EngineIcon :kind="connKind" :size="14" />
    </span>
    <span class="icon-box" :style="iconColor ? { color: iconColor } : undefined">
      <CodiconIcon :name="icon" :size="14" />
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
