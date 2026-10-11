<script setup lang="ts">
import { type EnvRow, parseEnv, reconcileEnv, serializeEnv } from '@kira/api-core';
import type { ApiVariable, ApiVariableBulkEntry, VariableScope } from '@shared/domain/variables';
import { Alert, AlertDescription } from '@theme/components/ui/alert';
import { Button } from '@theme/components/ui/button';
import { t } from '@theme/i18n';
import CatalogText from '@theme/i18n/CatalogText.vue';
import { errorText } from '@workbench/bridge/codedError';
import { useConfirmDialogStore } from '@workbench/state/confirmDialog';
import { computed, ref } from 'vue';
import MonacoHost from '../editor/MonacoHost.vue';
import { useVariableSetStore } from './state/variables';

const confirmDialogStore = useConfirmDialogStore();
const variableSetStore = useVariableSetStore();

// P17 D21/D22/D23, item 5: the `.env`-format bulk editor, hosted inside VariableSetView.vue's own
// bulk-mode toggle (a component-local lens, never persisted to tab state — D16's own rule for the
// filter query applies here too: an unapplied text buffer is exactly the kind of thing a restored
// tab must never silently reopen holding). `serializeEnv`/`parseEnv`/`reconcileEnv` are api-core's
// pure logic (R8) — this component is the DOM around it: seed the buffer once on entry, recompute
// the diff on every keystroke, and hand the parsed entries to ApplyBulk (R9) on Apply. There is no
// second parser here and no second reconcile rule — every branch below is either "call api-core" or
// "render what it returned".
// P105 §13: `scope` collides with the HTML global `scope` attribute name — Biome's `noHeaderScope`
// reads the attribute, not the Vue prop, at every call site that binds it. Renamed.
const props = defineProps<{
  tabId: string;
  variableScope: VariableScope;
  ownerId: string;
  rows: ApiVariable[];
}>();
const emit = defineEmits<{ close: [] }>();

function toEnvRows(rows: readonly ApiVariable[]): EnvRow[] {
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    value: row.isSecret ? '' : row.value,
    isSecret: row.isSecret,
    description: row.description,
  }));
}

// Seeded once, from the rows the tab held when bulk mode was entered — not a `watch` on `rows`,
// which would blow away in-progress edits every time an unrelated row-table mutation (e.g. a
// history restore in another tab bound to the same owner) re-fetches this owner's rows. The
// existing-rows snapshot used for reconcile is captured alongside it for the same reason: the diff
// must be against what the editor opened on, not against whatever the server holds right now.
const baseline = toEnvRows(props.rows);
const text = ref(serializeEnv(baseline));

const parsed = computed(() => parseEnv(text.value));
const parseError = computed(() => parsed.value.error);

const diff = computed(() => {
  if (parseError.value) return null;
  return reconcileEnv(baseline, parsed.value.entries);
});

const summary = computed(() => {
  const d = diff.value;
  if (!d) return '';
  return t(d.reordered ? 'studio.api.bulk.summaryReordered.status' : 'studio.api.bulk.summary.status', {
    added: d.added.length,
    updated: d.updated.length,
    removed: d.removed.length,
  });
});

const applying = ref(false);
const applyError = ref<string | null>(null);

function onDocChange(value: string): void {
  text.value = value;
  applyError.value = null;
}

function toBulkEntries(
  entries: readonly { name: string; value: string; hasValue: boolean; description: string }[],
): ApiVariableBulkEntry[] {
  return entries.map((e) => ({
    name: e.name,
    value: e.value,
    hasValue: e.hasValue,
    description: e.description,
  }));
}

function sameRows(a: readonly EnvRow[], b: readonly EnvRow[]): boolean {
  return (
    a.length === b.length &&
    a.every((row, i) => {
      const other = b[i];
      return (
        row.id === other?.id &&
        row.name === other.name &&
        row.value === other.value &&
        row.isSecret === other.isSecret &&
        row.description === other.description
      );
    })
  );
}

async function onApply(): Promise<void> {
  if (!diff.value || applying.value) return;
  // Go deletes every live row named in no line, so removals and the warning below come from the
  // rows as they are now, not the ones this editor opened on.
  const liveRows = toEnvRows(props.rows);
  const live = reconcileEnv(liveRows, parsed.value.entries);
  const changedSinceOpen = !sameRows(baseline, liveRows);
  if (live.removed.length > 0 || changedSinceOpen) {
    const parts: string[] = [];
    if (changedSinceOpen) parts.push(t('studio.api.bulk.changedNote.body'));
    if (live.removed.length > 0) {
      parts.push(
        t('studio.api.bulk.removeConfirm.body', {
          names: live.removed.map((r) => `“${r.name}”`).join(', '),
        }),
      );
    }
    const removing = live.removed.length > 0;
    const confirmed = await confirmDialogStore.confirm({
      title: removing
        ? t('studio.api.bulk.removeConfirm.title', { count: live.removed.length })
        : t('studio.api.bulk.applyConfirm.title'),
      message: parts.join(' '),
      confirmLabel: removing ? t('common.action.remove.label') : t('common.action.apply.label'),
      tone: 'danger',
    });
    if (!confirmed) return;
  }
  applying.value = true;
  applyError.value = null;
  try {
    await variableSetStore.applyBulkVariables(
      props.tabId,
      props.variableScope,
      props.ownerId,
      toBulkEntries(parsed.value.entries),
    );
    emit('close');
  } catch (err) {
    applyError.value = errorText(err);
  } finally {
    applying.value = false;
  }
}

function onCancel(): void {
  emit('close');
}
</script>

<template>
  <div class="flex h-full min-h-0 flex-col gap-1 px-1.5 py-1" data-testid="variables-bulk-editor">
    <Alert variant="info" data-testid="variables-bulk-hint">
      <AlertDescription>
        <CatalogText k="studio.api.bulk.hint">
          <template #newLine><code>KEY=value</code></template>
          <template #secretLine><code>KEY=</code></template>
        </CatalogText>
      </AlertDescription>
    </Alert>

    <div class="flex-1 min-h-52 overflow-hidden rounded-kira border border-border">
      <MonacoHost
        :doc="text"
        language="plain"
        :read-only="false"
        data-testid="variables-bulk-textarea"
        @update:doc="onDocChange"
      />
    </div>

    <Alert v-if="parseError" variant="error" data-testid="variables-bulk-error">
      <AlertDescription>{{ parseError.message }}</AlertDescription>
    </Alert>
    <template v-else-if="diff">
      <div class="text-subtle text-kira-sm" data-testid="variables-bulk-summary">{{ summary }}</div>
      <Alert v-if="diff.hasRenameRisk" variant="warn" data-testid="variables-bulk-rename-warning">
        <AlertDescription>
          {{ t('studio.api.bulk.renameWarning.body') }}
        </AlertDescription>
      </Alert>
    </template>

    <Alert v-if="applyError" variant="error" data-testid="variables-bulk-apply-error">
      <AlertDescription>{{ applyError }}</AlertDescription>
    </Alert>

    <div class="flex justify-end gap-1">
      <Button variant="toolbar" size="kira" data-testid="variables-bulk-cancel" @click="onCancel">{{ t('common.action.cancel.label') }}</Button>
      <Button
        variant="toolbar-primary"
        size="kira"
        data-testid="variables-bulk-apply"
        :disabled="parseError !== null || applying"
        @click="onApply"
      >
        {{ t('common.action.apply.label') }}
      </Button>
    </div>
  </div>
</template>
