<script setup lang="ts">
import { EXPLAIN_SUPPORTED_KINDS, type McpPermissionMode } from '@shared/domain/connection';
import SecondaryTabs from '@theme/components/SecondaryTabs.vue';
import { Field, FieldDescription, FieldError, FieldLabel } from '@theme/components/ui/field';
import { TabsContent } from '@theme/components/ui/tabs';
import { Textarea } from '@theme/components/ui/textarea';
import { t } from '@theme/i18n';
import { wrapSelectionOnType } from '@theme/wrapSelection';
import { computed } from 'vue';
import { useConnectionDialogStore } from '../../state/connections';
import CheckboxRow from './CheckboxRow.vue';
import { injectConnectionForm } from './form';

const connectionDialogStore = useConnectionDialogStore();
const { errorFor, errorId, invalidAttrs } = injectConnectionForm();
const draft = computed(() => connectionDialogStore.draft);

// Disabled, never hidden, for kinds without a parseable EXPLAIN: the setting stays visible.
const explainSupported = computed(
  () => !!draft.value && EXPLAIN_SUPPORTED_KINDS.has(draft.value.kind),
);

type PermissionClass = 'read' | 'write' | 'ddl';
const CLASSES = [
  {
    cls: 'read',
    label: 'studio.project.connectionDialog.mcp.read.label',
    note: 'studio.project.connectionDialog.mcp.readNote.label',
    field: 'mcpReadMode',
  },
  {
    cls: 'write',
    label: 'studio.project.connectionDialog.mcp.write.label',
    note: 'studio.project.connectionDialog.mcp.writeNote.label',
    field: 'mcpWriteMode',
  },
  {
    cls: 'ddl',
    label: 'studio.project.connectionDialog.mcp.ddl.label',
    note: 'studio.project.connectionDialog.mcp.ddlNote.label',
    field: 'mcpDdlMode',
  },
] as const;

// One segmented control per class; per-button testids are connection-mcp-<class>-<mode>.
function modeOptions(cls: PermissionClass) {
  const disabled = !draft.value?.mcpEnabled;
  const modes: { value: McpPermissionMode; label: string }[] = [
    { value: 'deny', label: t('common.action.deny.label') },
    { value: 'allow', label: t('studio.project.connectionDialog.mcp.allow.label') },
    { value: 'prompt', label: t('studio.project.connectionDialog.mcp.prompt.label') },
  ];
  return modes.map((m) => ({ ...m, testid: `connection-mcp-${cls}-${m.value}`, disabled }));
}

function setMode(field: (typeof CLASSES)[number]['field'], value: string): void {
  if (draft.value) draft.value[field] = value as McpPermissionMode;
}
</script>

<template>
  <TabsContent v-if="draft" value="MCP" class="flex flex-col gap-3 p-3">
    <CheckboxRow
      v-model="draft.mcpEnabled"
      :label="t('studio.project.connectionDialog.mcp.expose.label')"
      :description="t('studio.project.connectionDialog.mcp.expose.description')"
      testid="connection-mcp-enabled"
    />

    <Field class="flex-1">
      <FieldLabel
        >{{ t('common.field.description.label') }}
        <span class="text-subtle"
          >— {{ t('studio.project.connectionDialog.mcp.descriptionNote.label') }}</span
        ></FieldLabel
      >
      <Textarea
        v-model="draft.mcpDescription"
        v-bind="invalidAttrs('mcpDescription')"
        class="font-data"
        rows="2"
        maxlength="1000"
        :disabled="!draft.mcpEnabled"
        data-testid="connection-mcp-description"
        @keydown="wrapSelectionOnType"
      />
      <FieldError v-if="errorFor('mcpDescription')" :id="errorId('mcpDescription')">{{
        errorFor('mcpDescription')
      }}</FieldError>
    </Field>

    <CheckboxRow
      v-model="draft.mcpAutoExplain"
      :disabled="!draft.mcpEnabled || !explainSupported"
      :label="t('studio.project.connectionDialog.mcp.plan.label')"
      :description="explainSupported ? undefined : t('studio.project.connectionDialog.mcp.plan.description')"
      testid="connection-mcp-auto-explain"
    />

    <Field v-for="c in CLASSES" :key="c.cls" class="flex-1">
      <FieldLabel
        >{{ t(c.label) }}
        <span class="text-subtle">— {{ t(c.note) }}</span></FieldLabel
      >
      <SecondaryTabs
        variant="segmented"
        size="kira-lg"
        :model-value="draft[c.field]"
        :items="modeOptions(c.cls)"
        :data-testid="`connection-mcp-${c.cls}`"
        @update:model-value="(v) => setMode(c.field, String(v))"
      />
    </Field>
    <FieldDescription class="w-full">
      {{
        t('studio.project.connectionDialog.mcp.strictest.description', { tab: t('common.advanced.label') })
      }}
    </FieldDescription>
  </TabsContent>
</template>
