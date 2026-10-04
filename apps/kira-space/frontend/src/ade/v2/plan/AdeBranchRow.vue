<script setup lang="ts">
import { computed } from 'vue';
import AdeTip from '../AdeTip.vue';
import { repoColor } from '../palette';
import { TONE } from '../tones';
import AdeAttention from './AdeAttention.vue';
import type { BranchRowModel } from './usePlanModel';

const props = defineProps<{ row: BranchRowModel; merged: boolean }>();

const repoStyle = computed(() => {
  const c = repoColor(props.row.branch.codeRepoId);
  return { background: `${c}1f`, color: c };
});
const elbowColor = computed(() =>
  props.row.base?.tone === 'blue' ? TONE.blue[2] : 'var(--kira-border-strong)',
);
</script>

<template>
  <div
    class="box-border flex h-10 w-full items-center gap-[7px] border-l-[3px] border-l-transparent px-2.5"
    :class="row.isReview ? 'bg-[repeating-linear-gradient(135deg,color-mix(in_srgb,var(--kira-info)_8%,transparent)_0_8px,color-mix(in_srgb,var(--kira-info)_3%,transparent)_8px_16px)]' : ''"
    :style="merged ? { background: `color-mix(in srgb, ${TONE.purple[2]} 8%, transparent)` } : undefined"
    :data-ripple="row.ripple || undefined"
    data-testid="ade-branch-row"
    :data-branch-id="row.id"
  >
    <span class="relative shrink-0 self-stretch" :style="{ width: `${row.depth * 16}px` }">
      <span
        v-if="row.depth"
        class="absolute -top-1 right-0.5 box-border h-[18px] w-2 rounded-bl-[4px] border-b-2 border-l-2"
        :style="{ borderColor: elbowColor }"
      />
    </span>
    <span
      class="shrink-0 rounded-kira-xs px-[5px] py-px font-data text-kira-sm font-semibold"
      :style="repoStyle"
      data-testid="ade-branch-repo"
      >{{ row.repo }}</span
    >
    <AdeTip v-if="row.base" :text="row.base.tip">
      <span
        class="max-w-[110px] shrink-0 truncate rounded-kira-xs px-[5px] py-px font-data text-kira-sm font-semibold"
        :class="row.base.tone === 'blue' ? '' : 'bg-field text-fg'"
        :style="row.base.tone === 'blue' ? { background: TONE.blue[0], color: TONE.blue[1] } : undefined"
        data-testid="ade-base-marker"
        >{{ row.base.label }}</span
      >
    </AdeTip>
    <AdeAttention v-if="row.attention" :tip="row.attention" />
    <AdeTip v-if="row.isReview" text="Someone else's branch: read-only here">
      <span
        class="inline-flex h-5 shrink-0 items-center gap-[5px] rounded-kira-pill px-2 text-kira-sm font-semibold"
        :style="{ background: TONE.blue[0], color: TONE.blue[1] }"
        data-testid="ade-owner-pill"
        >{{ row.branch.owner }}</span
      >
    </AdeTip>
    <div class="flex h-full min-w-0 flex-1 flex-col justify-center text-left">
      <AdeTip :text="row.name">
        <span
          class="truncate font-data text-kira-md font-semibold leading-4"
          :class="row.isReview ? '' : row.draft ? 'italic text-muted-foreground' : 'text-fg'"
          :style="row.isReview ? { color: TONE.blue[1] } : undefined"
          data-testid="ade-branch-name"
          >{{ row.name }}</span
        >
      </AdeTip>
      <span
        v-if="row.context"
        class="truncate text-kira-sm leading-[14px] text-subtle"
        :class="row.draft ? 'italic' : ''"
        data-testid="ade-branch-context"
        >{{ row.context }}</span
      >
    </div>
  </div>
</template>
