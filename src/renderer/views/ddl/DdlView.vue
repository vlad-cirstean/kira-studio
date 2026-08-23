<script setup lang="ts">
import { ddlText } from '@shared/domain/ddl';
import type { DdlTabRecord } from '@shared/domain/tabs';
import { decodePath, pathTail } from '@shared/domain/tree';
import { computed, onMounted, onUnmounted } from 'vue';
import { copyText } from '../../clipboard';
import CodeMirrorHost from '../../editor/CodeMirrorHost.vue';
import { registerCommand } from '../../shortcuts/commands';
import { connectConnection, connectionsState } from '../../state/connections';
import { isHydrated, markHydrated, openConsoleTab } from '../../state/tabs';
import Codicon from '../../theme/Codicon.vue';
import Button from '../../theme/primitives/Button.vue';
import ViewChrome from '../../workbench/panels/ViewChrome.vue';
import { load, runtime } from './state';

// MainView.vue keys this component by tab.id, so one instance <-> one tab — same discipline as
// DataView.vue.
const props = defineProps<{ tab: DdlTabRecord }>();

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
  if (ddl.value) copyText(ddlText(ddl.value));
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

const ddl = computed(() => rt.value?.ddl ?? null);
const document = computed(() => (ddl.value ? ddlText(ddl.value) : ''));

const dialect = computed<'postgres' | 'mariadb' | undefined>(() => {
  if (!props.tab.connectionId) return undefined;
  const record = connectionsState.records.find((r) => r.id === props.tab.connectionId);
  return record?.kind === 'postgres' || record?.kind === 'mariadb' ? record.kind : undefined;
});

const originPhrase = computed(() =>
  ddl.value?.origin === 'server' ? 'server definition' : 'composed from catalog metadata',
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
    class="ddl-view"
    data-testid="ddl-view"
    :data-path="tab.path"
    :data-origin="ddl?.origin ?? ''"
    :data-source="rt?.source ?? ''"
    data-read-only-reason="ddl-not-editable"
  >
    <div v-if="needsReconnect" class="reconnect-panel" data-testid="ddl-reconnect">
      <Button
        kind="dialog"
        data-testid="ddl-reconnect-load"
        @click="onReconnectAndLoad"
      >
        Reconnect &amp; load
      </Button>
    </div>
    <!-- Column/index/constraint counts and the Definition/Columns/Indexes/Constraints segmented
         view from the mockup need structured catalog data this tab doesn't fetch (only the raw
         statement text) — skipped rather than faked. -->
    <ViewChrome
      v-else
      :tab="tab"
      icon="code"
      :path="breadcrumb"
      :name="targetLabel"
      target-testid="ddl-target"
      refresh-testid="ddl-refresh"
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
      <template #toolbar-end>
        <div class="sep" />
        <Button icon="copy" title="Copy DDL to clipboard" data-testid="ddl-copy" @click="onCopy">
          Copy
        </Button>
        <Button
          icon="terminal"
          title="Open query console here"
          data-testid="ddl-open-console"
          @click="onOpenConsole"
        >
          Open in console
        </Button>
      </template>

      <template #strips>
        <div v-if="rt?.status === 'error' && rt.error" class="p-strip err" data-testid="ddl-error">
          <span class="icon-box"><Codicon name="error" :size="14" /></span>
          <span class="err-message">{{ rt.error }}</span>
        </div>
        <div v-if="ddl && ddl.notes.length > 0" class="p-strip note" data-testid="ddl-notes">
          <span class="icon-box"><Codicon name="info" :size="14" /></span>
          <ul class="notes-list">
            <li v-for="(note, i) in ddl.notes" :key="i">{{ note }}</li>
          </ul>
        </div>
      </template>

      <div class="editor-body">
        <CodeMirrorHost :doc="document" language="sql" :sql-dialect="dialect" :read-only="true" />
      </div>
      <!-- LAW — there is no editor status line: identity moved to the view header above,
           duration to the toolbar's run-state, and this tab has no pending edits to report. -->
    </ViewChrome>
  </div>
</template>

<style scoped>
.ddl-view {
  height: 100%;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.reconnect-panel {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
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
</style>
