<script setup lang="ts">
import type { OpRecord } from '@shared/ops';
import { computed } from 'vue';
import { connectionsState } from '../../project/state/connections';
import Codicon from '../../theme/Codicon.vue';
import { type MenuItem, openContextMenu } from '../state/contextMenu';
import { cancelOp, clearOps, opsState, runningCount, visibleOps } from '../state/ops';
import { settingsState } from '../state/settings';
import VirtualList from '../VirtualList.vue';
import EmptyState from './EmptyState.vue';

// Operations panel (Step 10b / §8.11). The expanded row detail is shown in a bottom pane rather
// than varying a row's height — VirtualList is fixed-row-height. P3 upgrades the detail to
// CodeMirror when it lands (recorded deviation from §8.11).

const rowHeight = computed(() => (settingsState.appearance.rowDensity === 'compact' ? 22 : 28));

function formatTime(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number, w = 2): string => String(n).padStart(w, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function connectionColor(connectionId: string | null): string | null {
  if (!connectionId) return null;
  return connectionsState.records.find((r) => r.id === connectionId)?.color ?? 'grey';
}

function connectionName(connectionId: string | null): string {
  if (!connectionId) return '—';
  return connectionsState.records.find((r) => r.id === connectionId)?.name ?? '—';
}

const expandedOp = computed<OpRecord | null>(
  () => opsState.records.find((r) => r.id === opsState.expandedId) ?? null,
);

function toggleExpand(id: string): void {
  opsState.expandedId = opsState.expandedId === id ? null : id;
}

function onOpContextMenu(e: MouseEvent, record: OpRecord): void {
  const items: MenuItem[] = [];
  if (record.command) {
    items.push({
      type: 'item',
      id: 'copy-command',
      label: 'Copy command',
      icon: 'copy',
      run: () => void navigator.clipboard.writeText(record.command ?? ''),
    });
  }
  if (record.error) {
    items.push({
      type: 'item',
      id: 'copy-error',
      label: 'Copy error',
      icon: 'copy',
      run: () => void navigator.clipboard.writeText(record.error ?? ''),
    });
  }
  if (record.status === 'running') {
    items.push({
      type: 'item',
      id: 'cancel',
      label: 'Cancel',
      icon: 'debug-stop',
      danger: true,
      run: () => cancelOp(record.id),
    });
  }
  openContextMenu(e, items);
}
</script>

<template>
  <div class="flex h-full flex-col">
    <div class="border-border flex items-center gap-2 border-b px-2 py-1 text-xs">
      <div class="filter-input">
        <Codicon name="filter" :size="12" class="filter-icon" />
        <input v-model="opsState.filterText" type="text" placeholder="Filter" data-testid="ops-filter" />
      </div>

      <div class="segmented">
        <button
          type="button"
          :class="{ active: opsState.statusFilter === 'all' }"
          data-testid="ops-status-all"
          @click="opsState.statusFilter = 'all'"
        >
          All
        </button>
        <button
          type="button"
          :class="{ active: opsState.statusFilter === 'running' }"
          data-testid="ops-status-running"
          @click="opsState.statusFilter = 'running'"
        >
          Running
        </button>
        <button
          type="button"
          :class="{ active: opsState.statusFilter === 'error' }"
          data-testid="ops-status-error"
          @click="opsState.statusFilter = 'error'"
        >
          Errors
        </button>
      </div>

      <span class="muted" data-testid="ops-running-count">{{ runningCount }} running</span>

      <button
        type="button"
        class="clear-button"
        title="Clears the in-memory ring only — op_log retention is automatic"
        @click="clearOps"
      >
        Clear
      </button>
    </div>

    <template v-if="visibleOps.length">
      <div class="header-row">
        <span class="col time">time</span>
        <span class="col conn">connection</span>
        <span class="col tab">tab</span>
        <span class="col kind">kind</span>
        <span class="col status">status</span>
        <span class="col duration">duration</span>
        <span class="col rows">rows</span>
        <span class="col command">command</span>
      </div>

      <div class="min-h-0 flex-1">
        <VirtualList :items="visibleOps" :row-height="rowHeight">
          <template #default="{ item }">
            <div
              class="op-row"
              data-testid="op-row"
              :class="{ selected: opsState.expandedId === item.id }"
              @click="toggleExpand(item.id)"
              @contextmenu.prevent.stop="onOpContextMenu($event, item)"
            >
              <span class="col time muted mono">{{ formatTime(item.startedAt) }}</span>
              <span class="col conn">
                <span
                  v-if="connectionColor(item.connectionId)"
                  class="chip"
                  :style="{ background: `var(--kira-conn-${connectionColor(item.connectionId)})` }"
                />
                {{ connectionName(item.connectionId) }}
              </span>
              <span class="col tab muted">—</span>
              <span class="col kind">{{ item.kind }}</span>
              <span class="col status" :class="item.status">
                <Codicon v-if="item.status === 'running'" name="loading" :size="12" class="spin" />
                {{ item.status }}
                <button
                  v-if="item.status === 'running'"
                  type="button"
                  class="cancel"
                  aria-label="Cancel operation"
                  data-testid="op-cancel"
                  @click.stop="cancelOp(item.id)"
                >
                  <Codicon name="debug-stop" :size="12" />
                </button>
              </span>
              <span class="col duration muted">{{ item.durationMs === null ? '—' : formatDuration(item.durationMs) }}</span>
              <span class="col rows muted">{{ item.rows ?? '—' }}</span>
              <span
                v-if="item.status === 'error'"
                class="col command error"
                :title="item.error ?? undefined"
              >
                {{ item.error ?? 'error' }}
              </span>
              <span v-else class="col command muted mono" :title="item.command ?? undefined">
                {{ item.command ?? '' }}
              </span>
            </div>
          </template>
        </VirtualList>
      </div>

      <div v-if="expandedOp" class="detail" data-testid="op-detail">
        <div class="detail-line mono">{{ expandedOp.command ?? '(no command)' }}</div>
        <div v-if="expandedOp.error" class="detail-line error">{{ expandedOp.error }}</div>
      </div>
    </template>

    <div v-else class="min-h-0 flex-1">
      <EmptyState icon="checklist" label="No operations yet" />
    </div>
  </div>
</template>

<style scoped>
.header-row,
.op-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 6px;
  white-space: nowrap;
  font-size: 11px;
}

.header-row {
  color: var(--kira-fg-disabled);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  padding-top: 2px;
  padding-bottom: 2px;
}

.op-row {
  height: 100%;
  cursor: pointer;
  overflow: hidden;
}

.op-row:hover {
  background: var(--kira-hover);
}

.op-row.selected {
  background: var(--kira-select);
}

.col {
  overflow: hidden;
  text-overflow: ellipsis;
  flex-shrink: 0;
}

.col.time {
  width: 90px;
}

.col.conn {
  width: 140px;
  display: flex;
  align-items: center;
  gap: 4px;
}

.col.tab {
  width: 40px;
}

.col.kind {
  width: 80px;
}

.col.status {
  width: 84px;
  display: flex;
  align-items: center;
  gap: 3px;
}

.col.duration {
  width: 64px;
}

.col.rows {
  width: 48px;
}

.col.command {
  flex: 1;
  min-width: 0;
}

.chip {
  width: 8px;
  height: 8px;
  border-radius: 2px;
  flex-shrink: 0;
}

.status.ok {
  color: var(--kira-ok);
}

.status.error {
  color: var(--kira-error);
}

.status.cancelled {
  color: var(--kira-fg-muted);
}

.status.running {
  color: var(--kira-info);
}

.command.error {
  color: var(--kira-error);
}

.cancel {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  padding: 0;
  border: none;
  background: transparent;
  color: var(--kira-fg-muted);
  cursor: pointer;
}

.cancel:hover {
  color: var(--kira-error);
}

.spin {
  animation: kira-spin 1s linear infinite;
}

@keyframes kira-spin {
  to {
    transform: rotate(360deg);
  }
}

.detail {
  flex-shrink: 0;
  border-top: var(--kira-border-width) solid var(--kira-border);
  padding: 4px 8px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.detail-line {
  font-size: 11px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.detail-line.error {
  color: var(--kira-error);
}

.filter-input {
  position: relative;
  display: flex;
  align-items: center;
}

.filter-icon {
  position: absolute;
  left: 5px;
  color: var(--kira-fg-muted);
  pointer-events: none;
}

.filter-input input {
  width: 110px;
  padding: 2px 4px 2px 18px;
  background: var(--kira-bg-input);
  border: var(--kira-border-width) solid var(--kira-border);
  border-radius: var(--kira-radius);
  color: var(--kira-fg);
  font-size: 11px;
}

.segmented {
  display: flex;
  gap: 1px;
}

.segmented button {
  padding: 1px 6px;
  border-radius: var(--kira-radius);
  border: var(--kira-border-width) solid var(--kira-border);
  background: var(--kira-bg-input);
  color: var(--kira-fg-muted);
  cursor: pointer;
  font-size: 11px;
}

.segmented button.active {
  background: var(--kira-select);
  color: var(--kira-fg);
}

.muted {
  color: var(--kira-fg-muted);
}

.mono {
  font-family: var(--kira-font-family);
}

.clear-button {
  margin-left: auto;
  padding: 1px 6px;
  border-radius: var(--kira-radius);
  border: var(--kira-border-width) solid var(--kira-border);
  background: var(--kira-bg-input);
  color: var(--kira-fg);
  cursor: pointer;
  font-size: 11px;
}
</style>
