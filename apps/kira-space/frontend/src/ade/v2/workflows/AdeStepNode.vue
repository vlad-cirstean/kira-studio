<script setup lang="ts">
import StatusDot from '@theme/components/StatusDot.vue';
import VarText from '@theme/components/VarText.vue';
import { t } from '@theme/i18n';
import { Handle, Position } from '@vue-flow/core';
import { computed } from 'vue';
import AdeTip from '../AdeTip.vue';
import { promptParts } from '../automation/smartStepBody';
import { runsOnLabel } from '../board/workflowForm';
import { resultHandleId, type StepNodeData } from '../board/workflowGraph';

// One agent step on the canvas: name, what it runs, and one connector per result. Fixed size; full
// text lives in the inspector.
const props = defineProps<{ data: StepNodeData }>();
const step = computed(() => props.data.step);
const body = computed(() => {
  const review = step.value.review;
  if (review)
    return t(
      review.sendTo === 'new'
        ? 'space.ade.workflows.stepNode.sendsNew.label'
        : 'space.ade.workflows.stepNode.sendsImplementer.label',
    );
  return step.value.smartScript ? `✦ ${step.value.smartScript}` : step.value.prompt;
});
const parts = computed(() => promptParts(body.value));
const LABEL_MAX = 4;
const labelled = computed(() => step.value.results.length <= LABEL_MAX);
const tip = (r: StepNodeData['step']['results'][number]): string => {
  const outcome = t(
    r.ok ? 'space.ade.workflows.results.ok.label' : 'space.ade.workflows.results.notOk.label',
  );
  return r.next === 'stop'
    ? t('space.ade.workflows.stepNode.resultStops.tooltip', { id: r.id, outcome })
    : t('space.ade.workflows.stepNode.resultGoes.tooltip', { id: r.id, outcome, next: r.next });
};
</script>

<template>
  <div
    class="flex flex-col rounded-kira border bg-elevated text-kira-sm"
    :class="data.selected ? 'border-info' : 'border-border-strong'"
    :style="{ width: `${data.w}px`, height: `${data.h}px` }"
    data-testid="ade-wf-node"
    :data-step-id="step.id"
    :data-start="data.start"
    :data-selected="data.selected"
  >
    <Handle
      id="in"
      type="target"
      :position="Position.Top"
      class="!size-2.5 !border-0 !bg-muted-foreground"
    />
    <Handle
      id="loop-in"
      type="target"
      :position="Position.Top"
      class="!size-2 !border-0 !bg-muted-foreground !left-5"
    />
    <div class="flex items-center gap-1.5 px-2 pt-2">
      <AdeTip v-if="data.start" :text="t('common.action.start.label')"
        ><span class="text-tone-green" data-testid="ade-wf-node-start">▶</span></AdeTip
      >
      <span
        class="min-w-0 flex-1 truncate text-kira-md font-medium"
        data-testid="ade-wf-node-name"
        >{{
          step.name
        }}</span
      >
      <span
        v-if="step.before === 'approval'"
        class="shrink-0 text-warn-text"
        data-testid="ade-wf-node-gate"
        >{{
          t('space.ade.needs.kind.approval.label')
        }}</span
      >
      <span v-if="step.smartScript" class="shrink-0 text-info">{{
        t('space.ade.workflows.stepNode.smart.label')
      }}</span>
      <span
        v-if="step.sandbox.access !== 'write'"
        class="shrink-0"
        :class="step.sandbox.access === 'off' ? 'text-warn-text' : 'text-muted-foreground'"
        data-testid="ade-wf-node-sandbox"
        >{{
          t(
            step.sandbox.access === 'off'
              ? 'space.ade.sandbox.off.label'
              : 'space.ade.sandbox.read.label',
          )
        }}</span
      >
      <span v-if="step.review" class="shrink-0 text-info" data-testid="ade-wf-node-review">{{
        t('space.ade.board.branchTag.review.label')
      }}</span>
    </div>
    <div class="truncate px-2 text-subtle">{{ runsOnLabel(step.runsOn) }}</div>
    <div
      class="truncate px-2 text-muted-foreground [&>span]:whitespace-nowrap"
      data-testid="ade-wf-node-prompt"
    >
      <VarText :parts="parts" />
    </div>
    <div class="mt-auto flex border-t border-border">
      <AdeTip v-for="r in step.results" :key="r.id" :text="tip(r)">
        <span
          class="relative flex min-w-0 flex-1 items-center justify-center gap-1 px-1 py-1"
          data-testid="ade-wf-node-result"
          :data-result="r.id"
          :data-ok="r.ok"
        >
          <StatusDot
            :color="r.ok ? 'var(--color-tone-green-solid)' : 'var(--color-tone-red-solid)'"
          />
          <span v-if="labelled" class="truncate">{{ r.id }}</span>
          <Handle
            :id="resultHandleId(r.id)"
            type="source"
            :position="Position.Bottom"
            class="!size-3 !border-2 !border-bg"
            :class="r.ok ? '!bg-tone-green-solid' : '!bg-tone-red-solid'"
          />
        </span>
      </AdeTip>
    </div>
  </div>
</template>
