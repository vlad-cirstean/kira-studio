<script setup lang="ts">
import CodiconIcon from '@theme/CodiconIcon.vue';

// P1. Every other native attribute (disabled, title, aria-label, data-testid, @click, class)
// reaches the <button> by fallthrough — nothing here restates what the element already does.
//
// Styling moved onto Tailwind utilities (P99 Part 2, §6.2); `.p-iconbtn`/`.p-count` stay as
// markers (§9.2) — tree.spec.ts selects `.icon-box`, and callers grep `.p-iconbtn` in
// api-ui-consistency.spec.ts.
withDefaults(
  defineProps<{
    icon: string;
    size?: number;
    active?: boolean;
    tone?: 'default' | 'danger' | 'primary';
    /** A small corner badge (a live count, e.g. "5/12") — for an icon-only toolbar button that
     * still needs to surface a number without falling back to a text label. */
    count?: string | number;
    /** P31 D38: a plain 5px accent dot in the button's top-right corner — for a button whose
     * "is this active/filtering?" state needs surfacing without a number to show for it (the
     * exact counts belong in the button's own tooltip instead). Mutually exclusive with `count`
     * in practice, though nothing here enforces that. */
    indicator?: boolean;
  }>(),
  { size: 13, active: false, tone: 'default', indicator: false },
);
</script>

<template>
  <button
    type="button"
    class="p-iconbtn relative inline-flex h-[var(--kira-control-h)] w-[var(--kira-control-h)] shrink-0 cursor-pointer items-center justify-center rounded-kira-sm text-muted hover:bg-hover hover:text-fg disabled:cursor-default disabled:text-disabled"
    :class="[
      { 'is-active': active },
      active && 'bg-input text-fg',
      tone === 'primary' && 'bg-accent text-accent-fg hover:bg-accent hover:text-accent-fg disabled:text-accent-fg disabled:opacity-45',
      tone === 'danger' && 'text-error',
    ]"
  >
    <CodiconIcon :name="icon" :size="size" />
    <span
      v-if="count !== undefined"
      class="p-count absolute top-1/2 -right-1.5 h-3.5 min-w-3.5 -translate-y-1/2 whitespace-nowrap px-[3px] text-[length:var(--kira-t-xs)]"
      >{{ count }}</span
    >
    <span
      v-if="indicator"
      class="absolute top-0.5 right-0.5 h-[5px] w-[5px] rounded-full bg-[var(--kira-state-on)]"
    />
  </button>
</template>
