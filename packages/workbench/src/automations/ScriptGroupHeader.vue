<script setup lang="ts">
import type { ScriptCollection } from '@shared/domain/scripts';
import CodiconIcon from '@theme/CodiconIcon.vue';
import TruncatedText from '@theme/components/TruncatedText.vue';
import { rowIndent, rowMeta, rowVariants } from '@theme/lib/rowVariants';
import InlineEditInput from '@workbench/components/InlineEditInput.vue';
import TreeTwisty from '@workbench/components/TreeTwisty.vue';

defineProps<{
  collection: ScriptCollection;
  count: number;
  open: boolean;
  renaming: boolean;
}>();
const emit = defineEmits<{
  toggle: [];
  commit: [name: string];
  cancel: [];
  menu: [event: MouseEvent];
}>();
</script>

<template>
  <!-- biome-ignore lint/a11y/noStaticElementInteractions: right-click only; the header button toggles by keyboard. -->
  <div
    :class="rowVariants({ layout: 'tree' })"
    :style="rowIndent(0)"
    data-testid="script-group"
    :data-id="collection.id"
    :data-name="collection.name"
    @contextmenu.prevent.stop="emit('menu', $event)"
  >
    <TreeTwisty :expanded="open" :has-children="count > 0" @toggle="emit('toggle')" />
    <CodiconIcon name="folder-library" :size="13" class="shrink-0 text-muted-foreground" />
    <InlineEditInput
      v-if="renaming"
      :name="collection.name"
      data-testid="script-collection-rename-input"
      @commit="(name) => emit('commit', name)"
      @cancel="emit('cancel')"
    />
    <button
      v-else
      type="button"
      class="flex-1 min-w-0 cursor-default border-0 bg-transparent p-0 text-left font-medium text-inherit"
      :aria-expanded="open"
      @click="emit('toggle')"
      ><TruncatedText :text="collection.name" /></button
    >
    <span :class="rowMeta">{{ count }}</span>
  </div>
</template>
