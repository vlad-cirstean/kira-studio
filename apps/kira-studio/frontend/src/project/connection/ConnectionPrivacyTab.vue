<script setup lang="ts">
import { FILE_KINDS } from '@shared/domain/connection';
import type { MaskKind, MaskRuleFields } from '@shared/domain/mask';
import { useQuery } from '@tanstack/vue-query';
import TooltipIconButton from '@theme/components/TooltipIconButton.vue';
import TruncatedText from '@theme/components/TruncatedText.vue';
import { Alert, AlertDescription } from '@theme/components/ui/alert';
import { Button } from '@theme/components/ui/button';
import { FieldDescription } from '@theme/components/ui/field';
import { Input } from '@theme/components/ui/input';
import { NativeSelect } from '@theme/components/ui/native-select';
import { TabsContent } from '@theme/components/ui/tabs';
import { type MessageKey, t } from '@theme/i18n';
import { useAsyncAction } from '@workbench/behaviour/asyncAction';
import { useConfirmDialogStore } from '@workbench/state/confirmDialog';
import { computed, ref } from 'vue';
import { useConnectionDialogStore, useConnectionsStore } from '../../state/connections';
import {
  loadMaskRules,
  maskRulesQueryKey,
  regenerateMaskKey,
  removeMaskRule,
  upsertMaskRule,
} from '../../state/maskRules';
import CheckboxRow from './CheckboxRow.vue';

// A rule takes effect immediately: it is not part of the connection's save/cancel draft, so this
// pane reads state/maskRules.ts directly and every control writes straight through it.
const confirmDialogStore = useConfirmDialogStore();
const connectionsStore = useConnectionsStore();
const connectionDialogStore = useConnectionDialogStore();

const connectionId = computed(() => connectionDialogStore.editingId);
const isFileStyle = computed(
  () => !!connectionDialogStore.draft && FILE_KINDS.has(connectionDialogStore.draft.kind),
);
const secretStatus = computed(() => connectionsStore.secretStorage);

const maskRulesQuery = useQuery(() => ({
  queryKey: maskRulesQueryKey(connectionId.value ?? ''),
  queryFn: () => loadMaskRules(connectionId.value ?? ''),
  enabled: !!connectionId.value,
}));
const maskRules = computed(() => maskRulesQuery.data.value ?? []);

const MASK_KIND_OPTIONS: readonly { value: MaskKind; label: MessageKey }[] = [
  { value: 'name', label: 'common.field.name.label' },
  { value: 'email', label: 'common.field.email.label' },
  { value: 'text', label: 'common.field.text.label' },
  { value: 'number', label: 'common.field.number.label' },
  { value: 'date', label: 'common.field.date.label' },
  { value: 'redact', label: 'studio.project.connectionDialog.redact.label' },
];

const MASK_KIND_EXPLANATION: Record<MaskKind, MessageKey> = {
  name: 'studio.project.connectionDialog.maskKind.name.description',
  email: 'studio.project.connectionDialog.maskKind.email.description',
  text: 'studio.project.connectionDialog.maskKind.text.description',
  number: 'studio.project.connectionDialog.maskKind.number.description',
  date: 'studio.project.connectionDialog.maskKind.date.description',
  redact: 'studio.project.connectionDialog.maskKind.redact.description',
};

// keepHint's label changes per kind; it is hidden for the three kinds where it means nothing.
const KEEP_HINT_LABEL: Partial<Record<MaskKind, MessageKey>> = {
  name: 'studio.project.connectionDialog.keep.initials.label',
  email: 'studio.project.connectionDialog.keep.domain.label',
  date: 'studio.project.connectionDialog.keep.year.label',
};

function keepHintLabel(kind: MaskKind): string | undefined {
  const key = KEEP_HINT_LABEL[kind];
  return key ? t(key) : undefined;
}

// Table accepts the placeholder `*`; the form resets after a successful add.
const newTable = ref('');
const newColumn = ref('');
const newKind = ref<MaskKind>('redact');

const {
  run: runAdd,
  pending: adding,
  error: addError,
} = useAsyncAction((id: string, fields: MaskRuleFields) => upsertMaskRule(id, fields));

async function onAdd(): Promise<void> {
  const id = connectionId.value;
  const columnName = newColumn.value.trim();
  if (!id || !columnName) return;
  const ok = await runAdd(id, {
    tableName: newTable.value.trim() || '*',
    columnName,
    kind: newKind.value,
    keepHint: true,
    correlate: newKind.value !== 'number' && newKind.value !== 'date',
  });
  if (!ok) return;
  newTable.value = '';
  newColumn.value = '';
  newKind.value = 'redact';
}

function updateRule(
  ruleId: string,
  change: (rule: MaskRuleFields) => Partial<MaskRuleFields>,
): Promise<unknown> | undefined {
  const id = connectionId.value;
  const rule = maskRules.value.find((r) => r.id === ruleId);
  if (!id || !rule) return undefined;
  const base: MaskRuleFields = {
    tableName: rule.tableName,
    columnName: rule.columnName,
    kind: rule.kind,
    keepHint: rule.keepHint,
    correlate: rule.correlate,
  };
  return upsertMaskRule(id, { ...base, ...change(base) });
}

function onChangeKind(ruleId: string, kind: MaskKind): void {
  void updateRule(ruleId, (rule) => ({
    kind,
    correlate: kind === 'number' ? false : rule.correlate,
  }));
}

function onToggleFlag(ruleId: string, field: 'keepHint' | 'correlate'): void {
  void updateRule(ruleId, (rule) => ({ [field]: !rule[field] }));
}

async function onRemove(ruleId: string): Promise<void> {
  if (connectionId.value) await removeMaskRule(connectionId.value, ruleId);
}

async function onRegenerateKey(): Promise<void> {
  const id = connectionId.value;
  if (!id) return;
  const ok = await confirmDialogStore.confirm({
    title: t('studio.project.connectionDialog.regenerateConfirm.title'),
    message: [
      t('studio.project.connectionDialog.regenerateConfirm.body'),
      t('common.confirm.irreversible.body'),
    ].join(' '),
    confirmLabel: t('studio.common.regenerate.label'),
    tone: 'danger',
  });
  if (ok) await regenerateMaskKey(id);
}
</script>

<template>
  <TabsContent value="Privacy" class="flex flex-col gap-3 p-3">
    <FieldDescription class="w-full">
      {{ t('studio.project.connectionDialog.privacy.intro.description') }}
    </FieldDescription>

    <FieldDescription v-if="!connectionId" class="w-full">{{
      t('studio.project.connectionDialog.privacy.saveFirst.hint')
    }}</FieldDescription>
    <template v-else>
      <div
        v-if="maskRules.length"
        class="flex flex-col gap-1 max-h-55 overflow-y-auto"
        data-testid="mask-rule-list"
      >
        <div
          v-for="rule in maskRules"
          :key="rule.id"
          class="flex items-center gap-1.5 py-1 border-b border-border"
          :data-testid="`mask-rule-${rule.id}`"
        >
          <span class="flex-1 min-w-0 text-fg font-data">
            <TruncatedText :text="`${rule.tableName}.${rule.columnName}`" />
          </span>
          <NativeSelect
            variant="bordered"
            :model-value="rule.kind"
            data-testid="mask-rule-kind"
            @update:model-value="(v) => onChangeKind(rule.id, String(v) as MaskKind)"
          >
            <option v-for="o in MASK_KIND_OPTIONS" :key="o.value" :value="o.value">{{
              t(o.label)
            }}</option>
          </NativeSelect>
          <CheckboxRow
            v-if="keepHintLabel(rule.kind)"
            class="flex-none"
            :model-value="rule.keepHint"
            :label="keepHintLabel(rule.kind) as string"
            testid="mask-rule-keep-hint"
            @update:model-value="onToggleFlag(rule.id, 'keepHint')"
          />
          <CheckboxRow
            class="flex-none"
            :model-value="rule.correlate"
            :disabled="rule.kind === 'number'"
            :label="t('studio.project.connectionDialog.correlate.label')"
            testid="mask-rule-correlate"
            @update:model-value="onToggleFlag(rule.id, 'correlate')"
          />
          <TooltipIconButton
            icon="trash"
            :label="t('studio.project.connectionDialog.removeRule.tooltip')"
            variant="danger"
            data-testid="mask-rule-remove"
            @click="onRemove(rule.id)"
          />
        </div>
      </div>
      <FieldDescription v-else class="w-full">{{
        t('studio.project.connectionDialog.privacy.noRules.emptyHint')
      }}</FieldDescription>

      <div class="flex gap-2 items-center">
        <Input
          v-model="newTable"
          placeholder="*"
          class="font-data"
          data-testid="mask-rule-add-table"
        />
        <Input
          v-model="newColumn"
          :placeholder="t('studio.project.connectionDialog.column.placeholder')"
          class="font-data"
          data-testid="mask-rule-add-column"
        />
        <NativeSelect v-model="newKind" variant="bordered" data-testid="mask-rule-add-kind">
          <option v-for="o in MASK_KIND_OPTIONS" :key="o.value" :value="o.value">{{
            t(o.label)
          }}</option>
        </NativeSelect>
        <Button
          variant="dialog"
          size="kira-lg"
          data-testid="mask-rule-add"
          :pending="adding"
          @click="onAdd"
          >{{
            t('common.action.add.label')
          }}</Button
        >
      </div>
      <FieldDescription class="w-full">{{ t(MASK_KIND_EXPLANATION[newKind]) }}</FieldDescription>
      <Alert v-if="addError" variant="error" data-testid="mask-rule-error">
        <AlertDescription>{{ addError }}</AlertDescription>
      </Alert>

      <Button
        variant="dialog"
        size="kira-lg"
        class="self-start"
        data-testid="mask-regenerate-key"
        @click="onRegenerateKey"
      >
        {{ t('studio.project.connectionDialog.regenerate.label') }}
      </Button>

      <Alert
        v-if="!isFileStyle && secretStatus?.insecureFallback"
        data-testid="mask-key-credential-note"
        variant="warn"
      >
        <AlertDescription>
          {{ t('studio.project.connectionDialog.privacy.keyFallback.body') }}
        </AlertDescription>
      </Alert>
    </template>
  </TabsContent>
</template>
