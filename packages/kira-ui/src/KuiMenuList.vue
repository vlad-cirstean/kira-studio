<script setup lang="ts">
/**
 * G34 D8: extracted from `KuiContextMenu.vue` — the rows/sections/heading/separator rendering,
 * the roving `tabindex`, and the full `Escape`/`Arrow`/`Home`/`End`/`Enter`/`Space`/`Tab` handler,
 * everything that component did *except* positioning and the outside-click backdrop. Splitting it
 * out is what lets a trigger-anchored menu (AppToolbar's Push overflow, PullStrategyPicker) render
 * as the exact same list a point-anchored context menu does — `KuiContextMenu.vue` now positions
 * one of these; `<KuiPopoverPanel>` anchors one to a trigger instead, each supplying its own
 * positioned "surface" (`.kui-menu-root` / `.kui-popover`) around this component's own `.kui-menu-
 * list`, which carries no position/background/border/shadow of its own by design — see
 * `theme/controls.css`'s own comment on `.kui-menu-list`.
 *
 * P110 A5: controls.css's `.kui-menu-list`/`.kui-menu-item`(+`--disabled`/`--danger`)/`-label`/
 * `-detail`/`.kui-menu-heading`/`.kui-menu-separator`/`.kui-visually-hidden` replaced by `kv:`
 * utilities; the item row itself now composes the shared `kuiRowVariants()` (A5) rather than the
 * retired literal `class="kui-row"`. The icon box is a real `<KuiIconBox>` now (A3), not a raw
 * `class="kui-icon-box"` span — this was that class's last consumer, so `controls.css`'s own
 * `.kui-icon-box`/`.kui-icon-box .codicon` rules are deleted in this same commit. Its unconditional
 * muted colour (menu-specific, not part of `kuiRowVariants`: every row in a menu gets it whether or
 * not it carries an icon) is a ternary against `item.danger` on the component itself, since danger
 * is the one state that overrides it.
 */
import { computed, ref } from 'vue';
import {
  enabledNeighbour,
  firstEnabled,
  flattenItems,
  type MenuSection,
} from './contextMenuModel.ts';
import KuiIconBox from './KuiIconBox.vue';
import { kuiRowVariants } from './rowVariants.ts';

const props = defineProps<{
  sections: readonly MenuSection[];
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

const listEl = ref<HTMLDivElement | null>(null);

const flatItems = computed(() => flattenItems(props.sections));

function itemId(id: string): string {
  return `kui-menu-item-${id}`;
}

const focusedId = ref<string | undefined>(firstEnabled(flatItems.value));

function focusItem(id: string | undefined): void {
  if (id === undefined) return;
  focusedId.value = id;
  listEl.value?.querySelector<HTMLElement>(`#${itemId(id)}`)?.focus();
}

function neighbour(direction: 1 | -1): string | undefined {
  return enabledNeighbour(flatItems.value, focusedId.value, direction);
}

/** Every key this menu recognises calls `stopPropagation()` — most load-bearingly `Escape`: a
 *  host's own document-level `Escape` handler must never see the same keystroke this menu
 *  already acted on, or one press would close the menu *and* whatever else is listening together
 *  instead of one at a time. */
function onKeydown(event: KeyboardEvent): void {
  switch (event.key) {
    case 'Escape':
      event.preventDefault();
      event.stopPropagation();
      emit('close');
      break;
    case 'ArrowDown':
      event.preventDefault();
      event.stopPropagation();
      focusItem(neighbour(1));
      break;
    case 'ArrowUp':
      event.preventDefault();
      event.stopPropagation();
      focusItem(neighbour(-1));
      break;
    case 'Home':
      event.preventDefault();
      event.stopPropagation();
      focusItem(enabledNeighbour(flatItems.value, undefined, 1));
      break;
    case 'End':
      event.preventDefault();
      event.stopPropagation();
      focusItem(enabledNeighbour(flatItems.value, undefined, -1));
      break;
    case 'Enter':
    case ' ':
      event.preventDefault();
      event.stopPropagation();
      activate(focusedId.value);
      break;
    case 'Tab':
      // A menu does not participate in normal tab order — closing it here rather than letting
      // focus leave to whatever the page's own next tab stop happens to be.
      event.preventDefault();
      event.stopPropagation();
      emit('close');
      break;
    default:
      break;
  }
}

function activate(id: string | undefined): void {
  if (id === undefined) return;
  const item = flatItems.value.find((entry) => entry.id === id);
  if (!item || item.disabled) return;
  emit('select', id);
}

defineExpose({
  focusFirst: () => focusItem(focusedId.value),
});
</script>

<template>
  <div
    ref="listEl"
    class="kv:flex kv:flex-col kv:gap-px kv:p-1"
    role="menu"
    :aria-label="title ?? label"
    @keydown="onKeydown"
  >
    <div
      v-if="title"
      class="kv:flex kv:items-center kv:h-kui-control-sm kv:px-1.5 kv:text-kui-sm kv:font-semibold kv:text-kui-fg-subtle kv:uppercase kv:tracking-wider kv:truncate"
      aria-hidden="true"
    >
      {{ title }}
    </div>
    <template v-for="(section, sectionIndex) in sections" :key="sectionIndex">
      <hr
        v-if="sectionIndex > 0"
        class="kv:h-px kv:my-1 kv:border-0 kv:bg-kui-border-strong"
      />
      <div
        v-for="item in section.items"
        :id="itemId(item.id)"
        :key="item.id"
        :class="kuiRowVariants({ disabled: item.disabled, danger: item.danger })"
        role="menuitem"
        :aria-disabled="item.disabled"
        :aria-describedby="item.disabled && item.disabledReason ? `${itemId(item.id)}-reason` : undefined"
        :tabindex="focusedId === item.id ? 0 : -1"
        :data-testid="item.id"
        @click="activate(item.id)"
        @mouseenter="focusedId = item.id"
        @keydown.enter.space.stop="activate(item.id)"
      >
        <!-- G34 D9: the icon box is unconditional (Kira's own shape) so every row's label starts
             at the same x position whether or not that particular item carries an icon. -->
        <KuiIconBox
          :icon="item.icon"
          :class="item.danger ? 'kv:text-kui-danger-fg' : 'kv:text-kui-fg-muted'"
        />
        <span class="kv:flex kv:flex-col kv:min-w-0">
          <span>{{ item.label }}</span>
          <span v-if="item.detail" class="kv:text-kui-sm kv:text-kui-fg-muted">{{ item.detail }}</span>
        </span>
        <span
          v-if="item.disabled && item.disabledReason"
          :id="`${itemId(item.id)}-reason`"
          class="kv:sr-only"
        >
          {{ item.disabledReason }}
        </span>
      </div>
    </template>
  </div>
</template>
