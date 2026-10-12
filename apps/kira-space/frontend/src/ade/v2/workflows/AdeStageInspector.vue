<script setup lang="ts">
import CodiconIcon from '@theme/CodiconIcon.vue';
import { Button } from '@theme/components/ui/button';
import { Checkbox } from '@theme/components/ui/checkbox';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@theme/components/ui/dropdown-menu';
import { Input } from '@theme/components/ui/input';
import { Label } from '@theme/components/ui/label';
import { NativeSelect } from '@theme/components/ui/native-select';
import { Textarea } from '@theme/components/ui/textarea';
import { t } from '@theme/i18n';
import CatalogText from '@theme/i18n/CatalogText.vue';
import { ICON } from '@theme/icons';
import { statusLabel } from '../board/actions';
import {
  FAILURE_OPTIONS,
  failureLabel,
  kindLabel,
  PLACEHOLDER_TOKENS,
  runsOnLabel,
  STATUS_OPTIONS,
  withKind,
} from '../board/workflowForm';
import { useAdeWorkflowDraftStore } from '../state/adeWorkflowDraft';
import type { OnFailure, Stage, StageKind } from '../wire';

// The selected stage: name, type, task status, and the fields of its kind. Agent steps live on the canvas.
const props = defineProps<{ stage: Stage; scopes: string[] }>();
const draft = useAdeWorkflowDraftStore();
const patch = (p: Partial<Stage>): void => draft.patchStage(props.stage.id, p);
const n = (k: string): string => `ade-wf-stage-${k}-${props.stage.id}`;
</script>

<template>
  <div
    class="flex flex-col gap-2.5"
    data-testid="ade-wf-stage"
    :data-stage-id="stage.id"
    :data-skipped="stage.skip"
  >
    <div class="flex items-center gap-2">
      <Label :for="n('name')" class="sr-only">{{
        t('space.ade.workflows.stageInspector.name.aria')
      }}</Label>
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
          <Button
            variant="toolbar"
            size="kira-icon"
            :aria-label="t('space.ade.workflows.stageInspector.actions.aria')"
            data-testid="ade-wf-stage-menu"
          >
            <CodiconIcon :name="ICON.moreActions" :size="13" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            :disabled="!stage.skip && !draft.canSkip"
            data-testid="ade-wf-stage-skip"
            @select="patch({ skip: !stage.skip })"
          >
            {{
              stage.skip ? t('space.ade.workflows.stageInspector.unskip.label') : t('space.ade.workflows.stageInspector.skip.label')
            }}
          </DropdownMenuItem>
          <DropdownMenuItem
            class="text-error"
            data-testid="ade-wf-stage-remove"
            @select="draft.removeStage(stage.id)"
          >
            {{ t('space.ade.workflows.stageInspector.remove.label') }}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
    <div class="flex flex-wrap items-center gap-3 text-kira-sm text-muted-foreground">
      <Label :for="n('kind')">{{ t('common.field.type.label') }}</Label>
      <NativeSelect
        :id="n('kind')"
        variant="bordered"
        class="min-w-31"
        :model-value="stage.kind"
        data-testid="ade-wf-stage-kind"
        @update:model-value="(v) => draft.replaceStage(withKind(stage, String(v) as StageKind))"
      >
        <option value="user">{{ kindLabel('user') }}</option>
        <option value="agent">{{ kindLabel('agent', true) }}</option>
        <option value="script">{{ kindLabel('script') }}</option>
      </NativeSelect>
      <Label :for="n('status')">{{ t('space.ade.board.taskStatus.tooltip') }}</Label>
      <NativeSelect
        :id="n('status')"
        variant="bordered"
        :title="t('space.ade.workflows.stageInspector.status.tooltip')"
        :model-value="stage.status"
        data-testid="ade-wf-stage-status"
        @update:model-value="(v) => patch({ status: String(v) as Stage['status'] })"
      >
        <option v-for="o in STATUS_OPTIONS" :key="o" :value="o">{{ statusLabel(o) }}</option>
      </NativeSelect>
    </div>

    <template v-if="stage.kind === 'user'">
      <div class="flex items-center gap-2.5 text-kira-md">
        <Checkbox
          :id="n('session')"
          :model-value="stage.session"
          :class="stage.session && 'data-[state=checked]:border-claude data-[state=checked]:bg-claude'"
          data-testid="ade-wf-stage-session"
          @update:model-value="(v) => patch({ session: v === true, prompt: v === true ? stage.prompt : '' })"
        />
        <Label :for="n('session')">{{
          t('space.ade.workflows.stageInspector.session.label')
        }}</Label>
      </div>
      <template v-if="stage.session">
        <Label :for="n('prompt')" class="sr-only">{{
          t('space.ade.workflows.stageInspector.prompt.aria')
        }}</Label>
        <Textarea
          :id="n('prompt')"
          :model-value="stage.prompt"
          :placeholder="t('space.ade.workflows.stageInspector.prompt.placeholder')"
          class="min-h-12 w-auto resize-y leading-normal"
          data-testid="ade-wf-stage-prompt"
          @update:model-value="(v: string | number) => patch({ prompt: String(v) })"
        />
      </template>
    </template>

    <div v-else-if="stage.kind === 'script'" class="flex flex-col gap-1.5">
      <Label :for="n('command')" class="text-kira-sm text-muted-foreground"
        >{{ t('common.field.command.label') }}
        <span class="text-subtle">
          <CatalogText k="space.ade.workflows.stageInspector.command.hint">
            <template #tokens><span class="font-data">{{ PLACEHOLDER_TOKENS }}</span></template>
          </CatalogText>
        </span></Label
      >
      <Textarea
        :id="n('command')"
        :model-value="stage.command"
        :placeholder="t('space.ade.workflows.stageInspector.command.example', { branch: '{branch}' })"
        class="min-h-12 w-auto resize-y font-data leading-normal"
        data-testid="ade-wf-stage-command"
        @update:model-value="(v: string | number) => patch({ command: String(v) })"
      />
      <div class="flex flex-wrap items-center gap-3 text-kira-sm text-muted-foreground">
        <Label :for="n('scope')">{{ t('space.ade.workflows.field.runsOn.label') }}</Label>
        <NativeSelect
          :id="n('scope')"
          variant="bordered"
          :model-value="stage.runsOn"
          data-testid="ade-wf-stage-scope"
          @update:model-value="(v) => patch({ runsOn: String(v) as Stage['runsOn'] })"
        >
          <option v-for="s in scopes" :key="s" :value="s">{{ runsOnLabel(s) }}</option>
        </NativeSelect>
        <Label :for="n('fail')">{{ t('space.ade.workflows.field.onFailure.label') }}</Label>
        <NativeSelect
          :id="n('fail')"
          variant="bordered"
          :model-value="stage.onFailure"
          data-testid="ade-wf-stage-fail"
          @update:model-value="(v) => patch({ onFailure: String(v) as OnFailure })"
        >
          <option v-for="o in FAILURE_OPTIONS" :key="o" :value="o">{{ failureLabel(o) }}</option>
        </NativeSelect>
        <Label :for="n('timeout')">{{ t('common.field.timeout.label') }}</Label>
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
      {{ t('space.ade.workflows.stageInspector.addStep.label') }}
    </Button>
  </div>
</template>
