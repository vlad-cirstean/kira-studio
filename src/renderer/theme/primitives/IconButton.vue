<script setup lang="ts">
import CodiconIcon from '../CodiconIcon.vue';

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
    <CodiconIcon :name="icon" :size="size" />
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
  /* Anchored to the button's own right edge, vertically centred rather than pinned to the top —
     a `top: -4px` offset used to push this outside a short toolbar's own bounds (the reported
     "indicator floats above the toolbar" bug), since the button sits flush against the toolbar's
     top edge and had no room above it to poke into. */
  top: 50%;
  right: -6px;
  transform: translateY(-50%);
  height: 14px;
  min-width: 14px;
  font-size: 9px;
  padding: 0 3px;
  /* Without this, a multi-word count (ColumnsMenu's "N / M" — the only current `:count` value
     with a space in it) wraps across two lines: as an absolutely-positioned element offset only
     by `right`, this badge's `width: auto` shrink-to-fits against the icon button's own ~22px
     box, not the viewport, so "5 / 5" broke onto "5 /" + "5" and turned this fixed 14px-tall pill
     into a taller, garbled shape overlapping the button's corner — the reported "Columns button
     is vertical" bug. Every other `:count` consumer is a single unbroken token (e.g. "42",
     "~1,234"), which never wrapped, so nowrap changes nothing for them. */
  white-space: nowrap;
}
</style>
