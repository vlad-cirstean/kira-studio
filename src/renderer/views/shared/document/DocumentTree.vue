<script setup lang="ts">
import { computed, ref } from 'vue';
import CodiconIcon from '../../../theme/CodiconIcon.vue';
import { wheelToHorizontal } from '../../../wheelScroll';
import { rowsVersion, visibleLines } from './rows';

// One expanded document's body, rendered as flat indented key/value lines out of visibleLines()
// (P27 D19) — no CodeMirror, no per-node component recursion, so the DOM cost here is linear in
// what is actually on screen rather than in the document's total node count.
const props = defineProps<{ tabId: string; row: number }>();
const emit = defineEmits<{ 'toggle-path': [path: string] }>();

const lines = computed(() => {
  void rowsVersion.n;
  return visibleLines(props.tabId, props.row);
});

// P43 iter3 D42/F31: a long scalar value is revealed by scrolling this list sideways rather than
// by wrapping it — rows.ts's rowHeight() is exact and measurement-free (one LINE_H per visible
// node), so a wrapped line would break the VirtualList prefix sum that depends on it. Same
// TabStrip.vue/ConsoleView.vue idiom: chrome-less scrolling (the CSS below) plus a wheel handler,
// since a plain mouse wheel produces only a vertical axis.
const treeRef = ref<HTMLElement | null>(null);
function onWheel(e: WheelEvent): void {
  if (wheelToHorizontal(treeRef.value, e)) e.preventDefault();
}

// D12: coloured with the existing --kira-syntax-* tokens — 'bson' (a shell constructor call like
// ObjectId(...), or a canonical-EJSON fallback for a type this app's shell has no constructor for)
// reuses --kira-syntax-function, the same hue CodeMirror already gives a function-call name.
const TOKEN_CLASS: Record<'string' | 'number' | 'keyword' | 'bson', string> = {
  string: 'tok-string',
  number: 'tok-number',
  keyword: 'tok-keyword',
  bson: 'tok-bson',
};
</script>

<template>
  <div class="document-tree" data-testid="document-tree" ref="treeRef" @wheel="onWheel">
    <div
      v-for="line in lines"
      :key="line.node.path"
      class="tree-line"
      :style="{ paddingLeft: `${line.depth * 16 + 4}px` }"
      data-testid="document-tree-line"
      :data-path="line.node.path"
      :data-depth="line.depth"
    >
      <button
        v-if="line.expandable"
        type="button"
        class="tree-twisty"
        data-testid="document-tree-twisty"
        :aria-label="line.expanded ? 'Collapse' : 'Expand'"
        @click="emit('toggle-path', line.node.path)"
      >
        <CodiconIcon :name="line.expanded ? 'chevron-down' : 'chevron-right'" :size="12" />
      </button>
      <span v-else class="tree-twisty-spacer"></span>
      <span v-if="line.node.key !== ''" class="tree-key">{{ line.node.key }}:</span>
      <span
        v-if="line.node.kind === 'scalar'"
        class="tree-value"
        :class="TOKEN_CLASS[line.node.token]"
        data-testid="document-tree-value"
        >{{ line.node.text }}</span
      >
      <span v-else class="tree-value tree-summary" data-testid="document-tree-summary">{{
        line.node.summary
      }}</span>
    </div>
  </div>
</template>

<style scoped>
.document-tree {
  padding: var(--kira-s-2) 0;
  font-family: var(--kira-font-family);
  font-size: var(--kira-t-sm);
  /* P43 iter3 D42: chrome-less horizontal scrolling, TabStrip.vue's/ConsoleView.vue's own idiom —
     the same three declarations, occupying zero vertical space, so rowHeight()'s exact LINE_H
     accounting (rows.ts) is untouched. */
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: none;
}

.document-tree::-webkit-scrollbar {
  display: none;
}

.tree-line {
  height: var(--kira-h-xs);
  display: flex;
  align-items: center;
  gap: var(--kira-s-1);
  padding-right: var(--kira-s-4);
  white-space: nowrap;
  /* A line only as wide as its own content grows the scroller's scrollWidth past the panel — a
     plain 100% width would clip at the viewport instead of revealing the rest on scroll. */
  width: max-content;
  min-width: 100%;
}

.tree-twisty {
  flex-shrink: 0;
  width: 14px;
  height: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  color: var(--kira-fg-muted);
  cursor: pointer;
  padding: 0;
}

.tree-twisty-spacer {
  flex-shrink: 0;
  width: 14px;
}

.tree-key {
  flex-shrink: 0;
  color: var(--kira-syntax-property);
}

.tree-value {
  /* P43 iter3 D42: no longer clipped — .tree-line's own max-content width lets this grow past
     the panel instead, reachable by scrolling .document-tree sideways. */
  flex-shrink: 0;
}

.tree-summary {
  color: var(--kira-fg-muted);
}

.tok-string {
  color: var(--kira-syntax-string);
}

.tok-number {
  color: var(--kira-syntax-number);
}

.tok-keyword {
  color: var(--kira-syntax-keyword);
}

.tok-bson {
  color: var(--kira-syntax-function);
}
</style>
