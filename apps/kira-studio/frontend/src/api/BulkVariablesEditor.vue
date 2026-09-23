<script setup lang="ts">
import { type EnvRow, parseEnv, reconcileEnv, serializeEnv } from '@kira/api-core';
import type { ApiVariable, ApiVariableBulkEntry, VariableScope } from '@shared/domain/variables';
import { Alert, AlertDescription } from '@theme/components/ui/alert';
import { Button } from '@theme/components/ui/button';
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
    const ok = await confirmDialogStore.confirmDialog(
      `Remove ${d.removed.length === 1 ? 'variable' : 'variables'} ${names}? Its value history goes with it.`,
    );
    if (!ok) return;
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
    <Alert class="strip-note" data-testid="variables-bulk-hint">
      <AlertDescription class="strip-note-text">
        Bulk edit cannot create or remove the secret flag on a row — a new <code>KEY=value</code>
        line always creates a non-secret variable, and a secret's own line stays
        <code>KEY=</code> with its value left unchanged unless you type one. Use the row's own
        toggle to change a variable's secret flag.
      </AlertDescription>
    </Alert>

    <div class="bulk-body">
      <MonacoHost
        :doc="text"
        language="plain"
        :read-only="false"
        data-testid="variables-bulk-textarea"
        @update:doc="onDocChange"
      />
    </div>

    <Alert v-if="parseError" variant="destructive" data-testid="variables-bulk-error">
      <AlertDescription>{{ parseError.message }}</AlertDescription>
    </Alert>
    <template v-else-if="diff">
      <div class="bulk-summary" data-testid="variables-bulk-summary">{{ summary }}</div>
      <Alert v-if="diff.hasRenameRisk" class="strip-warn" data-testid="variables-bulk-rename-warning">
        <AlertDescription class="strip-warn-text">
          Renaming a key here removes the old one and its value history. Rename in the table to
          keep it.
        </AlertDescription>
      </Alert>
    </template>

    <Alert v-if="applyError" variant="destructive" data-testid="variables-bulk-apply-error">
      <AlertDescription>{{ applyError }}</AlertDescription>
    </Alert>

    <div class="bulk-actions">
      <Button variant="toolbar" size="kira" data-testid="variables-bulk-cancel" @click="onCancel">Cancel</Button>
      <Button
        variant="toolbar-primary"
        size="kira"
        data-testid="variables-bulk-apply"
        :disabled="parseError !== null || applying"
        @click="onApply"
      >
        Apply
      </Button>
    </div>
  </div>
</template>

<style scoped>
@reference "@theme/base.css";

.bulk-editor {
  @apply flex h-full min-h-0 flex-col gap-1 px-1.5 py-1;
}

.bulk-body {
  @apply flex-1 min-h-52 overflow-hidden rounded-kira border border-border;
}

.bulk-summary {
  @apply text-subtle text-kira-sm;
}

.bulk-actions {
  @apply flex justify-end gap-1;
}

/* Alert tone classes replacing MessageStrip's note/warn markers (now --kira-warn-text/--kira-
   note-text in tokens.css, promoted off this rule's literal-hex carve-out). */
.strip-note {
  @apply bg-info/8 border-info/20;
}
.strip-note-text {
  @apply text-note-text;
}
.strip-warn {
  @apply bg-warn/10 border-warn/20;
}
.strip-warn-text {
  @apply text-warn-text;
}
</style>
