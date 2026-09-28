<script setup lang="ts">
import CodiconIcon from '@theme/CodiconIcon.vue';
import { computed } from 'vue';
import { type DialogCtx, rebaseSpec, specForQueueAction, startSpec } from './dialogCompose';
import { useAdeResolveDependency } from './mutations';
import { useAdeActionsStore } from './state/adeActions';
import { useAdeUiStore } from './state/adeUi';
import { chipStyle, TONE } from './tones';
import { DEPENDENCY_COLOR, type QueuePanel, type QueuePanelAction } from './useQueue';

// P129 Part 6 §0.5/§0.22: the panel's own header — colour dot, work-status chip, title, mono fact
// line, review banner, action row (mockup 276-297). Actions dispatch straight to `adeUi.openDialog`/
// `adeActions` here (same self-contained pattern `AdeClaudeDialog.vue` already uses for its own
// `ctx` prop) rather than bubbling a new action-kind union up through `AdeDetailPanel`/`AdeRepoView`
// — `dialogCtx` is already built once per render there and has everything this dispatch needs.
const props = defineProps<{
  panel: QueuePanel;
  dialogCtx: DialogCtx | null;
  codeRepoId: string;
}>();

const adeUiStore = useAdeUiStore();
const adeActionsStore = useAdeActionsStore();
const resolveDependency = useAdeResolveDependency(() => props.codeRepoId);

const dotClass = computed(() => {
  if (props.panel.kind === 'review') return 'rounded-[3px] border-2';
  if (props.panel.kind === 'parked') return 'rounded-[3px] border-2 border-dashed';
  return 'rounded-[3px]';
});

const dotStyle = computed(() => {
  if (props.panel.kind === 'review' || props.panel.kind === 'parked') {
    return { borderColor: props.panel.color };
  }
  if (props.panel.draft) {
    return {
      border: `2px solid ${props.panel.color}`,
      background: `repeating-linear-gradient(135deg, ${props.panel.color} 0 2px, transparent 2px 4px)`,
    };
  }
  return { background: props.panel.color };
});

const statusChipStyle = computed(() => chipStyle(props.panel.status.tone));

/** Mockup `d.owner + '’s work. Read-only here: …'` (line 1603). */
const reviewNote = computed(
  () => `${props.panel.owner}’s work. Read-only here: you can run agents on it and keep your own notes.`,
);

// §0.5: mockup `btnP(t)` (line 1383) always reads the tone's own *solid* colour — 'primary' is every
// call the mockup makes with `btnP('amber')` (Force push, every Rebase*); 'purple'/'red' reuse the
// same solid as the segment tags. 'claude' and 'secondary' are the mockup's own literal, non-tone
// styles (`▶ Start agent`'s `#d97757` background, `btnG`'s bordered/transparent secondary Archive).
function actionStyle(action: QueuePanelAction): Record<string, string> {
  if (action.tone === 'claude') {
    return { background: '#d97757', color: '#1a0f0a', border: 'none' };
  }
  if (action.tone === 'secondary') {
    return { background: 'transparent', color: '#e8e6e1', border: '1px solid #3a3e48' };
  }
  const key = action.tone === 'primary' ? 'amber' : action.tone;
  const solid = TONE[key][2];
  return { background: solid, color: key === 'purple' ? '#ffffff' : '#15161a', border: 'none' };
}

/** §0.5 steps 2-7: every dialog-opening action reuses the exact opener `AdeRepoView`'s own
 *  `onSegmentAction`/`onCellAction` already call for the same kinds (`rebaseSpec`,
 *  `specForQueueAction`, `startSpec`) — `forcePush`/`archive` skip the dialog entirely, matching the
 *  mockup's own `forcePush`/`requestArchive` calls. Titles reuse the action's own `label` (already
 *  the mockup's `short()`-form text, e.g. "Rebase onto oauth-e2e") except the two static-title
 *  kinds, which match the plan's literal wording. */
/** P135 §4.7: Resolve needs no `dialogCtx` (no git, no dialog) — handled ahead of that guard. */
async function onActionClick(action: QueuePanelAction): Promise<void> {
  if (action.disabled) return;
  if (action.kind === 'resolve') {
    await resolveDependency.mutateAsync({
      codeRepoId: props.codeRepoId,
      id: action.targetIds[0] as string,
    });
    adeUiStore.select(props.codeRepoId, '');
    return;
  }
  const ctx = props.dialogCtx;
  if (!ctx) return;
  switch (action.kind) {
    case 'forcePush':
      void adeActionsStore.forcePush(props.codeRepoId, action.targetIds);
      return;
    case 'archive':
      void adeActionsStore.requestArchive(props.codeRepoId, action.targetIds[0] as string, ctx);
      return;
    case 'start':
      adeUiStore.openDialog(startSpec(ctx, action.targetIds[0] as string));
      return;
    case 'queueAfter':
      adeUiStore.openDialog(
        specForQueueAction(ctx, { kind: 'queueAfter', targetIds: action.targetIds }),
      );
      return;
    case 'rebaseMain':
      adeUiStore.openDialog(rebaseSpec(ctx, [action.targetIds[0] as string], 'main', action.label));
      return;
    case 'rebaseAfter': {
      const [root, onto] = action.targetIds as [string, string];
      adeUiStore.openDialog(rebaseSpec(ctx, [root], onto, action.label));
      return;
    }
    case 'rebaseStack': {
      const [selected, parent] = action.targetIds as [string, string];
      adeUiStore.openDialog(rebaseSpec(ctx, [selected], parent, action.label));
      return;
    }
  }
}
</script>

<template>
  <div
    class="flex flex-col gap-[5px] border-b border-[#2a2d35] px-3.5 pb-2.5 pt-3"
    data-testid="ade-panel-header"
  >
    <div class="flex items-center gap-2">
      <CodiconIcon
        v-if="panel.kind === 'dependency'"
        name="globe"
        :size="12"
        :style="{ color: DEPENDENCY_COLOR }"
        class="shrink-0"
      />
      <span v-else class="size-3 shrink-0" :class="dotClass" :style="dotStyle" />
      <span class="shrink-0" :style="statusChipStyle">{{ panel.status.label }}</span>
      <h3 class="min-w-0 flex-1 truncate text-kira-lg font-semibold" data-testid="ade-panel-title">
        {{ panel.title }}
      </h3>
    </div>
    <div class="truncate font-data text-kira-sm text-[#9a9ca5]" data-testid="ade-panel-mono">
      {{ panel.mono }}
    </div>
    <div
      v-if="panel.readOnly"
      class="mt-0.5 flex items-center gap-2 rounded-kira-sm border border-[rgba(122,167,255,0.35)] bg-[rgba(122,167,255,0.12)] px-2.5 py-1.5 text-kira-sm text-[#b9cfff]"
      data-testid="ade-panel-review-banner"
    >
      <CodiconIcon name="lock" :size="13" class="text-[#93b6ff]" />
      <span>{{ reviewNote }}</span>
    </div>
    <div v-if="panel.actions.length" class="flex flex-wrap gap-1.5 pt-0.5">
      <button
        v-for="action in panel.actions"
        :key="action.kind + action.targetIds.join(',')"
        type="button"
        :disabled="action.disabled"
        :title="action.tip"
        class="h-[26px] shrink-0 whitespace-nowrap rounded px-2.5 text-kira-sm font-semibold disabled:cursor-default disabled:opacity-60"
        :style="actionStyle(action)"
        :data-testid="`ade-panel-action-${action.kind}`"
        @click="void onActionClick(action)"
      >
        <CodiconIcon v-if="action.kind === 'resolve'" name="pass" :size="12" class="mr-1 inline" />{{
          action.label
        }}
      </button>
    </div>
  </div>
</template>
