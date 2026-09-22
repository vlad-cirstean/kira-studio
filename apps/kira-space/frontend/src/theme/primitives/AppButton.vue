<script setup lang="ts">
import { cva } from 'class-variance-authority';
import CodiconIcon from '../CodiconIcon.vue';

// P2 (kind="toolbar", h-sm, the default) and P3 (kind="dialog", h-md, the only bordered
// button) share this one component since their slot shape is identical — only the primitive
// class and height differ. The icon, when given, always sits in an icon-box (LAW: icons never
// float unboxed next to text).
//
// Internals moved onto class-variance-authority (P99 Part 2, §6.2) — the geometry stays the
// design system's own runtime-adjustable tokens (--kira-control-h etc., via arbitrary-value
// utilities) rather than shadcn's own generated buttonVariants scale, whose fixed h-8/h-7 sizes
// would shift every button's height/padding against those tokens (a real visual regression, not
// a chrome update). `.p-btn`/`.p-dlgbtn` stay on the element as markers — font-roles.spec.ts and
// api-ui-consistency.spec.ts select on them (§9.2).
const button = cva(
  'inline-flex items-center gap-[var(--kira-s-2)] rounded-kira-sm text-[length:var(--kira-t-sm)] cursor-pointer shrink-0 disabled:text-disabled disabled:cursor-default',
  {
    variants: {
      kind: {
        toolbar:
          'h-[var(--kira-control-h)] px-[var(--kira-s-3)] text-muted hover:bg-hover hover:text-fg',
        dialog:
          'h-[var(--kira-control-h-lg)] justify-center px-[var(--kira-s-5)] border border-border-strong bg-input text-fg',
      },
      primary: {
        true: '',
        false: '',
      },
      active: {
        true: 'bg-input text-fg',
        false: '',
      },
    },
    compoundVariants: [
      {
        kind: 'toolbar',
        primary: true,
        class: 'bg-accent text-accent-fg hover:bg-accent hover:text-accent-fg disabled:text-accent-fg disabled:opacity-45',
      },
      {
        kind: 'dialog',
        primary: true,
        class: 'bg-accent border-accent text-accent-fg disabled:opacity-45',
      },
    ],
    defaultVariants: { kind: 'toolbar', primary: false, active: false },
  },
);

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
      button({ kind, primary: variant === 'primary', active }),
      variant === 'danger' && 'text-error',
    ]"
  >
    <span v-if="icon" class="icon-box"><CodiconIcon :name="icon" :size="13" /></span>
    <slot />
    <span v-if="count !== undefined" class="p-count">{{ count }}</span>
  </button>
</template>
