<script setup lang="ts">
import { type EnvRow, parseEnv, reconcileEnv, serializeEnv } from '@kira/api-core';
import type { ApiVariable, ApiVariableBulkEntry, VariableScope } from '@shared/domain/variables';
import { computed, ref } from 'vue';
import CodeMirrorHost from '../editor/CodeMirrorHost.vue';
import { confirmDialog } from '../state/confirmDialog';
import AppButton from '../theme/primitives/AppButton.vue';
import MessageStrip from '../theme/primitives/MessageStrip.vue';
import { applyBulkVariables } from './state/variables';

// P17 D21/D22/D23, item 5: the `.env`-format bulk editor, hosted inside VariableSetView.vue's own
// bulk-mode toggle (a component-local lens, never persisted to tab state — D16's own rule for the
// filter query applies here too: an unapplied text buffer is exactly the kind of thing a restored
// tab must never silently reopen holding). `serializeEnv`/`parseEnv`/`reconcileEnv` are api-core's
// pure logic (R8) — this component is the DOM around it: seed the buffer once on entry, recompute
// the diff on every keystroke, and hand the parsed entries to ApplyBulk (R9) on Apply. There is no
// second parser here and no second reconcile rule — every branch below is either "call api-core" or
// "render what it returned".
const props = defineProps<{
  tabId: string;
  scope: VariableScope;
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
  return `${d.added.length} added · ${d.updated.length} updated · ${d.removed.length} removed${d.reordered ? ' · reordered' : ''}`;
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

async function onApply(): Promise<void> {
  const d = diff.value;
  if (!d || applying.value) return;
  if (d.removed.length > 0) {
    const names = d.removed.map((r) => `"${r.name}"`).join(', ');
    const ok = await confirmDialog(
      `Remove ${d.removed.length === 1 ? 'variable' : 'variables'} ${names}? Its value history goes with it.`,
    );
    if (!ok) return;
  }
  applying.value = true;
  applyError.value = null;
  try {
    await applyBulkVariables(
      props.tabId,
      props.scope,
      props.ownerId,
      toBulkEntries(parsed.value.entries),
    );
    emit('close');
  } catch (err) {
    applyError.value = err instanceof Error ? err.message : String(err);
  } finally {
    applying.value = false;
  }
}

function onCancel(): void {
  emit('close');
}
</script>

<template>
  <div class="bulk-editor" data-testid="variables-bulk-editor">
    <MessageStrip tone="note" data-testid="variables-bulk-hint">
      Bulk edit cannot create or remove the secret flag on a row — a new <code>KEY=value</code>
      line always creates a non-secret variable, and a secret's own line stays
      <code>KEY=</code> with its value left unchanged unless you type one. Use the row's own
      toggle to change a variable's secret flag.
    </MessageStrip>

    <div class="bulk-body">
      <CodeMirrorHost
        :doc="text"
        language="plain"
        :read-only="false"
        data-testid="variables-bulk-textarea"
        @update:doc="onDocChange"
      />
    </div>

    <MessageStrip v-if="parseError" tone="err" data-testid="variables-bulk-error">
      {{ parseError.message }}
    </MessageStrip>
    <template v-else-if="diff">
      <div class="bulk-summary" data-testid="variables-bulk-summary">{{ summary }}</div>
      <MessageStrip
        v-if="diff.hasRenameRisk"
        tone="warn"
        data-testid="variables-bulk-rename-warning"
      >
        Renaming a key here removes the old one and its value history. Rename in the table to keep
        it.
      </MessageStrip>
    </template>

    <MessageStrip v-if="applyError" tone="err" data-testid="variables-bulk-apply-error">
      {{ applyError }}
    </MessageStrip>

    <div class="bulk-actions">
      <AppButton data-testid="variables-bulk-cancel" @click="onCancel">Cancel</AppButton>
      <AppButton
        variant="primary"
        data-testid="variables-bulk-apply"
        :disabled="parseError !== null || applying"
        @click="onApply"
      >
        Apply
      </AppButton>
    </div>
  </div>
</template>

<style scoped>
.bulk-editor {
  display: flex;
  flex-direction: column;
  gap: var(--kira-s-2);
  padding: var(--kira-s-2) var(--kira-s-3);
  height: 100%;
  min-height: 0;
}

.bulk-body {
  flex: 1;
  min-height: 200px;
  border: var(--kira-border-width) solid var(--kira-border);
  border-radius: var(--kira-radius);
  overflow: hidden;
}

.bulk-summary {
  font-size: var(--kira-t-sm);
  color: var(--kira-fg-subtle);
}

.bulk-actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--kira-s-2);
}
</style>
