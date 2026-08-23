<script setup lang="ts">
import Codicon from '../Codicon.vue';

// P1. Every other native attribute (disabled, title, aria-label, data-testid, @click, class)
// reaches the <button> by fallthrough — nothing here restates what the element already does.
withDefaults(
  defineProps<{
    icon: string;
    size?: number;
    active?: boolean;
    tone?: 'default' | 'danger';
  }>(),
  { size: 14, active: false, tone: 'default' },
);
</script>

<template>
  <button
    type="button"
    class="p-iconbtn"
    :class="{ 'is-active': active }"
    :style="tone === 'danger' ? { color: 'var(--kira-error)' } : undefined"
  >
    <Codicon :name="icon" :size="size" />
  </button>
</template>
