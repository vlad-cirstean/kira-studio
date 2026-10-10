<script setup lang="ts">
import type { ScriptKind, ScriptParam } from '@shared/domain/scripts';
import { Field, FieldDescription, FieldError, FieldLabel } from '@theme/components/ui/field';
import VarText from '@theme/components/VarText.vue';
import AutocompleteField from '@workbench/components/AutocompleteField.vue';
import { braceToken, envToken } from '@workbench/editor/fieldCompletion';
import { computed } from 'vue';
import { scriptCandidates, scriptHighlights, scriptHover, usesParts } from './scriptVars';

// The prompt (smart) or command: a multiline AutocompleteField that suggests the declared
// parameters and, in Kira Space, the ADE built-ins while typing `{name` or `$KIRA_…`.
const props = defineProps<{
  kind: ScriptKind;
  params: readonly ScriptParam[];
  ade: boolean;
  error?: string;
}>();
const body = defineModel<string>({ required: true });

const isSmart = computed(() => props.kind === 'smart');
const src = computed(() => ({ kind: props.kind, params: props.params, ade: props.ade }));
const candidates = computed(() => scriptCandidates(src.value));
const highlights = computed(() => scriptHighlights(src.value));
const hover = computed(() => scriptHover(src.value));
const parts = computed(() => usesParts(src.value, body.value));
const used = computed(() => parts.value.length > 1);
</script>

<template>
  <Field>
    <FieldLabel for="script-command">{{ isSmart ? 'Prompt' : 'Command' }}</FieldLabel>
    <AutocompleteField
      id="script-command"
      v-model="body"
      multiline
      :rows="8"
      :auto-close="false"
      open-on-empty-token
      :candidates="candidates"
      :token-at="isSmart ? braceToken : envToken"
      :range-highlights="highlights"
      :hover-at="hover"
      :invalid="!!error"
      :placeholder="isSmart ? 'Summarize the open TODOs in this folder' : 'npm run build'"
      class="w-full"
      data-testid="script-dialog-command"
    />
    <FieldError v-if="error" data-testid="script-dialog-command-error">{{ error }}</FieldError>
    <FieldDescription v-if="used" data-testid="script-dialog-uses"><VarText :parts="parts" /></FieldDescription>
    <FieldDescription v-else-if="isSmart" data-testid="script-dialog-uses">
      Use {name} to insert a parameter. Press Cmd/Ctrl+Enter to save.
    </FieldDescription>
    <FieldDescription v-else>Runs in your login shell; lines run in order. Press Cmd/Ctrl+Enter to save.</FieldDescription>
  </Field>
</template>
