<script setup lang="ts">
/**
 * G19 D3b: promoted from `packages/git-ui/src/components/RowContextMenu.vue` — its ARIA `menu`/
 * `menuitem` semantics, full keyboard roving focus, and focus-capture-and-return were already
 * correct there (F3); this is a move to a shared, host-agnostic home, generalised to render an
 * icon-box per row and a `danger` variant, not a rewrite of the interaction logic itself.
 *
 * G34 D8: reduced to point-anchored positioning, the outside-click backdrop, and focus-capture-
 * and-return, wrapping `KuiMenuList.vue` — which now owns everything about *rendering* a menu
 * (rows, sections, keyboard nav; see that file). This component's own public API — every prop,
 * every emit — is unchanged, so `RowContextMenu.vue` and all its consumers need zero edits.
 *
 * Owns no global singleton — each instance is created and destroyed by its caller, exactly as
 * `RowContextMenu.vue` already did. Submenus are explicitly not included (D3's own non-goal) —
 * nothing in `packages/git-ui`'s own menus needs one.
 *
 * P110 A5: controls.css's `.kui-menu-root` replaced by `kv:` utilities on this component's own
 * positioned surface — the one class exclusively this component's (`.kui-menu-list` is
 * `KuiMenuList`'s own root, converted there instead). `z-[var(--kui-z-menu,30)]`/
 * `max-h-[var(--kui-float-max-h,none)]` stay arbitrary values (§1.1 rung 4): both read a raw
 * `--kui-*` custom property with its own fallback, not a value on any Tailwind scale, and neither
 * is reused anywhere else in this package's own build (KuiTooltip/KuiPopoverPanel/KuiDialog each
 * have their own distinct `.kui-tooltip`/`.kui-popover`/`.kui-modal` class, A6). `min-w-45`/
 * `max-w-80` are the default numeric spacing scale instead (180px/320px = 45/80 × the kept 4px
 * `--spacing` step, rung 1) — no new token needed for a literal pixel size already on that scale.
 * `.kui-menu-root-wrap` carries no rule of its own (a pure `onClickOutside` ref anchor) and is
 * left as-is.
 */
import { onClickOutside } from '@vueuse/core';
import { onBeforeUnmount, onMounted, ref } from 'vue';
import type { MenuSection } from './contextMenuModel.ts';
import { computeFloatPosition, pointReference } from './floatingPosition.ts';
// `KuiMenuList` is a plain (not `import type`) import even though this file's own script only
// ever reads it through `InstanceType<typeof KuiMenuList>` — that is still a genuine *value* read
// (`typeof` on an identifier requires the runtime binding in scope), and the template's own
// `<KuiMenuList>` tag instantiates it as a component; biome's own static analysis sees neither use
// and would otherwise "fix" this to `import type`, silently erasing the import — `biome.json`'s
// own `**/*.vue` override turns `useImportType` off for exactly this class of false positive
// (P96 §5.2).
import KuiMenuList from './KuiMenuList.vue';

const props = defineProps<{
  sections: readonly MenuSection[];
  x: number;
  y: number;
  label: string;
  /** The menu's own accessible name (replacing `label` as `aria-label`) *and* a non-interactive
   *  first line inside it — e.g. a ref-badge menu titled with the branch name so it cannot be
   *  misread. Absent for a menu with no comparable ambiguity. */
  title?: string;
}>();

const emit = defineEmits<{
  (e: 'select', id: string): void;
  (e: 'close'): void;
}>();

const rootEl = ref<HTMLDivElement | null>(null);
const menuEl = ref<HTMLDivElement | null>(null);
const listRef = ref<InstanceType<typeof KuiMenuList> | null>(null);

let invoker: HTMLElement | null = null;

onClickOutside(rootEl, () => emit('close'));

/** G20 D3: positioned via `floatingPosition.ts`'s real `flip`/`shift`/`size` middleware, replacing
 *  the hand-rolled post-mount clamp G19 relocated here verbatim from `RowContextMenu.vue`. Starts
 *  off-screen until measured, avoiding the one-frame flash the old `requestAnimationFrame`/
 *  `Math.min` clamp had (positioning used to happen only after first paint). `flip: true` — a
 *  deliberate divergence from `apps/kira-studio/frontend`'s own `ContextMenu.vue` (`shift`-only):
 *  this menu opens *above* the click point when there's no room below, closer to how native OS
 *  context menus behave. `pointReference`'s zero-size virtual element does not change how `flip()`
 *  evaluates available space — the middleware reasons about space along the placement's own axis
 *  relative to the reference point, not about the reference's own size. */
const style = ref({ left: '-9999px', top: '-9999px' });

onMounted(async () => {
  invoker = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  listRef.value?.focusFirst();
  const el = menuEl.value;
  if (el) {
    const { left, top } = await computeFloatPosition(pointReference(props.x, props.y), el, {
      flip: true,
      placement: 'bottom-start',
    });
    style.value = { left: `${left}px`, top: `${top}px` };
  }
});

onBeforeUnmount(() => {
  invoker?.focus();
});
</script>

<template>
  <div ref="rootEl" class="kui-menu-root-wrap">
    <div
      ref="menuEl"
      class="kv:fixed kv:z-[var(--kui-z-menu,30)] kv:min-w-45 kv:max-w-80 kv:max-h-[var(--kui-float-max-h,none)] kv:overflow-y-auto kv:bg-kui-bg-panel kv:text-kui-fg kv:border kv:border-kui-border-strong kv:rounded-kui-float kv:shadow-kui-float"
      :style="style"
    >
      <KuiMenuList
        ref="listRef"
        :sections="sections"
        :label="label"
        :title="title"
        @select="(id) => emit('select', id)"
        @close="emit('close')"
      />
    </div>
  </div>
</template>
