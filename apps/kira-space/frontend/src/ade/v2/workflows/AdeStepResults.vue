<script setup lang="ts">
import TooltipIconButton from '@theme/components/TooltipIconButton.vue';
import { Button } from '@theme/components/ui/button';
import { Input } from '@theme/components/ui/input';
import { Label } from '@theme/components/ui/label';
import { NativeSelect } from '@theme/components/ui/native-select';
import { Switch } from '@theme/components/ui/switch';
import { MAX_LOOP_MAX } from '../board/stepResults';
import { useAdeWorkflowDraftStore } from '../state/adeWorkflowDraft';
import type { PipelineStep } from '../wire';

// The results a step can end with, each with where it goes. The route selects are the keyboard path
// for everything a connection drag does on the canvas.
const props = defineProps<{ stageId: string; step: PipelineStep; steps: PipelineStep[] }>();
const draft = useAdeWorkflowDraftStore();
const id = (k: string, rid: string): string => `ade-wf-result-${k}-${props.step.id}-${rid}`;
</script>

<template>
  <div class="flex flex-col gap-1.5" data-testid="ade-wf-results">
    <div class="text-kira-sm text-muted-foreground">
      Results: the agent picks one when the step ends; each one sets where the stage goes next.
    </div>
    <div
      v-for="r in step.results"
      :key="r.id"
      class="flex flex-col gap-1 rounded-kira-sm border border-border p-2"
      data-testid="ade-wf-result"
      :data-result="r.id"
    >
      <div class="flex items-center gap-2">
        <Label :for="id('id', r.id)" class="sr-only">Result id</Label>
        <Input
          :id="id('id', r.id)"
          :model-value="r.id"
          size="kira"
          class="min-w-0 flex-1 font-data"
          data-testid="ade-wf-result-id"
          @update:model-value="(v: string | number) => draft.changeResult(stageId, step.id, r.id, { id: String(v) })"
        />
        <Label :for="id('ok', r.id)" class="font-normal text-kira-sm text-muted-foreground">ok</Label>
        <Switch
          :id="id('ok', r.id)"
          :model-value="r.ok"
          data-testid="ade-wf-result-ok"
          @update:model-value="(v: boolean) => draft.changeResult(stageId, step.id, r.id, { ok: v })"
        />
        <TooltipIconButton
          icon="close"
          label="Remove result"
          class="text-error"
          :disabled="step.results.length < 2"
          data-testid="ade-wf-result-remove"
          @click="draft.deleteResult(stageId, step.id, r.id)"
        />
      </div>
      <Label :for="id('desc', r.id)" class="sr-only">Result description</Label>
      <Input
        :id="id('desc', r.id)"
        :model-value="r.description"
        placeholder="When to pick it (shown to the agent)"
        size="kira"
        maxlength="200"
        data-testid="ade-wf-result-description"
        @update:model-value="(v: string | number) => draft.changeResult(stageId, step.id, r.id, { description: String(v) })"
      />
      <div class="flex flex-wrap items-center gap-2 text-kira-sm text-muted-foreground">
        <Label class="font-normal" :for="id('route', r.id)">Goes to</Label>
        <NativeSelect
          :id="id('route', r.id)"
          variant="bordered"
          :model-value="r.next"
          data-testid="ade-wf-result-route"
          @update:model-value="(v) => draft.route(stageId, step.id, r.id, String(v))"
        >
          <option value="next">next step</option>
          <option v-for="s in steps" :key="s.id" :value="s.id">{{ s.id === step.id ? '↩ this step' : s.name }}</option>
          <option value="end">end of stage</option>
          <option v-if="!r.ok" value="stop">stop</option>
        </NativeSelect>
        <template v-if="r.max > 0">
          <Label class="font-normal" :for="id('max', r.id)">at most</Label>
          <Input
            :id="id('max', r.id)"
            type="number"
            min="1"
            :max="MAX_LOOP_MAX"
            :model-value="r.max"
            size="kira"
            class="w-14"
            data-testid="ade-wf-result-max"
            @update:model-value="(v: string | number) => draft.changeResult(stageId, step.id, r.id, { max: Number(v) })"
          />
          <span>times</span>
        </template>
      </div>
    </div>
    <Button
      variant="dialog"
      size="kira-lg"
      class="self-start border-dashed bg-transparent"
      :disabled="step.results.length >= 12"
      data-testid="ade-wf-add-result"
      @click="draft.createResult(stageId, step.id)"
    >
      + Add result
    </Button>
  </div>
</template>
