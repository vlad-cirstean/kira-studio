<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import CodeMirrorHost from '../editor/CodeMirrorHost.vue';
import { connectionRecord } from '../state/connections';
import {
  closeSchemaDialog,
  ddlParseSummary,
  ensureDdl,
  saveDdl,
  schemaDialectFor,
  schemaDialogState,
} from '../state/schemas';
import AppButton from '../theme/primitives/AppButton.vue';
import DialogFrame from '../theme/primitives/DialogFrame.vue';

// P18 (v1.1) D3: the DDL document a user pastes for one connection, staged until Save — the
// draft is component-local, cloned at open; Cancel, Escape, the ✕ and the backdrop all discard
// silently (DialogFrame's own @close); only Save writes. Reuses P17's landed staging shape
// exactly rather than inventing a second one. schemaDialectFor/ddlParseSummary (state/schemas.ts)
// are this file's one dispatch point into the SQL surface — SPEC §11 forbids project/ importing
// views/ directly, the same rule state/viewCommands.ts exists to satisfy for other callers.

const draft = ref('');
const saving = ref(false);

// P12 round 1 finding #12: `draft` (the editor's own live doc) updates every keystroke, but the
// parse summary below reads this instead — a full Lezer parse of the whole document (measured up
// to ~58ms on a 200-table schema, against the app's own 50ms interaction budget) has no business
// running on every keystroke. 400ms mirrors CodeMirrorHost.vue's own `@codemirror/lint` debounce
// precedent. An external load (the watcher below) writes both refs immediately, with no delay —
// only typing goes through the timer.
const debouncedDraft = ref('');
let parseSummaryTimer: ReturnType<typeof setTimeout> | undefined;
onBeforeUnmount(() => clearTimeout(parseSummaryTimer));

const connectionId = computed(() => schemaDialogState.connectionId);
const connectionKind = computed(() => connectionRecord(connectionId.value)?.kind);
const connectionName = computed(() => connectionRecord(connectionId.value)?.name ?? '');
const dialect = computed(() => schemaDialectFor(connectionKind.value));

// P12 round 1 finding #3: the reset must happen synchronously, before the `await` below, and the
// response must be discarded if the dialog has since moved on to a different connection — without
// both, a fast open of connection B landing before a slow open of connection A's ensureDdl
// resolves would let A's stale DDL text land in B's (still fully editable) draft, and Save would
// write it into B's connection_ddl row.
watch(
  () => schemaDialogState.connectionId,
  async (id) => {
    draft.value = '';
    debouncedDraft.value = '';
    if (!id) return;
    const ddl = await ensureDdl(id);
    if (schemaDialogState.connectionId !== id) return; // superseded by a later open
    draft.value = ddl;
    debouncedDraft.value = ddl;
  },
  { immediate: true },
);

// D3: a live parse summary — "N tables, M columns" — the only feedback that tells a user their
// DDL is actually being understood. ddl.ts's own extractor never throws and never reports a
// structured parse error (D9: an unrecognised statement is silently skipped, not a failure), so
// "recognised nothing at all" is the one failure state this can show.
const parseSummary = computed(() => ddlParseSummary(connectionKind.value, debouncedDraft.value));

function onDocChange(text: string): void {
  draft.value = text;
  clearTimeout(parseSummaryTimer);
  parseSummaryTimer = setTimeout(() => {
    debouncedDraft.value = text;
  }, 400);
}

// P12 round 1 finding #14: SettingsDialog.vue's own pattern (a saveError ref plus a footer strip)
// mirrored exactly — this file's own header comment already claimed to reuse P17's staging shape,
// but had no catch at all: a rejected schemaSet became an unhandled promise rejection from a
// template @click, the dialog stayed open with nothing shown, and Save looked merely slow rather
// than failed.
const saveError = ref<string | null>(null);

async function onSave(): Promise<void> {
  const id = connectionId.value;
  if (!id) return;
  saving.value = true;
  saveError.value = null;
  try {
    await saveDdl(id, draft.value);
    closeSchemaDialog();
  } catch (err) {
    saveError.value = err instanceof Error ? err.message : String(err);
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <DialogFrame
    title="Schema (DDL)"
    :width="720"
    max-height="80vh"
    test-id="schema-dialog"
    close-test-id="schema-dialog-close"
    @close="closeSchemaDialog"
  >
    <template #header>
      <span>Schema (DDL)<template v-if="connectionName"> — {{ connectionName }}</template></span>
    </template>

    <div class="dialog-body-inner">
      <span class="help">
        Paste this connection's own schema — table and column definitions the SQL console
        completes, checks and hovers against. Nothing here ever reads from the connection itself.
      </span>
      <div class="editor-wrap">
        <CodeMirrorHost
          :doc="draft"
          language="sql"
          :sql-dialect="dialect"
          :read-only="false"
          :autocomplete="false"
          @update:doc="onDocChange"
        />
      </div>
      <div class="p-strip note summary-strip" data-testid="schema-parse-summary">
        <span v-if="parseSummary">{{ parseSummary }}</span>
        <span v-else class="empty-note">
          Paste output from <span class="mono">pg_dump --schema-only</span>,
          <span class="mono">SHOW CREATE TABLE</span> or <span class="mono">.schema</span> —
          whichever your connection's own engine gives you.
        </span>
      </div>
    </div>

    <template #footer>
      <span v-if="saveError" class="field-error" data-testid="schema-save-error">{{
        saveError
      }}</span>
      <span v-else class="help">Applies to <span class="mono">{{ connectionName }}</span> only</span>
      <span class="footer-actions p-push">
        <AppButton kind="dialog" @click="closeSchemaDialog">Cancel</AppButton>
        <AppButton kind="dialog" variant="primary" :disabled="saving" @click="onSave">
          Save schema
        </AppButton>
      </span>
    </template>
  </DialogFrame>
</template>

<style scoped>
.dialog-body-inner {
  padding: var(--kira-s-5);
  display: flex;
  flex-direction: column;
  gap: var(--kira-s-4);
  height: 60vh;
}

.help {
  font-size: var(--kira-t-xs);
  color: var(--kira-fg-disabled);
  line-height: 1.5;
}

.field-error {
  font-size: var(--kira-t-xs);
  color: var(--kira-error);
  line-height: 1.5;
}

.mono {
  font-family: var(--kira-font-family);
}

.editor-wrap {
  flex: 1;
  min-height: 0;
  border: var(--kira-border-width) solid var(--kira-border);
  border-radius: var(--kira-radius-sm);
  overflow: hidden;
}

.summary-strip {
  align-self: stretch;
  border: var(--kira-border-width) solid var(--kira-border);
  border-radius: var(--kira-radius-sm);
}

.empty-note {
  font-size: var(--kira-t-xs);
  color: var(--kira-fg-disabled);
}

.footer-actions {
  display: flex;
  gap: var(--kira-s-3);
}
</style>
