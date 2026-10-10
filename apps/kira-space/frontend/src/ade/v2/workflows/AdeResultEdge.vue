<script setup lang="ts">
import { EdgeLabelRenderer, type EdgeProps, getBezierPath } from '@vue-flow/core';
import { computed } from 'vue';
import type { EdgeData } from '../board/workflowGraph';

// A route between steps, grouped by target: toned by the results on it (all ok green, all not ok red,
// mixed neutral). A loop edge leaves to the right and comes back up, dashed, with its budget.
const props = defineProps<EdgeProps<EdgeData>>();
const d = computed(() => props.data as EdgeData);
const TONE_STROKE = { ok: 'stroke-tone-green-solid', fail: 'stroke-tone-red-solid', neutral: 'stroke-muted-foreground' };
const TONE_MARKER = { ok: 'ade-arrow-ok', fail: 'ade-arrow-fail', neutral: 'ade-arrow-neutral' };
const BOW = 210;

const geometry = computed(() => {
  const { sourceX: sx, sourceY: sy, targetX: tx, targetY: ty } = props;
  if (!d.value.loop) {
    const [path, x, y] = getBezierPath(props);
    return { path, x, y };
  }
  const bx = Math.max(sx, tx) + BOW;
  return {
    path: `M ${sx} ${sy} C ${bx} ${sy + 40}, ${bx} ${ty - 40}, ${tx} ${ty}`,
    x: (sx + 3 * bx + 3 * bx + tx) / 8,
    y: (sy + 3 * (sy + 40) + 3 * (ty - 40) + ty) / 8,
  };
});
const label = computed(() => `${d.value.results.join(', ')}${d.value.loop ? ` ↩ max ${d.value.max}` : ''}`);
</script>

<template>
  <g data-testid="ade-wf-edge" :data-tone="d.tone" :data-loop="d.loop" :data-selected="d.selected" :data-results="d.results.join(',')">
    <path
      :d="geometry.path"
      class="fill-none"
      :class="[TONE_STROKE[d.tone], d.loop ? '[stroke-dasharray:6_4]' : '', d.selected ? 'stroke-[3px]' : 'stroke-2']"
      :marker-end="`url(#${TONE_MARKER[d.tone]})`"
    />
    <path :d="geometry.path" class="fill-none stroke-transparent stroke-[16px]" />
  </g>
  <EdgeLabelRenderer v-if="!d.stage">
    <span
      class="nodrag nopan pointer-events-auto absolute rounded-kira-sm border border-border bg-bg px-1 text-kira-sm text-muted-foreground"
      :style="{ transform: `translate(-50%, -50%) translate(${geometry.x}px, ${geometry.y}px)` }"
      data-testid="ade-wf-edge-label"
    >
      {{ label }}
    </span>
  </EdgeLabelRenderer>
</template>
