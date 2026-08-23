<script setup lang="ts">
import { ddlText } from '@shared/domain/ddl';
import { computed } from 'vue';
import { copyText } from '../../clipboard';
import { openConsoleTab, tabsState } from '../../state/tabs';
import Codicon from '../../theme/Codicon.vue';
import { load, runtime } from './state';

const props = defineProps<{ tabId: string }>();

const rt = computed(() => runtime[props.tabId]);
const loading = computed(() => rt.value?.status === 'loading');

// connectionId/path live on every TabRecord variant regardless of kind (tabRecordBase), so
// finding by id alone gives us both without narrowing to DdlTabRecord — looked up here rather
// than passed as a prop because DdlView.vue resolves the same tab the same way, and Toolbar.vue
// only ever hands this component the id (P16's Toolbars.html keeps the toolbar and its view as
// siblings, not parent/child).
const tab = computed(() => tabsState.tabs.find((t) => t.id === props.tabId));

function onRefresh(): void {
  void load(props.tabId, { refresh: true });
}

// "Open query console" mirrors project/menus.ts's own consoleMenuItem: the row's connection and
// path, handed straight to openConsoleTab, no new capability involved.
function onOpenConsole(): void {
  const t = tab.value;
  if (t?.connectionId) openConsoleTab(t.connectionId, t.path);
}

function onCopy(): void {
  const ddl = rt.value?.ddl;
  if (ddl) copyText(ddlText(ddl));
}
</script>

<template>
  <div class="p-toolbar last" data-testid="ddl-toolbar">
    <div class="group">
      <button
        type="button"
        class="p-iconbtn"
        title="Refresh"
        data-testid="ddl-refresh"
        :disabled="loading"
        @click="onRefresh"
      >
        <Codicon name="refresh" :size="14" />
      </button>
      <!-- LAW — Stop always follows Refresh, disabled when idle: this load has no cancellation
           to offer (state.ts tracks no op-id for it), so the slot stays reserved but permanently
           disabled rather than wired to a stop that doesn't exist. -->
      <button type="button" class="p-iconbtn is-disabled" title="Nothing to stop" disabled>
        <Codicon name="debug-stop" :size="14" />
      </button>
      <!-- LAW — work-in-progress is a ring + elapsed time next to the button that started it.
           The duration text itself needs a timing field this tab's runtime doesn't track
           (only status/error/source/ddl) — skipped rather than fabricated; the ring alone still
           reflects loading/error. -->
      <span class="p-run-state" :class="{ 'is-running': loading, 'is-error': rt?.status === 'error' }">
        <span class="ring" />
      </span>
    </div>
    <div class="sep" />
    <div class="group p-push">
      <button type="button" class="p-btn" title="Copy DDL to clipboard" @click="onCopy">
        <span class="icon-box"><Codicon name="copy" :size="14" /></span>
        Copy
      </button>
      <button type="button" class="p-btn" title="Open query console here" @click="onOpenConsole">
        <span class="icon-box"><Codicon name="terminal" :size="14" /></span>
        Open in console
      </button>
    </div>
  </div>
</template>
