<script setup lang="ts">
import '@vue-flow/core/dist/style.css';
import TooltipIconButton from '@theme/components/TooltipIconButton.vue';
import { Button } from '@theme/components/ui/button';
import { Input } from '@theme/components/ui/input';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@theme/components/ui/resizable';
import { Switch } from '@theme/components/ui/switch';
import { type Connection, type Edge, type Node, useVueFlow, VueFlow } from '@vue-flow/core';
import { onKeyStroke, useResizeObserver } from '@vueuse/core';
import { useConfirmDialogStore } from '@workbench/state/confirmDialog';
import { computed, nextTick, onBeforeUnmount, ref, useTemplateRef, watch } from 'vue';
import { VueDraggable } from 'vue-draggable-plus';
import { useRepos } from '../../../repo/state/reposQueries';
import AdeChip from '../AdeChip.vue';
import type { Tone } from '../board/actions';
import {
  type EdgeData,
  type GraphEdge,
  type GraphNode,
  layoutWorkflow,
  type StageNodeData,
  type StepNodeData,
} from '../board/workflowGraph';
import { useSaveWorkflow } from '../queries';
import { useAdeWorkflowDraftStore } from '../state/adeWorkflowDraft';
import { useAdeWorkflowsUiStore } from '../state/adeWorkflowsUi';
import type { StageKind, Workflow, WorkflowEntry } from '../wire';
import AdeEndNode from './AdeEndNode.vue';
import AdeResultEdge from './AdeResultEdge.vue';
import AdeStageGroupNode from './AdeStageGroupNode.vue';
import AdeStageInspector from './AdeStageInspector.vue';
import AdeStepInspector from './AdeStepInspector.vue';
import AdeStepNode from './AdeStepNode.vue';
import AdeWorkflowSaveBar from './AdeWorkflowSaveBar.vue';
import { useSaveShortcut } from './useSaveShortcut';

// Graph mode: edits a local draft of the last valid workflow as a canvas of stages and steps, one
// connector per step result; Save writes it whole, Discard drops the edits. Layout is automatic.
const props = defineProps<{ entry: WorkflowEntry }>();
const wfUi = useAdeWorkflowsUiStore();
const draft = useAdeWorkflowDraftStore();
const repos = useRepos();
const save = useSaveWorkflow();
const confirm = useConfirmDialogStore();
const { fitView, zoomIn, zoomOut, onNodesInitialized } = useVueFlow();

draft.open(props.entry.workflow);
watch(
  () => props.entry.workflow,
  (w) => draft.push(w),
);
watch(
  () => draft.dirty,
  (v) => {
    wfUi.dirty = v;
  },
);

const scopes = computed(() => [
  'once',
  'each repo',
  ...(repos.data.value?.repos ?? []).map((r) => `only ${r.nickname || r.name}`),
]);

async function saveNow(): Promise<void> {
  const current = draft.draft;
  if (!draft.dirty || !current) return;
  const sent = JSON.stringify(current);
  try {
    await save.mutateAsync({ fileName: props.entry.fileName, workflow: current });
    draft.saved(sent);
  } catch (err) {
    draft.error = err instanceof Error ? err.message : String(err);
  }
}
const discard = (): void => draft.discard(props.entry.workflow);

const KIND_TONE: Record<StageKind, Tone> = { user: 'blue', agent: 'amber', script: 'green' };
const strip = computed(() => [...(draft.draft?.stages ?? [])]);

const layout = computed(() => (draft.draft ? layoutWorkflow(draft.draft) : { nodes: [], edges: [] }));
const edgeSel = ref('');

function nodeData(n: GraphNode, wf: Workflow): StepNodeData | StageNodeData | { w: number; h: number } {
  const stage = wf.stages.find((s) => s.id === n.stageId);
  const sel = draft.selection;
  const base = { w: n.w, h: n.h };
  if (!stage || n.kind === 'end') return base;
  if (n.kind === 'step') {
    const step = stage.steps.find((s) => s.id === n.stepId);
    return {
      ...base,
      step,
      start: stage.steps[0]?.id === n.stepId,
      selected: sel?.kind === 'step' && sel.stepId === n.stepId && sel.stageId === n.stageId,
    } as StepNodeData;
  }
  return {
    ...base,
    stage,
    index: wf.stages.indexOf(stage),
    selected: sel?.kind === 'stage' && sel.stageId === stage.id,
  };
}

const flowNodes = computed<Node[]>(() => {
  const wf = draft.draft;
  if (!wf) return [];
  return layout.value.nodes.map((n) => ({
    id: n.id,
    type: n.kind === 'stage' ? 'stage' : n.kind,
    position: { x: n.x, y: n.y },
    parentNode: n.parent,
    draggable: false,
    data: nodeData(n, wf),
  }));
});
const flowEdges = computed<Edge[]>(() =>
  layout.value.edges.map((e) => {
    const stage = e.results.length === 0;
    const data: EdgeData = {
      tone: e.tone,
      loop: e.loop,
      max: e.max,
      results: e.results,
      selected: e.id === edgeSel.value,
      stage,
    };
    return {
      id: e.id,
      type: 'result',
      source: e.source,
      target: e.target,
      sourceHandle: stage ? 'out' : e.sourceHandle,
      targetHandle: 'in',
      selectable: false,
      data,
    };
  }),
);

const byId = (id: string): GraphNode | undefined => layout.value.nodes.find((n) => n.id === id);

function validConnection(c: Connection): boolean {
  const s = byId(c.source);
  const t = byId(c.target);
  return !!s && !!t && s.kind === 'step' && (t.kind === 'step' || t.kind === 'end') && s.stageId === t.stageId;
}
function onConnect(c: Connection): void {
  if (!validConnection(c)) return;
  const s = byId(c.source) as GraphNode;
  const t = byId(c.target) as GraphNode;
  const resultId = (c.sourceHandle ?? '').replace(/^r:/, '');
  if (s.stepId && resultId) draft.route(s.stageId, s.stepId, resultId, t.kind === 'end' ? 'end' : (t.stepId ?? 'end'));
}
function onNodeClick({ node }: { node: Node }): void {
  const n = byId(node.id);
  edgeSel.value = '';
  if (!n) return;
  if (n.kind === 'step' && n.stepId) draft.select({ kind: 'step', stageId: n.stageId, stepId: n.stepId });
  else if (n.kind === 'stage' || n.kind === 'leaf') draft.select({ kind: 'stage', stageId: n.stageId });
}
function onEdgeClick({ edge }: { edge: Edge }): void {
  const e = layout.value.edges.find((x) => x.id === edge.id);
  if (!e?.stepId) return;
  edgeSel.value = e.id;
  draft.select({ kind: 'step', stageId: e.stageId, stepId: e.stepId });
}
function onPaneClick(): void {
  edgeSel.value = '';
  draft.select(null);
}

const root = useTemplateRef<HTMLElement>('root');
const canvas = useTemplateRef<HTMLElement>('canvas');
useSaveShortcut(root, () => void saveNow());

const fit = (): void => void fitView({ padding: 0.12, maxZoom: 1 });
onNodesInitialized(() => nextTick(fit));
useResizeObserver(canvas, () => fit());

const IN_FIELD = 'input, textarea, select, [contenteditable]';
onKeyStroke(
  'Delete',
  async (ev) => {
    if (ev.target instanceof Element && ev.target.closest(IN_FIELD)) return;
    const edge: GraphEdge | undefined = layout.value.edges.find((x) => x.id === edgeSel.value);
    const sel = draft.selection;
    if (edge?.stepId) {
      draft.clear(edge.stageId, edge.stepId, edge.results);
      edgeSel.value = '';
    } else if (sel?.kind === 'step') {
      const ok = await confirm.confirmDialog('Remove this step?', { danger: true, confirmLabel: 'Remove' });
      if (ok) draft.deleteStep(sel.stageId, sel.stepId);
    }
  },
  { target: root },
);

function onStripUpdate(ev: { oldIndex?: number; newIndex?: number }): void {
  if (ev.oldIndex !== undefined && ev.newIndex !== undefined) draft.reorderStages(ev.oldIndex, ev.newIndex);
}

onBeforeUnmount(() => {
  wfUi.dirty = false;
  draft.open(null);
});
</script>

<template>
  <div v-if="draft.draft" ref="root" class="flex h-full min-h-0 flex-col gap-3" data-testid="ade-wf-form">
    <AdeWorkflowSaveBar :dirty="draft.dirty" :saving="save.isPending.value" @save="saveNow" @discard="discard" />
    <div class="flex flex-wrap items-center gap-x-4 gap-y-2">
      <label for="ade-wf-form-name" class="text-kira-sm text-muted-foreground">Name</label>
      <Input
        id="ade-wf-form-name"
        :model-value="draft.draft.name"
        size="kira-lg"
        class="w-72 font-semibold"
        data-testid="ade-wf-form-name"
        @update:model-value="(v: string | number) => draft.patchWorkflow({ name: String(v) })"
      />
      <div class="flex items-center gap-2 text-kira-md">
        <Switch
          id="ade-wf-form-space"
          :model-value="draft.draft.kiraSpaceMcp"
          data-testid="ade-wf-form-space"
          @update:model-value="(v: boolean) => draft.patchWorkflow({ kiraSpaceMcp: v })"
        />
        <label for="ade-wf-form-space" title="Agent steps can declare repos on the task and request branches and worktrees through Kira Space.">Kira Space tools for agents</label>
      </div>
    </div>
    <div class="flex items-center gap-2" data-testid="ade-wf-strip-row">
      <VueDraggable
        :model-value="strip"
        class="flex min-w-0 flex-wrap items-center gap-1.5"
        :animation="150"
        :force-fallback="true"
        data-testid="ade-wf-strip"
        @update="onStripUpdate"
      >
        <button
          v-for="(s, i) in strip"
          :key="s.id"
          type="button"
          class="flex cursor-grab items-center gap-1.5 rounded-kira border bg-elevated px-2 py-1 text-kira-sm"
          :class="[
            draft.selection?.stageId === s.id ? 'border-info' : 'border-border',
            s.skip ? 'opacity-60' : '',
          ]"
          data-testid="ade-wf-strip-chip"
          :data-stage-id="s.id"
          :data-skipped="s.skip"
          @click="draft.select({ kind: 'stage', stageId: s.id })"
        >
          <span class="font-bold">{{ i + 1 }}.</span>
          <span :class="s.skip ? 'line-through' : ''">{{ s.name }}</span>
          <AdeChip :label="s.kind" :tone="KIND_TONE[s.kind]" />
        </button>
      </VueDraggable>
      <Button
        variant="dialog"
        size="kira-lg"
        class="border-dashed bg-transparent"
        data-testid="ade-wf-add-stage"
        @click="draft.createStage()"
      >
        + Add stage
      </Button>
    </div>
    <ResizablePanelGroup direction="horizontal" class="min-h-96 flex-1 rounded-kira border border-border bg-bg">
      <ResizablePanel :default-size="66" :min-size="35" class="relative">
        <div ref="canvas" class="absolute inset-0" data-testid="ade-wf-graph">
          <svg class="absolute size-0" aria-hidden="true">
            <defs>
              <marker
                v-for="m in [
                  ['ade-arrow-ok', 'fill-tone-green-solid'],
                  ['ade-arrow-fail', 'fill-tone-red-solid'],
                  ['ade-arrow-neutral', 'fill-muted-foreground'],
                ]"
                :id="m[0]"
                :key="m[0]"
                viewBox="0 0 10 10"
                refX="9"
                refY="5"
                markerWidth="9"
                markerHeight="9"
                orient="auto-start-reverse"
                markerUnits="userSpaceOnUse"
              >
                <path d="M 0 0 L 10 5 L 0 10 z" :class="m[1]" />
              </marker>
            </defs>
          </svg>
          <VueFlow
            :nodes="flowNodes"
            :edges="flowEdges"
            :nodes-draggable="false"
            :delete-key-code="null"
            :min-zoom="0.2"
            :max-zoom="1.5"
            :is-valid-connection="validConnection"
            @connect="onConnect"
            @node-click="onNodeClick"
            @edge-click="onEdgeClick"
            @pane-click="onPaneClick"
          >
            <template #node-step="p"><AdeStepNode :data="p.data" /></template>
            <template #node-stage="p"><AdeStageGroupNode :data="p.data" /></template>
            <template #node-leaf="p"><AdeStageGroupNode :data="p.data" /></template>
            <template #node-end="p"><AdeEndNode :data="p.data" /></template>
            <template #edge-result="p"><AdeResultEdge v-bind="p" /></template>
          </VueFlow>
          <div class="absolute right-2 top-2 flex gap-1" data-testid="ade-wf-graph-tools">
            <TooltipIconButton icon="zoom-in" label="Zoom in" data-testid="ade-wf-zoom-in" @click="zoomIn()" />
            <TooltipIconButton icon="zoom-out" label="Zoom out" data-testid="ade-wf-zoom-out" @click="zoomOut()" />
            <TooltipIconButton icon="screen-full" label="Fit view" data-testid="ade-wf-fit" @click="fit()" />
          </div>
        </div>
      </ResizablePanel>
      <ResizableHandle />
      <ResizablePanel :default-size="34" :min-size="22">
        <div class="h-full overflow-auto p-3" data-testid="ade-wf-inspector">
          <AdeStepInspector
            v-if="draft.step && draft.stage"
            :key="draft.step.id"
            :stage-id="draft.stage.id"
            :step="draft.step"
            :steps="draft.stage.steps"
            :scopes="scopes"
          />
          <AdeStageInspector v-else-if="draft.stage" :key="draft.stage.id" :stage="draft.stage" :scopes="scopes" />
          <p v-else class="m-0 text-kira-sm text-subtle" data-testid="ade-wf-inspector-empty">
            Select a stage or a step to edit it. Drag from a result dot to another step to set where it goes.
            <span class="font-data">{task} {jira} {repo} {branch} {worktree}</span> are filled in per run.
          </p>
        </div>
      </ResizablePanel>
    </ResizablePanelGroup>
    <p v-if="draft.error" class="m-0 text-kira-sm text-error" data-testid="ade-wf-save-error">
      {{ draft.error }}
      <Button
        variant="link"
        size="kira"
        class="px-1 text-kira-sm text-info"
        data-testid="ade-wf-switch-yaml"
        @click="wfUi.workflowMode = 'yaml'"
      >
        Switch to YAML
      </Button>
    </p>
  </div>
  <p v-else class="m-0 text-kira-md text-muted-foreground" data-testid="ade-wf-no-valid">
    This file has no valid version yet.
    <Button
      variant="link"
      size="kira"
      class="px-1 text-kira-md text-info"
      @click="wfUi.workflowMode = 'yaml'"
    >
      Fix it in YAML
    </Button>
  </p>
</template>
