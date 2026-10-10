<script setup lang="ts">
import CodiconIcon from '@theme/CodiconIcon.vue';
import { Button } from '@theme/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@theme/components/ui/dropdown-menu';
import { Input } from '@theme/components/ui/input';
import { Label } from '@theme/components/ui/label';
import { NativeSelect } from '@theme/components/ui/native-select';
import { Switch } from '@theme/components/ui/switch';
import { Textarea } from '@theme/components/ui/textarea';
import { FAILURE_OPTIONS, STATUS_OPTIONS, withKind } from '../board/workflowForm';
import { useAdeWorkflowDraftStore } from '../state/adeWorkflowDraft';
import type { OnFailure, Stage, StageKind } from '../wire';

// The selected stage: name, type, task status, and the fields of its kind. Agent steps live on the canvas.
const props = defineProps<{ stage: Stage; scopes: string[] }>();
const draft = useAdeWorkflowDraftStore();
const patch = (p: Partial<Stage>): void => draft.patchStage(props.stage.id, p);
const n = (k: string): string => `ade-wf-stage-${k}-${props.stage.id}`;
</script>

<template>
  <div class="flex flex-col gap-2.5" data-testid="ade-wf-stage" :data-stage-id="stage.id" :data-skipped="stage.skip">
    <div class="flex items-center gap-2">
      <Label :for="n('name')" class="sr-only">Stage name</Label>
      <Input
        :id="n('name')"
        :model-value="stage.name"
        size="kira"
        class="min-w-0 flex-1 font-medium"
        data-testid="ade-wf-stage-name"
        @update:model-value="(v: string | number) => patch({ name: String(v) })"
      />
      <DropdownMenu>
        <DropdownMenuTrigger as-child>
          <Button variant="toolbar" size="kira-icon" aria-label="Stage actions" data-testid="ade-wf-stage-menu">
            <CodiconIcon name="kebab-vertical" :size="13" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            :disabled="!stage.skip && !draft.canSkip"
            data-testid="ade-wf-stage-skip"
            @select="patch({ skip: !stage.skip })"
          >
            {{ stage.skip ? "Don't skip stage" : 'Skip stage' }}
          </DropdownMenuItem>
          <DropdownMenuItem class="text-error" data-testid="ade-wf-stage-remove" @select="draft.removeStage(stage.id)">
            Remove stage
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
    <div class="flex flex-wrap items-center gap-3 text-kira-sm text-muted-foreground">
      <Label class="font-normal" :for="n('kind')">Type</Label>
      <NativeSelect
        :id="n('kind')"
        variant="bordered"
        class="min-w-31"
        :model-value="stage.kind"
        data-testid="ade-wf-stage-kind"
        @update:model-value="(v) => draft.replaceStage(withKind(stage, String(v) as StageKind))"
      >
        <option value="user">user</option>
        <option value="agent">agent (background)</option>
        <option value="script">script</option>
      </NativeSelect>
      <Label class="font-normal" :for="n('status')">Task status</Label>
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
    </div>

    <template v-if="stage.kind === 'user'">
      <div class="flex items-center gap-2.5 text-kira-md">
        <Switch
          :id="n('session')"
          :model-value="stage.session"
          :class="stage.session && 'data-[state=checked]:border-claude data-[state=checked]:bg-claude'"
          data-testid="ade-wf-stage-session"
          @update:model-value="(v: boolean) => patch({ session: v, prompt: v ? stage.prompt : '' })"
        />
        <Label class="font-normal" :for="n('session')">Opens an interactive Claude Code session</Label>
      </div>
      <template v-if="stage.session">
        <Label :for="n('prompt')" class="sr-only">Session prompt</Label>
        <Textarea
          :id="n('prompt')"
          :model-value="stage.prompt"
          placeholder="First message for the session (optional)"
          class="min-h-12 w-auto resize-y leading-normal"
          data-testid="ade-wf-stage-prompt"
          @update:model-value="(v: string | number) => patch({ prompt: String(v) })"
        />
      </template>
    </template>

    <div v-else-if="stage.kind === 'script'" class="flex flex-col gap-1.5">
      <Label :for="n('command')" class="font-normal text-kira-sm text-muted-foreground"
        >Command
        <span class="text-subtle"
          >(runs in each branch's worktree; non-zero exit = failed; {task} {jira} {repo} {branch} {worktree} are
          shell-quoted when needed)</span
        ></Label
      >
      <Textarea
        :id="n('command')"
        :model-value="stage.command"
        placeholder="./scripts/release.sh --branch {branch}"
        class="min-h-12 w-auto resize-y font-data leading-normal"
        data-testid="ade-wf-stage-command"
        @update:model-value="(v: string | number) => patch({ command: String(v) })"
      />
      <div class="flex flex-wrap items-center gap-3 text-kira-sm text-muted-foreground">
        <Label class="font-normal" :for="n('scope')">Runs on</Label>
        <NativeSelect
          :id="n('scope')"
          variant="bordered"
          :model-value="stage.runsOn"
          data-testid="ade-wf-stage-scope"
          @update:model-value="(v) => patch({ runsOn: String(v) as Stage['runsOn'] })"
        >
          <option v-for="s in scopes" :key="s" :value="s">{{ s }}</option>
        </NativeSelect>
        <Label class="font-normal" :for="n('fail')">On failure</Label>
        <NativeSelect
          :id="n('fail')"
          variant="bordered"
          :model-value="stage.onFailure"
          data-testid="ade-wf-stage-fail"
          @update:model-value="(v) => patch({ onFailure: String(v) as OnFailure })"
        >
          <option v-for="o in FAILURE_OPTIONS" :key="o" :value="o">{{ o }}</option>
        </NativeSelect>
        <Label class="font-normal" :for="n('timeout')">Timeout</Label>
        <Input
          :id="n('timeout')"
          :model-value="stage.timeout"
          size="kira"
          class="w-14"
          data-testid="ade-wf-stage-timeout"
          @update:model-value="(v: string | number) => patch({ timeout: String(v) })"
        />
      </div>
    </div>

    <Button
      v-else
      variant="dialog"
      size="kira-lg"
      class="self-start border-dashed bg-transparent"
      data-testid="ade-wf-add-step"
      @click="draft.createStep(stage.id)"
    >
      + Add step
    </Button>
  </div>
</template>
