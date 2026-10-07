<script setup lang="ts">
import { Button } from '@theme/components/ui/button';
import { Input } from '@theme/components/ui/input';
import { NativeSelect } from '@theme/components/ui/native-select';
import { Switch } from '@theme/components/ui/switch';
import { Textarea } from '@theme/components/ui/textarea';
import { type MenuItem, useContextMenuStore } from '@workbench/state/contextMenu';
import AdeChip from '../AdeChip.vue';
import type { Tone } from '../board/actions';
import { FAILURE_OPTIONS, moved, newStep, STATUS_OPTIONS, withKind, withValidBacks } from '../board/workflowForm';
import { actionStyle } from '../tones';
import type { OnFailure, Stage, StageKind } from '../wire';
import AdeStepCard from './AdeStepCard.vue';

// One stage of the form: header (name, type, task status, order), then the fields of its kind.
const props = defineProps<{ index: number; scopes: string[]; first: boolean; last: boolean; canSkip: boolean }>();
const contextMenu = useContextMenuStore();
const sessionOn = { background: actionStyle('claude').background, borderColor: actionStyle('claude').background };
const stage = defineModel<Stage>('stage', { required: true });
const emit = defineEmits<{ up: []; down: []; remove: [] }>();

const KIND_TONE: Record<StageKind, Tone> = { user: 'blue', agent: 'amber', script: 'green' };
const n = (k: string): string => `ade-wf-stage-${k}-${props.index}`;

const NATIVE_MENU = 'input, textarea, select, [contenteditable]';
function onMenu(ev: MouseEvent): void {
  if (ev.target instanceof Element && ev.target.closest(NATIVE_MENU)) return;
  ev.preventDefault();
  const items: MenuItem[] = [
    { type: 'label', label: stage.value.name },
    {
      type: 'item',
      id: 'ade-wf-stage-skip',
      label: stage.value.skip ? "Don't skip stage" : 'Skip stage',
      disabled: !stage.value.skip && !props.canSkip,
      hint: !stage.value.skip && !props.canSkip ? 'At least one stage must run' : undefined,
      run: () => patch({ skip: !stage.value.skip }),
    },
    { type: 'separator' },
    { type: 'item', id: 'ade-wf-stage-menu-up', label: 'Move up', disabled: props.first, run: () => emit('up') },
    { type: 'item', id: 'ade-wf-stage-menu-down', label: 'Move down', disabled: props.last, run: () => emit('down') },
    { type: 'item', id: 'ade-wf-stage-menu-remove', label: 'Remove stage', danger: true, run: () => emit('remove') },
  ];
  contextMenu.openContextMenu(ev, items);
}
function patch(p: Partial<Stage>): void {
  stage.value = { ...stage.value, ...p };
}
function setSteps(steps: Stage['steps']): void {
  patch({ steps: withValidBacks(steps) });
}
function moveStep(i: number, dir: 'up' | 'down'): void {
  setSteps(moved(stage.value.steps, i, dir));
}
function removeStep(i: number): void {
  setSteps(stage.value.steps.filter((_, k) => k !== i));
}
</script>

<template>
  <!-- biome-ignore lint/a11y/noStaticElementInteractions: right-click only; the card holds nested interactive fields. -->
  <div
    class="flex flex-col gap-2 rounded-[10px] border border-l-4 border-border-strong bg-elevated px-3 py-2.5"
    :class="stage.skip ? 'opacity-60' : ''"
    data-testid="ade-wf-stage"
    :data-stage-id="stage.id"
    :data-skipped="stage.skip"
    @contextmenu="onMenu"
  >
    <div class="flex items-center gap-2">
      <span class="w-6 shrink-0 font-data text-kira-lg font-bold" :class="stage.skip ? 'line-through' : ''">{{ index + 1 }}.</span>
      <AdeChip :label="stage.kind" :tone="KIND_TONE[stage.kind]" />
      <AdeChip v-if="stage.skip" label="skipped" tone="grey" data-testid="ade-wf-stage-skipped" />
      <label :for="n('name')" class="sr-only">Stage name</label>
      <Input
        :id="n('name')"
        :model-value="stage.name"
        class="min-w-0 flex-1 bg-field font-bold"
        data-testid="ade-wf-stage-name"
        @update:model-value="(v: string | number) => patch({ name: String(v) })"
      />
      <label :for="n('kind')" class="sr-only">Stage type</label>
      <NativeSelect
        :id="n('kind')"
        variant="bordered"
        class="min-w-31"
        :model-value="stage.kind"
        data-testid="ade-wf-stage-kind"
        @update:model-value="(v) => (stage = withKind(stage, String(v) as StageKind))"
      >
        <option value="user">user</option>
        <option value="agent">agent (background)</option>
        <option value="script">script</option>
      </NativeSelect>
      <label :for="n('status')" class="whitespace-nowrap text-kira-sm text-muted-foreground">Task status</label>
      <NativeSelect
        :id="n('status')"
        variant="bordered"
        title="Task status while in this stage"
        :model-value="stage.status"
        data-testid="ade-wf-stage-status"
        @update:model-value="(v) => patch({ status: String(v) as Stage['status'] })"
      >
        <option v-for="o in STATUS_OPTIONS" :key="o" :value="o">{{ o }}</option>
      </NativeSelect>
      <Button variant="dialog" size="icon-xs" aria-label="Move stage up" :disabled="first" data-testid="ade-wf-stage-up" @click="emit('up')">↑</Button>
      <Button variant="dialog" size="icon-xs" aria-label="Move stage down" :disabled="last" data-testid="ade-wf-stage-down" @click="emit('down')">↓</Button>
      <Button variant="dialog" size="icon-xs" class="text-error" aria-label="Remove stage" data-testid="ade-wf-stage-remove" @click="emit('remove')">✕</Button>
    </div>

    <template v-if="stage.kind === 'user'">
      <div class="flex items-center gap-2.5 pl-8 text-kira-md">
        <Switch
          :id="n('session')"
          :model-value="stage.session"
          :style="stage.session ? sessionOn : undefined"
          data-testid="ade-wf-stage-session"
          @update:model-value="(v: boolean) => patch({ session: v, prompt: v ? stage.prompt : '' })"
        />
        <label :for="n('session')">Opens an interactive Claude Code session</label>
      </div>
      <template v-if="stage.session">
        <label :for="n('prompt')" class="sr-only">Session prompt</label>
        <Textarea
          :id="n('prompt')"
          :model-value="stage.prompt"
          placeholder="First message for the session (optional)"
          class="ml-8 min-h-11 w-auto resize-y bg-bg px-2 py-1.5 font-data leading-normal"
          data-testid="ade-wf-stage-prompt"
          @update:model-value="(v: string | number) => patch({ prompt: String(v) })"
        />
      </template>
    </template>

    <div v-else-if="stage.kind === 'script'" class="flex flex-col gap-1.5 pl-8">
      <label :for="n('command')" class="text-kira-sm text-muted-foreground"
        >Command
        <span class="text-subtle"
          >(runs in each branch's worktree; non-zero exit = failed; {task} {jira} {repo} {branch} {worktree} are
          shell-quoted when needed)</span
        ></label
      >
      <Textarea
        :id="n('command')"
        :model-value="stage.command"
        placeholder="./scripts/release.sh --branch {branch}"
        class="min-h-11 w-auto resize-y bg-bg px-2 py-1.5 font-data leading-normal"
        data-testid="ade-wf-stage-command"
        @update:model-value="(v: string | number) => patch({ command: String(v) })"
      />
      <div class="flex flex-wrap items-center gap-3 text-kira-sm text-muted-foreground">
        <label :for="n('scope')">Runs on</label>
        <NativeSelect
          :id="n('scope')"
          variant="bordered"
          :model-value="stage.runsOn"
          data-testid="ade-wf-stage-scope"
          @update:model-value="(v) => patch({ runsOn: String(v) as Stage['runsOn'] })"
        >
          <option v-for="s in scopes" :key="s" :value="s">{{ s }}</option>
        </NativeSelect>
        <label :for="n('fail')">On failure</label>
        <NativeSelect
          :id="n('fail')"
          variant="bordered"
          :model-value="stage.onFailure"
          data-testid="ade-wf-stage-fail"
          @update:model-value="(v) => patch({ onFailure: String(v) as OnFailure })"
        >
          <option v-for="o in FAILURE_OPTIONS" :key="o" :value="o">{{ o }}</option>
        </NativeSelect>
        <label :for="n('timeout')">Timeout</label>
        <Input
          :id="n('timeout')"
          :model-value="stage.timeout"
          class="w-14 bg-field px-1.5 font-data"
          data-testid="ade-wf-stage-timeout"
          @update:model-value="(v: string | number) => patch({ timeout: String(v) })"
        />
      </div>
    </div>

    <div v-else class="flex flex-col gap-1.5 pl-8">
      <AdeStepCard
        v-for="(s, i) in stage.steps"
        :key="s.id"
        :step="s"
        :steps="stage.steps"
        :index="i"
        :label="`${index + 1}.${i + 1}`"
        :scopes="scopes"
        :first="i === 0"
        :last="i === stage.steps.length - 1"
        @update:step="(v) => setSteps(stage.steps.map((x, k) => (k === i ? v : x)))"
        @up="moveStep(i, 'up')"
        @down="moveStep(i, 'down')"
        @remove="removeStep(i)"
      />
      <Button
        variant="dialog"
        size="xs"
        class="self-start border-dashed bg-transparent px-2.5"
        data-testid="ade-wf-add-step"
        @click="setSteps([...stage.steps, newStep(stage.steps)])"
      >
        + Add step
      </Button>
    </div>
  </div>
</template>
