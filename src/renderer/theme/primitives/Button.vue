<script setup lang="ts">
import Codicon from '../Codicon.vue';

// P2 (kind="toolbar", h-sm, the default) and P3 (kind="dialog", h-md, the only bordered
// button) share this one component since their slot shape is identical — only the primitive
// class and height differ. The icon, when given, always sits in an icon-box (LAW: icons never
// float unboxed next to text).
withDefaults(
  defineProps<{
    icon?: string;
    variant?: 'default' | 'primary' | 'danger';
    kind?: 'toolbar' | 'dialog';
    active?: boolean;
    count?: string | number;
  }>(),
  { variant: 'default', kind: 'toolbar', active: false },
);
</script>

<template>
  <button
    type="button"
    :class="[
      kind === 'dialog' ? 'p-dlgbtn' : 'p-btn',
      { primary: variant === 'primary', 'is-active': active },
    ]"
    :style="variant === 'danger' ? { color: 'var(--kira-error)' } : undefined"
  >
    <span v-if="icon" class="icon-box"><Codicon :name="icon" :size="14" /></span>
    <slot />
    <span v-if="count !== undefined" class="p-count">{{ count }}</span>
  </button>
</template>
