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
 */
import { computed, ref } from 'vue';
import {
  enabledNeighbour,
  firstEnabled,
  flattenItems,
  type MenuSection,
} from './contextMenuModel.ts';

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
    class="kui-menu-list"
    role="menu"
    :aria-label="title ?? label"
    @keydown="onKeydown"
  >
    <div v-if="title" class="kui-menu-heading" aria-hidden="true">{{ title }}</div>
    <template v-for="(section, sectionIndex) in sections" :key="sectionIndex">
      <div v-if="sectionIndex > 0" class="kui-menu-separator" role="separator"></div>
      <div
        v-for="item in section.items"
        :id="itemId(item.id)"
        :key="item.id"
        class="kui-row kui-menu-item"
        :class="{ 'kui-menu-item--disabled': item.disabled, 'kui-menu-item--danger': item.danger }"
        role="menuitem"
        :aria-disabled="item.disabled"
        :aria-describedby="item.disabled && item.disabledReason ? `${itemId(item.id)}-reason` : undefined"
        :tabindex="focusedId === item.id ? 0 : -1"
        :data-testid="item.id"
        @click="activate(item.id)"
        @mouseenter="focusedId = item.id"
      >
        <!-- G34 D9: the icon box is unconditional (Kira's own shape) so every row's label starts
             at the same x position whether or not that particular item carries an icon. -->
        <span class="kui-icon-box">
          <span v-if="item.icon" class="codicon" :class="item.icon" aria-hidden="true"></span>
        </span>
        <span class="kui-menu-item-label">
          <span>{{ item.label }}</span>
          <span v-if="item.detail" class="kui-menu-item-detail">{{ item.detail }}</span>
        </span>
        <span
          v-if="item.disabled && item.disabledReason"
          :id="`${itemId(item.id)}-reason`"
          class="kui-visually-hidden"
        >
          {{ item.disabledReason }}
        </span>
      </div>
    </template>
  </div>
</template>
