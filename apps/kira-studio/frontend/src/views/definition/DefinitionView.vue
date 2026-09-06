<script setup lang="ts">
import { definitionText } from '@shared/domain/definition';
import type { DefinitionTabRecord } from '@shared/domain/tabs';
import { decodePath, pathTail } from '@shared/domain/tree';
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { copyText } from '../../clipboard';
import CodeMirrorHost from '../../editor/CodeMirrorHost.vue';
import { findRanges } from '../../editor/findRanges';
import { registerCommand } from '../../shortcuts/commands';
import { connectionRecord, connectionsState } from '../../state/connections';
import { openConsoleTab, patchDefinitionTabState } from '../../state/tabs';
import CodiconIcon from '../../theme/CodiconIcon.vue';
import AppButton from '../../theme/primitives/AppButton.vue';
import IconButton from '../../theme/primitives/IconButton.vue';
import MessageStrip from '../../theme/primitives/MessageStrip.vue';
import PanelSearchBox from '../../theme/primitives/PanelSearchBox.vue';
import ReconnectGate from '../../theme/primitives/ReconnectGate.vue';
import SegmentedControl from '../../theme/primitives/SegmentedControl.vue';
import ViewChrome from '../../theme/primitives/ViewChrome.vue';
import ResponseFindBar, {
  type FindBarHost,
  type FindBarTarget,
} from '../shared/ResponseFindBar.vue';
import { sqlDialectFor } from '../shared/sqlIdent';
import { refreshOrReconnect, useConnectionGate } from '../shared/useConnectionGate';
import ColumnsSection from './ColumnsSection.vue';
import ConstraintsSection from './ConstraintsSection.vue';
import IndexesSection from './IndexesSection.vue';
import PropertiesSection from './PropertiesSection.vue';
import { load, runtime } from './state';
import { buildConstraintRows } from './structure';
import ValidationSection from './ValidationSection.vue';

// MainView.vue keys this component by tab.id, so one instance <-> one tab — same discipline as
// DataView.vue.
const props = defineProps<{ tab: DefinitionTabRecord }>();

const { connectionStatus, needsReconnect, onReconnectAndLoad } = useConnectionGate(
  () => props.tab,
  () => load(props.tab.id),
);

const rt = computed(() => runtime[props.tab.id]);
const loading = computed(() => rt.value?.status === 'loading');

function onRefresh(): void {
  refreshOrReconnect(needsReconnect.value, onReconnectAndLoad, () =>
    load(props.tab.id, { refresh: true }),
  );
}

// "Open query console" mirrors project/menus.ts's own consoleMenuItem: the tab's own connection
// and path, handed straight to openConsoleTab, no new capability involved.
function onOpenConsole(): void {
  if (props.tab.connectionId) openConsoleTab(props.tab.connectionId, props.tab.path);
}

function onCopy(): void {
  if (definition.value) copyText(definitionText(definition.value));
}

let unregisterCommands: Array<() => void> = [];

onMounted(() => {
  if (!needsReconnect.value && !runtime[props.tab.id]) {
    void load(props.tab.id);
  }
  unregisterCommands = [
    registerCommand('view.refresh', onRefresh),
    registerCommand('view.find', toggleSearch),
  ];
});

onUnmounted(() => {
  for (const off of unregisterCommands) off();
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

// P22b D14: F21's own finding — a whole DDL document plus columns/indexes/constraints sections is
// the single largest searchable document in Studio, and had no search at all. Structure's own
// search is a plain substring filter over each section's *rows*, applied here (once, over the
// arrays every section already receives as props) rather than teaching four section components
// their own filtering — ColumnsSection/IndexesSection/ConstraintsSection stay unchanged.
const searchOpen = ref(false);
function toggleSearch(): void {
  searchOpen.value = !searchOpen.value;
  // D13's own rule (HttpRequestView.vue's toggleFieldFilter): closing must restore every hidden
  // row — the find bar's own query lives inside ResponseFindBar and resets for free on unmount.
  if (!searchOpen.value) structureFilterQuery.value = '';
}
function closeSearch(): void {
  searchOpen.value = false;
  structureFilterQuery.value = '';
}

const structureFilterQuery = ref('');
const structureFilterActive = computed(
  () => searchOpen.value && pane.value === 'structure' && structureFilterQuery.value.trim() !== '',
);
const structureQuery = computed(() => structureFilterQuery.value.trim().toLowerCase());
const filteredColumns = computed(() => {
  if (!structureFilterActive.value) return meta.value?.columns ?? [];
  const q = structureQuery.value;
  return (meta.value?.columns ?? []).filter((c) => c.name.toLowerCase().includes(q));
});
const filteredIndexes = computed(() => {
  if (!structureFilterActive.value) return meta.value?.indexes ?? [];
  const q = structureQuery.value;
  return (meta.value?.indexes ?? []).filter(
    (i) =>
      i.name.toLowerCase().includes(q) ||
      (i.columns ?? []).some((c) => c.toLowerCase().includes(q)),
  );
});
const filteredConstraintRows = computed(() => {
  if (!structureFilterActive.value) return constraintRows.value;
  const q = structureQuery.value;
  return constraintRows.value.filter((r) => r.name.toLowerCase().includes(q));
});

// Source's own search is the same find-in-document ResponseFindBar every other big document in
// this app uses (HTTP's ResponsePane.vue, gRPC's own ResponsePane.vue) — one target, the whole
// DDL/JSON text.
const docHostRef = ref<FindBarHost | null>(null);
const findBarRef = ref<{ query: string; currentGlobal: number } | null>(null);
const findTargets = computed<readonly FindBarTarget[]>(() => {
  if (!searchOpen.value || pane.value !== 'source') return [];
  return [{ doc: document.value, host: docHostRef.value }];
});
const docHighlights = computed(() => {
  const bar = findBarRef.value;
  const query = bar?.query ?? '';
  if (!query || findTargets.value.length === 0) return undefined;
  const currentGlobal = bar?.currentGlobal ?? -1;
  return (doc: string) => findRanges(doc, query, currentGlobal);
});

const dialect = computed(() => sqlDialectFor(connectionRecord(props.tab.connectionId)?.kind));

const originPhrase = computed(() =>
  definition.value?.origin === 'server' ? 'server definition' : 'composed from catalog metadata',
);

// P23 D8: Open in console was unconditional before this phase, which only ever mattered because
// every kind with a definition tab also had a console (Postgres/MariaDB/Mongo). Kafka and SQS
// break that coincidence (caps.sql is false for both, P10's D13) — same gate project/menus.ts's
// own consoleMenuItem() already uses for the tree's context-menu equivalent.
const canOpenConsole = computed(
  () => connectionsState.states[props.tab.connectionId ?? '']?.caps?.sql === true,
);

// P16 design system LAW: connection colour reaches a view as a 2px rail (tree, tab, toolbar
// cap) or a dot (view header) — the same per-tab lookup Toolbar.vue and TreeRow.vue already
// use for the rail elsewhere, just aimed at the dot instead.
const connRecord = computed(() => connectionRecord(props.tab.connectionId));
// Produced locally from the path — the same discipline SlickGridHost.vue's own qualifiedName()
// uses (never round-tripped to the engine for a string join): connection name plus every
// segment above the target, joined for the view header's breadcrumb.
const breadcrumb = computed(() => {
  if (!props.tab.connectionId) return '';
  const parents = decodePath(props.tab.connectionId, props.tab.path)
    .segments.slice(0, -1)
    .map((s) => s.name);
  const parts = [connRecord.value?.name, ...parents].filter((p): p is string => !!p);
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
    <ViewChrome
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
          <CodiconIcon name="lock" :size="13" />
          read-only — {{ originPhrase }}
        </span>
      </template>

      <!-- Stop is permanently disabled: this load has no cancellation to offer (state.ts tracks
           no op-id for it) — the slot stays reserved rather than wired to a stop that doesn't
           exist. -->
      <template #toolbar>
        <div class="sep" />
        <div class="group">
          <SegmentedControl
            :model-value="pane"
            :options="PANE_OPTIONS"
            data-testid="definition-pane"
            @update:model-value="setPane"
          />
        </div>
        <!-- P22b D14: the single largest searchable document in Studio (F21) had no search at
             all — a find-in-document bar for Source, a plain substring filter for Structure. -->
        <IconButton
          icon="search"
          :active="searchOpen"
          v-tooltip="pane === 'source' ? 'Find in definition' : 'Filter columns/indexes/constraints'"
          data-testid="definition-search-toggle"
          @click="toggleSearch"
        />
      </template>

      <template #toolbar-end>
        <!-- D7: Copy/notes describe the Source pane's raw text specifically — Structure has its
             own per-section content and count badges, nothing to copy as one document. -->
        <template v-if="pane === 'source'">
          <div class="sep" />
          <AppButton
            icon="copy"
            v-tooltip="'Copy definition to clipboard'"
            data-testid="definition-copy"
            @click="onCopy"
          >
            Copy
          </AppButton>
        </template>
        <AppButton
          v-if="canOpenConsole"
          icon="terminal"
          v-tooltip="'Open query console here'"
          data-testid="definition-open-console"
          @click="onOpenConsole"
        >
          Open in console
        </AppButton>
      </template>

      <template #strips>
        <MessageStrip
          v-if="rt?.status === 'error' && rt.error"
          tone="err"
          icon="error"
          data-testid="definition-error"
        >
          <span class="err-message">{{ rt.error }}</span>
        </MessageStrip>
        <div
          v-if="pane === 'source' && definition && definition.notes.length > 0"
          class="p-strip note"
          data-testid="definition-notes"
        >
          <span class="icon-box"><CodiconIcon name="info" :size="13" /></span>
          <ul class="notes-list">
            <li v-for="(note, i) in definition.notes" :key="i">{{ note }}</li>
          </ul>
        </div>
        <PanelSearchBox
          v-if="searchOpen && pane === 'structure'"
          v-model="structureFilterQuery"
          placeholder="Filter columns, indexes, constraints"
          testid="definition-structure-filter"
        />
      </template>

      <!-- Item 4: the reconnect gate used to replace this whole ViewChrome (header, toolbar and
           all) — every other view but the grid's DataView.vue did the same, the one inconsistency
           this fixes. ViewChrome itself (and so its toolbar slots above) now always renders; only
           the body — the part that actually needs a live connection — swaps for the gate. -->
      <ReconnectGate
        v-if="needsReconnect"
        container-testid="definition-reconnect"
        button-testid="definition-reconnect-load"
        @reconnect="onReconnectAndLoad"
      />
      <template v-else>
      <div v-if="pane === 'source'" class="editor-body">
        <CodeMirrorHost
          ref="docHostRef"
          :doc="document"
          :language="definition?.language === 'json' ? 'json' : 'sql'"
          :sql-dialect="dialect"
          :read-only="true"
          :range-highlights="docHighlights"
        />
      </div>
      <!-- P23 D8: the Structure body no longer hard-requires `meta` — Kafka and SQS have no
           describe() (F7), so a definition can arrive with meta still null. PropertiesSection
           renders regardless; everything below it stays conditional on the data it needs, exactly
           as before. P22b D14: Columns/Indexes/Constraints get the filtered arrays (computed
           above) instead of meta's own raw ones — filtering lives here, once, not in each
           section. -->
      <div v-else-if="definition" class="structure-body">
        <PropertiesSection v-for="section in definition.sections" :key="section.title" :section="section" />
        <template v-if="meta">
          <ColumnsSection
            v-if="!isCollection"
            :columns="filteredColumns"
            :foreign-key-column-names="foreignKeyColumnNames"
            :connection-id="tab.connectionId ?? ''"
            :table-path="tab.path"
          />
          <IndexesSection :indexes="filteredIndexes" />
          <ConstraintsSection
            v-if="!isCollection"
            :connection-id="tab.connectionId ?? ''"
            :constraints="filteredConstraintRows"
          />
        </template>
        <ValidationSection v-if="isCollection" :document-schema="definition.documentSchema" />
      </div>
      <!-- P22b D14: docked below the pane it searches (LAW 03), mirroring HTTP's own
           ResponsePane.vue — only shown over the Source pane's single document. -->
      <ResponseFindBar
        v-if="searchOpen && pane === 'source'"
        ref="findBarRef"
        :targets="findTargets"
        @close="closeSearch"
      />
      <!-- LAW — there is no editor status line: identity moved to the view header above,
           duration to the toolbar's run-state, and this tab has no pending edits to report. -->
      </template>
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
