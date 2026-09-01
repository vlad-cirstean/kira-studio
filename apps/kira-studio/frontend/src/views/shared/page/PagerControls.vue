<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import IconButton from '../../../theme/primitives/IconButton.vue';
import TextField from '../../../theme/primitives/TextField.vue';

// P48 F4: the first/prev/page-jump/next/last pager DataToolbar.vue and DocumentView.vue each
// wrote out — same five controls, same order, same pageDisplay/pageInputValue/pageCount/onJump
// computeds, differing only in their data-testid prefix and the "count first" tooltip's noun.
// D7: uses the document view's own icon spelling (arrow-left/arrow-right for prev/next) — the
// grid's own chevron-left/chevron-right pair for First and Previous rendered two identical
// glyphs side by side, which this fixes by construction.
const props = defineProps<{
  pageIndex: number;
  pageSize: number;
  count: number | null;
  hasMore: boolean;
  testidPrefix: string;
  lastTooltip: string;
  strategy?: string;
}>();

const emit = defineEmits<{ first: []; prev: []; next: []; last: []; jump: [pageIndex: number] }>();

const pageDisplay = computed(() => props.pageIndex + 1);

// A plain `:value="pageDisplay"` fights the user's typing: any unrelated reactive read this
// component makes forces a re-render, and Vue reasserts the bound value on the DOM input
// regardless of whether pageDisplay itself changed — wiping out whatever the user has typed but
// not yet committed. Mirroring it through its own ref, kept in sync with pageDisplay only when
// the page actually advances, avoids the fight.
const pageInputValue = ref(String(pageDisplay.value));
watch(pageDisplay, (v) => {
  pageInputValue.value = String(v);
});

const pageCount = computed(() => {
  if (props.count === null || !props.pageSize) return null;
  return Math.max(1, Math.ceil(props.count / props.pageSize));
});

function onJump(e: Event): void {
  const value = Number((e.target as HTMLInputElement).value);
  if (Number.isFinite(value) && value >= 1) emit('jump', value - 1);
}
</script>

<template>
  <div class="group pager" :data-testid="`${testidPrefix}pager`" :data-pagination="strategy">
    <IconButton
      icon="chevron-left"
      v-tooltip="'First page'"
      :data-testid="`${testidPrefix}pager-first`"
      :disabled="pageIndex === 0"
      @click="emit('first')"
    />
    <IconButton
      icon="arrow-left"
      v-tooltip="'Previous page'"
      :data-testid="`${testidPrefix}pager-prev`"
      :disabled="pageIndex === 0"
      @click="emit('prev')"
    />
    <span class="page-label p-sm muted">
      page
      <div class="page-input">
        <TextField
          v-model="pageInputValue"
          type="number"
          min="1"
          hide-stepper
          :data-testid="`${testidPrefix}pager-page-input`"
          @change="onJump"
        />
      </div>
      <template v-if="pageCount"> of {{ pageCount }}</template>
    </span>
    <IconButton
      icon="arrow-right"
      v-tooltip="'Next page'"
      :data-testid="`${testidPrefix}pager-next`"
      :disabled="!hasMore"
      @click="emit('next')"
    />
    <IconButton
      icon="chevron-right"
      v-tooltip="pageCount ? 'Last page' : lastTooltip"
      :data-testid="`${testidPrefix}pager-last`"
      :disabled="!pageCount"
      @click="emit('last')"
    />
  </div>
</template>

<style scoped>
.pager {
  gap: var(--kira-s-1);
}

.page-label {
  display: inline-flex;
  align-items: center;
  gap: var(--kira-s-1);
  white-space: nowrap;
}

/* TextField's root <span class="p-input"> only receives fallthrough attrs on its inner <input>
   (see TextField.vue's inheritAttrs:false), so the fixed width and centred text live on this
   wrapper/its :deep() descendants instead of a class/style on the <TextField> tag itself. */
.page-input {
  width: 46px;
}

.page-input :deep(.p-input) {
  width: 100%;
  padding: 0 var(--kira-s-2);
}

.page-input :deep(input) {
  text-align: center;
}
</style>
