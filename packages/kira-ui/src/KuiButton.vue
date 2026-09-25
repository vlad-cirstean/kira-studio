<script setup lang="ts">
/**
 * G19 D3a: generalises `apps/kira-studio/frontend`'s own `AppButton.vue` shape — an icon-box, a
 * default slot, an optional count badge, a `variant`, an `active` state — for
 * `packages/git-ui`'s own toolbar/menu buttons. One size only, driven by `--kui-control-h`; no
 * `kind: 'toolbar' | 'dialog'` distinction (that was Kira-Studio-specific sizing this package's
 * one consumer does not need).
 *
 * P110 A3: `kuiButtonVariants` (shadcn's own extension-point pattern, `theme/components/ui/
 * button/index.ts`'s own `cva`) replaces `theme/controls.css`'s `.kui-button`/`.kui-button--*`
 * rules. `class` is now a declared prop — not left to fall through — so `cn()` can merge it
 * against the base/variant classes instead of Vue's default class-merge just concatenating both
 * (which would leave e.g. a passed-in `px-0` alongside the base's own padding rather than
 * replacing it; §1.3's "through cn()" rule). Every other un-declared attribute (`disabled`,
 * `title`, `aria-label`, `data-testid`, `@click`…) still falls through to the root `<button>`
 * exactly as before.
 *
 * `min-h-kui-control`, not a fixed height: `BranchPicker.vue` passes `class="kui-row …"` down into
 * this component (a row-shaped button whose content may wrap to a second line) — the old
 * `.kui-button.kui-row { height: auto }` compound override existed only to cancel `.kui-button`'s
 * own *fixed* height for exactly that composition. A `min-height` here needs no such override:
 * every ordinary (non-row) button's content is one line well under `--kui-control-h`, so it still
 * renders at exactly that height, and a row composed alongside `.kui-row`'s own `min-height` can
 * still grow past it. Pixel-identical for every existing single-line button.
 */
import { cva, type VariantProps } from 'class-variance-authority';
import type { ClassValue } from 'clsx';
import { ref } from 'vue';
import { cn } from './cn.ts';
import KuiIconBox from './KuiIconBox.vue';

const kuiButtonVariants = cva(
  // Base = today's `.kui-button` rule. `font-inherit` (P110 I2-28, GU/theme/tailwind.css's
  // registered `--font-inherit: inherit`): this package's build has no preflight
  // (git-ui/theme/tailwind.css, A1), so a raw `<button>` needs it stated explicitly — otherwise
  // the standalone VS Code webview (no host preflight either) would show the platform's
  // form-control font instead of inheriting Kira's, same reasoning as the explicit `py-0` below.
  'kv:inline-flex kv:items-center kv:gap-1 kv:min-h-kui-control kv:py-0 kv:px-1.5 kv:bg-transparent kv:text-kui-fg-muted kv:border kv:border-transparent kv:rounded-kui kv:font-inherit kv:text-kui-sm kv:no-underline kv:cursor-pointer kv:shrink-0 kv:enabled:hover:bg-kui-hover kv:enabled:hover:text-kui-fg kv:focus-visible:outline kv:focus-visible:outline-1 kv:focus-visible:outline-kui-focus-border kv:focus-visible:-outline-offset-1 kv:disabled:opacity-60 kv:disabled:cursor-default',
  {
    variants: {
      variant: {
        default: '',
        // `.kui-button--primary` + its own `:hover:not(:disabled)`.
        primary:
          'kv:bg-kui-button kv:text-kui-button-fg kv:border-kui-button kv:enabled:hover:bg-kui-button-hover kv:enabled:hover:border-kui-button-hover',
        // `.kui-button--danger` (border/colour only — hover/active stay the base's own).
        danger: 'kv:text-kui-danger-fg kv:border-kui-danger-fg',
        // `.kui-button--icon`.
        icon: 'kv:w-kui-control kv:px-0 kv:justify-center',
      },
      active: {
        // `.kui-button--active`.
        true: 'kv:bg-kui-active kv:text-kui-fg',
        false: '',
      },
    },
    defaultVariants: { variant: 'default', active: false },
  },
);
type KuiButtonVariants = VariantProps<typeof kuiButtonVariants>;

const props = withDefaults(
  defineProps<{
    icon?: string;
    /** G34 D5: `'ghost'` retired — once the base variant is itself borderless and muted at rest
     *  (Kira's own `.p-btn`, P110 A3's `kuiButtonVariants` base), "ghost" no longer named
     *  anything distinct from the default; it
     *  differed only by `opacity: 0.8`, a worse way of saying "muted" than a colour token is.
     *  `'icon'` is its replacement for the icon-only case: Kira's `.p-iconbtn` — a square at the
     *  control height, no text, no border — and the shape every hand-rolled icon-button
     *  implementation in `packages/git-ui` collapsed onto (G34 D14). */
    variant?: NonNullable<KuiButtonVariants['variant']>;
    active?: boolean;
    count?: number;
    // `ClassValue`, not `string`: a caller may pass an object/array binding (`RefreshButton.vue`'s
    // own `:class="{ 'kv-refresh-spinning': isRefreshing }"`), same as any plain element's `class`.
    class?: ClassValue;
  }>(),
  { variant: 'default', active: false },
);

// G34 D5/D14: a plain DOM ref plus `defineExpose`, the same escape hatch `KuiSearchInput` already
// exposes for the identical structural problem — a caller cannot otherwise reach the root DOM
// node of a `<script setup>` component. This is what lets `BranchPicker.vue`'s last raw
// `<button>` become a real `KuiButton` (its trigger needs `.focus()` to return focus on close).
const buttonEl = ref<HTMLButtonElement | null>(null);
defineExpose({
  focus: () => buttonEl.value?.focus(),
});
</script>

<template>
  <button
    ref="buttonEl"
    type="button"
    :class="cn(kuiButtonVariants({ variant, active }), props.class)"
  >
    <KuiIconBox v-if="icon" :icon="icon" />
    <slot />
    <span
      v-if="count !== undefined"
      class="kv:inline-flex kv:items-center kv:justify-center kv:min-w-kui-control-sm kv:h-kui-control-sm kv:px-0.75 kv:rounded-full kv:bg-kui-selected kv:text-kui-selected-fg kv:text-[0.75em] kv:leading-kui-control-sm"
      >{{ count }}</span
    >
  </button>
</template>
