<script setup lang="ts">
import { definitionText } from '@shared/domain/definition';
import type { DefinitionTabRecord } from '@shared/domain/tabs';
import { decodePath, pathTail } from '@shared/domain/tree';
import { computed, onMounted, onUnmounted } from 'vue';
import { copyText } from '../../clipboard';
import CodeMirrorHost from '../../editor/CodeMirrorHost.vue';
import { registerCommand } from '../../shortcuts/commands';
import { connectConnection, connectionsState } from '../../state/connections';
import {
  isHydrated,
  markHydrated,
  openConsoleTab,
  patchDefinitionTabState,
} from '../../state/tabs';
import Codicon from '../../theme/Codicon.vue';
import Button from '../../theme/primitives/Button.vue';
import ReconnectGate from '../../theme/primitives/ReconnectGate.vue';
import Segmented from '../../theme/primitives/Segmented.vue';
import Strip from '../../theme/primitives/Strip.vue';
import ViewChrome from '../../workbench/panels/ViewChrome.vue';
import ColumnsSection from './ColumnsSection.vue';
import ConstraintsSection from './ConstraintsSection.vue';
import IndexesSection from './IndexesSection.vue';
import { load, runtime } from './state';
import { buildConstraintRows } from './structure';
import ValidationSection from './ValidationSection.vue';

// MainView.vue keys this component by tab.id, so one instance <-> one tab — same discipline as
// DataView.vue.
const props = defineProps<{ tab: DefinitionTabRecord }>();

const connectionStatus = computed(() =>
  props.tab.connectionId
    ? (connectionsState.states[props.tab.connectionId]?.status ?? 'disconnected')
    : 'disconnected',
);

// §8.4's gate, copied literally from DataView.vue.
const needsReconnect = computed(
  () => !isHydrated(props.tab.id) || connectionStatus.value !== 'connected',
);

const rt = computed(() => runtime[props.tab.id]);
const loading = computed(() => rt.value?.status === 'loading');

async function onReconnectAndLoad(): Promise<void> {
  if (!props.tab.connectionId) return;
  if (connectionStatus.value !== 'connected') {
    await connectConnection(props.tab.connectionId);
  }
  markHydrated(props.tab.id);
  await load(props.tab.id);
}

function onRefresh(): void {
  void load(props.tab.id, { refresh: true });
}

// "Open query console" mirrors project/menus.ts's own consoleMenuItem: the tab's own connection
// and path, handed straight to openConsoleTab, no new capability involved.
function onOpenConsole(): void {
  if (props.tab.connectionId) openConsoleTab(props.tab.connectionId, props.tab.path);
}

function onCopy(): void {
  if (definition.value) copyText(definitionText(definition.value));
}

let unregisterCommand: (() => void) | null = null;

onMounted(() => {
  if (!needsReconnect.value && !runtime[props.tab.id]) {
    void load(props.tab.id);
  }
  unregisterCommand = registerCommand('view.refresh', onRefresh);
});

onUnmounted(() => {
  unregisterCommand?.();
});

const targetTail = computed(() => pathTail(props.tab.path));
const targetLabel = computed(() => targetTail.value?.name ?? props.tab.path);

const definition = computed(() => rt.value?.definition ?? null);
const meta = computed(() => rt.value?.meta ?? null);
const document = computed(() => (definition.value ? definitionText(definition.value) : ''));

// D7: Structure (default) vs Source, persisted per tab; `.default('structure')` (tabs.ts) keeps
// a tab saved under the pre-P19 empty `{}` shape restorable.
const pane = computed(() => props.tab.state.pane);
const PANE_OPTIONS = [
  { value: 'structure' as const, label: 'Structure', testid: 'definition-pane-structure' },
  { value: 'source' as const, label: 'Source', testid: 'definition-pane-source' },
];
function setPane(value: 'structure' | 'source'): void {
  patchDefinitionTabState(props.tab.id, { pane: value });
}

// Mongo collections have documents, not columns/constraints (D9/D11's scope is SQL relations);
// Indexes is the one section every kind shares (P8's D10).
const isCollection = computed(() => definition.value?.kind === 'collection');
const foreignKeyColumnNames = computed(
  () => new Set(meta.value?.foreignKeys.flatMap((fk) => fk.columns) ?? []),
);
const constraintRows = computed(() =>
  definition.value && meta.value ? buildConstraintRows(definition.value, meta.value) : [],
);

const dialect = computed<'postgres' | 'mariadb' | undefined>(() => {
  if (!props.tab.connectionId) return undefined;
  const record = connectionsState.records.find((r) => r.id === props.tab.connectionId);
  return record?.kind === 'postgres' || record?.kind === 'mariadb' ? record.kind : undefined;
});

const originPhrase = computed(() =>
  definition.value?.origin === 'server' ? 'server definition' : 'composed from catalog metadata',
);

// P16 design system LAW: connection colour reaches a view as a 2px rail (tree, tab, toolbar
// cap) or a dot (view header) — the same per-tab lookup Toolbar.vue and TreeRow.vue already
// use for the rail elsewhere, just aimed at the dot instead.
const connectionRecord = computed(() =>
  connectionsState.records.find((r) => r.id === props.tab.connectionId),
);
// Produced locally from the path — the same discipline DataGrid.vue's own qualifiedName()
// uses (never round-tripped to the engine for a string join): connection name plus every
// segment above the target, joined for the view header's breadcrumb.
const breadcrumb = computed(() => {
  if (!props.tab.connectionId) return '';
  const parents = decodePath(props.tab.connectionId, props.tab.path)
    .segments.slice(0, -1)
    .map((s) => s.name);
  const parts = [connectionRecord.value?.name, ...parents].filter((p): p is string => !!p);
  return parts.length > 0 ? `${parts.join(' / ')} / ` : '';
});
</script>

<template>
  <div
    class="definition-view"
    data-testid="definition-view"
    :data-path="tab.path"
    :data-origin="definition?.origin ?? ''"
    :data-source="rt?.source ?? ''"
    data-read-only-reason="definition-not-editable"
  >
    <ReconnectGate
      v-if="needsReconnect"
      variant="default"
      container-testid="definition-reconnect"
      button-testid="definition-reconnect-load"
      @reconnect="onReconnectAndLoad"
    />
    <ViewChrome
      v-else
      :tab="tab"
      icon="code"
      :path="breadcrumb"
      :name="targetLabel"
      target-testid="definition-target"
      refresh-testid="definition-refresh"
      :can-refresh="!loading"
      :can-stop="false"
      @refresh="onRefresh"
    >
      <template #badges>
        <span v-if="targetTail" class="p-badge">{{ targetTail.kind }}</span>
        <span class="p-chip" style="background: var(--kira-bg-input); color: var(--kira-fg-muted)">
          <Codicon name="lock" :size="11" />
          read-only — {{ originPhrase }}
        </span>
      </template>

      <!-- Stop is permanently disabled: this load has no cancellation to offer (state.ts tracks
           no op-id for it) — the slot stays reserved rather than wired to a stop that doesn't
           exist. -->
      <template #toolbar>
        <div class="sep" />
        <div class="group">
          <Segmented
            :model-value="pane"
            :options="PANE_OPTIONS"
            data-testid="definition-pane"
            @update:model-value="setPane"
          />
        </div>
      </template>

      <template #toolbar-end>
        <!-- D7: Copy/notes describe the Source pane's raw text specifically — Structure has its
             own per-section content and count badges, nothing to copy as one document. -->
        <template v-if="pane === 'source'">
          <div class="sep" />
          <Button
            icon="copy"
            title="Copy definition to clipboard"
            data-testid="definition-copy"
            @click="onCopy"
          >
            Copy
          </Button>
        </template>
        <Button
          icon="terminal"
          title="Open query console here"
          data-testid="definition-open-console"
          @click="onOpenConsole"
        >
          Open in console
        </Button>
      </template>

      <template #strips>
        <Strip
          v-if="rt?.status === 'error' && rt.error"
          tone="err"
          icon="error"
          data-testid="definition-error"
        >
          <span class="err-message">{{ rt.error }}</span>
        </Strip>
        <div
          v-if="pane === 'source' && definition && definition.notes.length > 0"
          class="p-strip note"
          data-testid="definition-notes"
        >
          <span class="icon-box"><Codicon name="info" :size="14" /></span>
          <ul class="notes-list">
            <li v-for="(note, i) in definition.notes" :key="i">{{ note }}</li>
          </ul>
        </div>
      </template>

      <div v-if="pane === 'source'" class="editor-body">
        <CodeMirrorHost
          :doc="document"
          :language="definition?.language === 'json' ? 'json' : 'sql'"
          :sql-dialect="dialect"
          :read-only="true"
        />
      </div>
      <div v-else-if="definition && meta" class="structure-body">
        <ColumnsSection
          v-if="!isCollection"
          :columns="meta.columns"
          :foreign-key-column-names="foreignKeyColumnNames"
          :connection-id="tab.connectionId ?? ''"
          :table-path="tab.path"
        />
        <IndexesSection :indexes="meta.indexes" />
        <ConstraintsSection v-if="!isCollection" :constraints="constraintRows" />
        <ValidationSection v-if="isCollection" :document-schema="definition.documentSchema" />
      </div>
      <!-- LAW — there is no editor status line: identity moved to the view header above,
           duration to the toolbar's run-state, and this tab has no pending edits to report. -->
    </ViewChrome>
  </div>
</template>

<style scoped>
.definition-view {
  height: 100%;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.err-message {
  font-family: var(--kira-font-family);
  white-space: pre-wrap;
}

.notes-list {
  margin: 0;
  padding-left: var(--kira-s-5);
}

.editor-body {
  flex: 1;
  min-height: 0;
}

.structure-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: var(--kira-s-6);
  padding: var(--kira-s-5);
}
</style>
