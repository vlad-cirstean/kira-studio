<script setup lang="ts">
import { Button } from '@theme/components/ui/button';
import { FieldError } from '@theme/components/ui/field';
import { Input } from '@theme/components/ui/input';
import { Label } from '@theme/components/ui/label';
import { NativeSelect } from '@theme/components/ui/native-select';
import { Popover, PopoverContent, PopoverTrigger } from '@theme/components/ui/popover';
import { t } from '@theme/i18n';
import { errorText } from '@workbench/bridge/codedError';
import { ref } from 'vue';
import { useAddArtifact } from '../queries';
import type { AddArtifactArgs } from '../wire';

// Adds a stored artifact the app cannot detect: a doc, a deployment, an outside link.
const props = defineProps<{ taskId: string }>();
const KINDS: AddArtifactArgs['kind'][] = ['doc', 'link', 'deployment', 'changeRequest', 'issue'];
const KIND_LABEL = {
  doc: 'space.ade.artifacts.kind.doc.label',
  link: 'space.ade.artifacts.kind.link.label',
  deployment: 'space.ade.artifacts.kind.deployment.label',
  changeRequest: 'common.gitHost.changeRequest.label',
  issue: 'space.ade.taskTab.issue.label',
} as const;

const open = ref(false);
const kind = ref<AddArtifactArgs['kind']>('doc');
const title = ref('');
const url = ref('');
const ref_ = ref('');
const error = ref('');
const add = useAddArtifact();

async function submit(): Promise<void> {
  error.value = '';
  try {
    await add.mutateAsync({
      taskId: props.taskId,
      kind: kind.value,
      title: title.value.trim(),
      url: url.value.trim(),
      ref: ref_.value.trim(),
    });
    title.value = url.value = ref_.value = '';
    open.value = false;
  } catch (err) {
    error.value = errorText(err);
  }
}
</script>

<template>
  <Popover v-model:open="open">
    <PopoverTrigger as-child>
      <Button variant="dialog" size="kira" data-testid="ade-artifact-add">{{
        t('space.ade.artifacts.add.label')
      }}</Button>
    </PopoverTrigger>
    <PopoverContent align="end" class="flex w-80 flex-col gap-2" data-testid="ade-artifact-form">
      <Label for="ade-artifact-kind" class="text-muted-foreground">{{
        t('common.field.kind.label')
      }}</Label>
      <NativeSelect
        id="ade-artifact-kind"
        v-model="kind"
        variant="bordered"
        size="kira-lg"
        data-testid="ade-artifact-kind"
      >
        <option v-for="k in KINDS" :key="k" :value="k">{{ t(KIND_LABEL[k]) }}</option>
      </NativeSelect>
      <Label for="ade-artifact-title" class="text-muted-foreground">{{
        t('common.field.title.label')
      }}</Label>
      <Input
        id="ade-artifact-title"
        v-model="title"
        size="kira-lg"
        data-testid="ade-artifact-title-input"
      />
      <Label for="ade-artifact-url" class="text-muted-foreground">{{
        t('space.ade.artifacts.url.label')
      }}</Label>
      <Input
        id="ade-artifact-url"
        v-model="url"
        size="kira-lg"
        data-testid="ade-artifact-url-input"
      />
      <Label for="ade-artifact-ref" class="text-muted-foreground">{{
        t('space.ade.artifacts.ref.label')
      }}</Label>
      <Input
        id="ade-artifact-ref"
        v-model="ref_"
        size="kira-lg"
        data-testid="ade-artifact-ref-input"
      />
      <FieldError v-if="error" data-testid="ade-artifact-error">{{ error }}</FieldError>
      <Button
        variant="dialog-primary"
        size="kira-lg"
        :pending="add.isPending.value"
        :disabled="!title.trim() || (!url.trim() && !ref_.trim())"
        data-testid="ade-artifact-submit"
        @click="submit"
      >
        {{ t('common.action.add.label') }}
      </Button>
    </PopoverContent>
  </Popover>
</template>
