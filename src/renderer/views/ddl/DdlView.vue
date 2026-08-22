<script setup lang="ts">
import { ddlText } from '@shared/domain/ddl';
import type { DdlTabRecord } from '@shared/domain/tabs';
import { pathTail } from '@shared/domain/tree';
import { computed, onMounted } from 'vue';
import CodeMirrorHost from '../../editor/CodeMirrorHost.vue';
import { connectConnection, connectionsState } from '../../state/connections';
import { isHydrated, markHydrated } from '../../state/tabs';
import Codicon from '../../theme/Codicon.vue';
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

async function onReconnectAndLoad(): Promise<void> {
  if (!props.tab.connectionId) return;
  if (connectionStatus.value !== 'connected') {
    await connectConnection(props.tab.connectionId);
  }
  markHydrated(props.tab.id);
  await load(props.tab.id);
}

onMounted(() => {
  if (!needsReconnect.value && !runtime[props.tab.id]) {
    void load(props.tab.id);
  }
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

const statusLine = computed(() => {
  const d = ddl.value;
  if (!d) return '';
  const parts = [
    originPhrase.value,
    `${d.statements.length} statement${d.statements.length === 1 ? '' : 's'}`,
    rt.value?.source === 'cache' ? 'from cache' : 'from server',
    `generated ${new Date(d.generatedAt).toLocaleString()}`,
    'read-only',
  ];
  return parts.join(' · ');
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
      <button type="button" data-testid="ddl-reconnect-load" @click="onReconnectAndLoad">
        Reconnect &amp; load
      </button>
    </div>
    <template v-else>
      <div class="header">
        <span class="target" data-testid="ddl-target">{{ targetLabel }}</span>
        <span class="type-pill">{{ targetTail?.kind }}</span>
      </div>
      <div v-if="rt?.status === 'loading'" class="loading-bar" data-testid="ddl-loading" />
      <div v-if="rt?.status === 'error' && rt.error" class="error-strip" data-testid="ddl-error">
        {{ rt.error }}
      </div>
      <div v-if="ddl && ddl.notes.length > 0" class="notes-strip" data-testid="ddl-notes">
        <Codicon name="info" :size="13" class="notes-icon" />
        <ul>
          <li v-for="(note, i) in ddl.notes" :key="i">{{ note }}</li>
        </ul>
      </div>
      <div class="editor-body">
        <CodeMirrorHost :doc="document" language="sql" :sql-dialect="dialect" :read-only="true" />
      </div>
      <div class="status-line" data-testid="ddl-status">{{ statusLine }}</div>
    </template>
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

.reconnect-panel button {
  padding: 6px 14px;
  border-radius: var(--kira-radius-sm);
  border: var(--kira-border-width) solid var(--kira-border);
  background: var(--kira-bg-input);
  color: var(--kira-fg);
  cursor: pointer;
  font-size: 12px;
}

.reconnect-panel button:hover {
  background: var(--kira-hover);
}

.header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  border-bottom: var(--kira-border-width) solid var(--kira-border);
  font-size: 11px;
  flex-shrink: 0;
  overflow: hidden;
}

.target {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--kira-fg);
  font-weight: 600;
  min-width: 0;
}

.type-pill {
  padding: 1px 5px;
  border-radius: var(--kira-radius-sm);
  background: var(--kira-bg-input);
  color: var(--kira-fg-muted);
  font-weight: 400;
  font-size: 10px;
  flex-shrink: 0;
}

.loading-bar {
  height: 2px;
  flex-shrink: 0;
  background: linear-gradient(90deg, transparent, var(--kira-accent), transparent);
  background-size: 200% 100%;
  animation: loading-sweep 1.2s linear infinite;
}

@keyframes loading-sweep {
  from {
    background-position: 200% 0;
  }
  to {
    background-position: -200% 0;
  }
}

.error-strip {
  flex-shrink: 0;
  padding: 4px 8px;
  font-size: 11px;
  font-family: var(--kira-font-family);
  color: var(--kira-error);
  background: var(--kira-bg-elevated);
  border-bottom: var(--kira-border-width) solid var(--kira-border);
  white-space: pre-wrap;
}

.notes-strip {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  padding: 6px 8px;
  font-size: 11px;
  color: var(--kira-fg-muted);
  background: var(--kira-bg-elevated);
  border-bottom: var(--kira-border-width) solid var(--kira-border);
  flex-shrink: 0;
}

.notes-icon {
  flex-shrink: 0;
  margin-top: 1px;
}

.notes-strip ul {
  margin: 0;
  padding-left: 16px;
}

.editor-body {
  flex: 1;
  min-height: 0;
}

.status-line {
  padding: 3px 8px;
  border-top: var(--kira-border-width) solid var(--kira-border);
  color: var(--kira-fg-muted);
  font-size: 10px;
  flex-shrink: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
