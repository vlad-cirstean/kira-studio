<script setup lang="ts">
import Codicon from '../Codicon.vue';

// P1. Every other native attribute (disabled, title, aria-label, data-testid, @click, class)
// reaches the <button> by fallthrough — nothing here restates what the element already does.
withDefaults(
  defineProps<{
    icon: string;
    size?: number;
    active?: boolean;
    tone?: 'default' | 'danger' | 'primary';
    /** A small corner badge (a live count, e.g. "5/12") — for an icon-only toolbar button that
     * still needs to surface a number without falling back to a text label. */
    count?: string | number;
  }>(),
  { size: 14, active: false, tone: 'default' },
);
</script>

<template>
  <button
    type="button"
    class="p-iconbtn"
    :class="{ 'is-active': active, 'is-primary': tone === 'primary' }"
    :style="tone === 'danger' ? { color: 'var(--kira-error)' } : undefined"
  >
    <Codicon :name="icon" :size="size" />
    <span v-if="count !== undefined" class="p-count corner-count">{{ count }}</span>
  </button>
</template>

<style scoped>
.p-iconbtn {
  position: relative;
}

.p-iconbtn.is-primary {
  background: var(--kira-accent);
  color: var(--kira-accent-fg);
}

.corner-count {
  position: absolute;
  top: -4px;
  right: -4px;
  height: 14px;
  min-width: 14px;
  font-size: 9px;
  padding: 0 3px;
}
</style>
