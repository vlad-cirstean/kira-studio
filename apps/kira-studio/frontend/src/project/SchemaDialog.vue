<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import CodeMirrorHost from '../editor/CodeMirrorHost.vue';
import { connectionRecord } from '../state/connections';
import {
  closeSchemaDialog,
  connectionRelationsFromTree,
  ddlParseSummary,
  ensureDdl,
  type FillProgress,
  fillDdlFromConnection,
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
    // P12 round 2 finding #12: the dialog only unmounts on close (ProjectPanel.vue's `v-if`
    // gates on `open`, not `connectionId`) — switching connections while it stays open reuses
    // this same instance, so a debounce timer left running from typing in the previous
    // connection's DDL text would otherwise fire later and clobber this one's debouncedDraft.
    clearTimeout(parseSummaryTimer);
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

// P19 D15: "the honest reading of v1.1's constraint" — the user still supplies the DDL (presses
// the button, sees the text, presses Save), the app just stops making them run pg_dump in a
// terminal and paste the output. Stages into `draft` like any other edit; never saves on its own.
const filling = ref(false);
const fillProgress = ref<FillProgress | null>(null);
let fillCancelled = false;

const canFillFromConnection = computed(
  () => !!connectionId.value && connectionRelationsFromTree(connectionId.value).length > 0,
);

async function onFillFromConnection(): Promise<void> {
  const id = connectionId.value;
  if (!id) return;
  const relations = connectionRelationsFromTree(id);
  if (relations.length === 0) return;
  filling.value = true;
  fillCancelled = false;
  fillProgress.value = { done: 0, total: relations.length };
  try {
    const text = await fillDdlFromConnection(
      id,
      relations,
      (progress) => {
        fillProgress.value = progress;
      },
      () => fillCancelled,
    );
    if (schemaDialogState.connectionId !== id) return; // the dialog moved on while this ran
    draft.value = text;
    debouncedDraft.value = text;
  } finally {
    filling.value = false;
    fillProgress.value = null;
  }
}

function onCancelFill(): void {
  fillCancelled = true;
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

    <div class="p-dialog-body schema-dialog-body">
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
      <span v-else-if="filling" class="help" data-testid="schema-fill-progress">
        Fetching {{ (fillProgress?.done ?? 0) + 1 }} of {{ fillProgress?.total ?? 0 }}…
      </span>
      <span v-else class="help">Applies to <span class="mono">{{ connectionName }}</span> only</span>
      <span class="p-dialog-actions p-push">
        <AppButton
          v-if="filling"
          kind="dialog"
          data-testid="schema-fill-cancel"
          @click="onCancelFill"
        >
          Cancel fetching
        </AppButton>
        <AppButton
          v-else
          kind="dialog"
          :disabled="!canFillFromConnection"
          v-tooltip="
            canFillFromConnection
              ? 'Fetch every table/view already visible in the project tree and stage their real definitions here'
              : 'Expand this connection in the project tree first — nothing is fetched that isn\'t already there'
          "
          data-testid="schema-fill-from-connection"
          @click="onFillFromConnection"
        >
          Fill from connection
        </AppButton>
        <AppButton kind="dialog" :disabled="filling" @click="closeSchemaDialog">Cancel</AppButton>
        <AppButton
          kind="dialog"
          variant="primary"
          :disabled="saving || filling"
          @click="onSave"
        >
          Save schema
        </AppButton>
      </span>
    </template>
  </DialogFrame>
</template>

<style scoped>
.schema-dialog-body {
  height: 60vh;
}

.help {
  font-size: var(--kira-t-xs);
  color: var(--kira-fg-subtle);
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
  color: var(--kira-fg-subtle);
}
</style>
