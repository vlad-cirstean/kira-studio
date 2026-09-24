<script setup lang="ts">
import { definitionText } from '@shared/domain/definition';
import { decodePath, pathTail } from '@shared/domain/tree';
import CodiconIcon from '@theme/CodiconIcon.vue';
import { Alert, AlertDescription } from '@theme/components/ui/alert';
import { Badge } from '@theme/components/ui/badge';
import { Button } from '@theme/components/ui/button';
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from '@theme/components/ui/input-group';
import { ToggleGroup, ToggleGroupItem } from '@theme/components/ui/toggle-group';
import {
  Tooltip,
  TooltipContent,
  TooltipDisabledTrigger,
  TooltipTrigger,
} from '@theme/components/ui/tooltip';
import { connColorVar } from '@theme/connColor';
import { registerCommand } from '@workbench/shortcuts/commands';
import { copyText } from '@workbench/util/clipboard';
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { findRanges } from '../../editor/findRanges';
import MonacoHost from '../../editor/MonacoHost.vue';
import { useConnectionsStore } from '../../state/connections';
import { useRunState } from '../../state/runState';
import type { DefinitionTabRecord } from '../../state/tabDomain';
import { useTabsStore } from '../../state/tabs';
import EngineIcon from '../../theme/EngineIcon.vue';
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
import { useDefinitionViewStore } from './state';
import { buildConstraintRows } from './structure';
import ValidationSection from './ValidationSection.vue';

// MainView.vue keys this component by tab.id, so one instance <-> one tab — same discipline as
// DataView.vue.
const props = defineProps<{ tab: DefinitionTabRecord }>();
const connectionsStore = useConnectionsStore();
const tabsStore = useTabsStore();
const definitionViewStore = useDefinitionViewStore();

const { needsReconnect, onReconnectAndLoad } = useConnectionGate(
  () => props.tab,
  () => definitionViewStore.load(props.tab.id),
);

const rt = computed(() => definitionViewStore.runtime[props.tab.id]);
const loading = computed(() => rt.value?.status === 'loading');

function onRefresh(): void {
  refreshOrReconnect(needsReconnect.value, onReconnectAndLoad, () =>
    definitionViewStore.load(props.tab.id, { refresh: true }),
  );
}

// "Open query console" mirrors project/menus.ts's own consoleMenuItem: the tab's own connection
// and path, handed straight to openConsoleTab, no new capability involved.
function onOpenConsole(): void {
  if (props.tab.connectionId) tabsStore.openConsoleTab(props.tab.connectionId, props.tab.path);
}

function onCopy(): void {
  if (definition.value) copyText(definitionText(definition.value));
}

let unregisterCommands: Array<() => void> = [];

onMounted(() => {
  if (!needsReconnect.value && !definitionViewStore.runtime[props.tab.id]) {
    void definitionViewStore.load(props.tab.id);
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
  tabsStore.patchDefinitionTabState(props.tab.id, { pane: value });
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

const dialect = computed(() => sqlDialectFor(connectionsStore.connectionRecord(props.tab.connectionId)?.kind));

const originPhrase = computed(() =>
  definition.value?.origin === 'server' ? 'server definition' : 'composed from catalog metadata',
);

// P23 D8: Open in console was unconditional before this phase, which only ever mattered because
// every kind with a definition tab also had a console (Postgres/MariaDB/Mongo). Kafka and SQS
// break that coincidence (caps.sql is false for both, P10's D13) — same gate project/menus.ts's
// own consoleMenuItem() already uses for the tree's context-menu equivalent.
const canOpenConsole = computed(
  () => connectionsStore.states[props.tab.connectionId ?? '']?.caps?.sql === true,
);

// P16 design system LAW: connection colour reaches a view as a 2px rail (tree, tab, toolbar
// cap) or a dot (view header) — the same per-tab lookup Toolbar.vue and TreeRow.vue already
// use for the rail elsewhere, just aimed at the dot instead.
const connRecord = computed(() => connectionsStore.connectionRecord(props.tab.connectionId));
// P104 §3: ViewChrome/ViewHeader/RunState inlined at this call site (no library counterpart) —
// railColor mirrors ViewChrome.vue's own `connection ? (connection.color ?? null) : undefined`.
const railColor = computed(() => (connRecord.value ? (connRecord.value.color ?? null) : undefined));
const runState = useRunState(() => props.tab.id);
const runStateLabel = computed(() => {
  if (runState.value.status === 'error') return 'failed';
  if (runState.value.elapsedMs === null) return '—';
  return runState.value.elapsedMs < 1000
    ? `${Math.round(runState.value.elapsedMs)} ms`
    : `${(runState.value.elapsedMs / 1000).toFixed(1)} s`;
});
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
    <!-- P104 §3: ViewChrome/ViewHeader inlined (no library counterpart) — Tailwind utilities over
         components/ui parts, the same view-head/toolbar chrome utility set every other view uses
         (P110 B28). -->
    <div class="h-bar shrink-0 flex items-center gap-1.5 px-2 border-b border-border">
      <span
        v-if="railColor !== undefined"
        class="size-1.25 rounded-full shrink-0"
        :class="(!railColor || railColor === 'none') ? 'bg-none border border-disabled' : 'bg-(--kira-rail)'"
        :style="{ '--kira-rail': connColorVar(railColor) }"
      />
      <span v-if="connRecord?.kind" class="size-4 flex items-center justify-center shrink-0"><EngineIcon :kind="connRecord.kind" :size="13" /></span>
      <span class="size-4 flex items-center justify-center shrink-0"><CodiconIcon name="code" :size="13" /></span>
      <span class="text-kira-md text-fg truncate" data-testid="definition-target">
        <span v-if="breadcrumb" class="text-subtle">{{ breadcrumb }}</span>{{ targetLabel }}
      </span>
      <Badge v-if="targetTail">{{ targetTail.kind }}</Badge>
      <Badge>
        <CodiconIcon name="lock" :size="13" />
        read-only — {{ originPhrase }}
      </Badge>
      <span class="ml-auto flex items-center gap-1" />
    </div>
    <div class="h-0.5 shrink-0 bg-(--kira-rail)" :style="{ '--kira-rail': connColorVar(railColor) }" />
    <div class="h-bar shrink-0 flex items-center gap-1.5 px-2 border-b border-border">
      <div class="flex items-center gap-1.5 min-w-0">
        <Tooltip>
          <TooltipTrigger as-child>
            <TooltipDisabledTrigger>
              <Button variant="toolbar" size="kira-icon" :disabled="loading" aria-label="Refresh" data-testid="definition-refresh" @click="onRefresh">
                <CodiconIcon name="refresh" :size="13" />
              </Button>
            </TooltipDisabledTrigger>
          </TooltipTrigger>
          <TooltipContent>Refresh</TooltipContent>
        </Tooltip>
      </div>
      <div class="w-px h-3.5 bg-border-strong mx-0.5 shrink-0" />
      <div class="flex items-center gap-1.5 min-w-0">
        <ToggleGroup type="single" :model-value="pane" data-testid="definition-pane" @update:model-value="(v) => v && setPane(v as 'structure' | 'source')">
          <ToggleGroupItem v-for="opt in PANE_OPTIONS" :key="opt.value" :value="opt.value" :data-testid="opt.testid">
            {{ opt.label }}
          </ToggleGroupItem>
        </ToggleGroup>
      </div>
      <!-- P22b D14: the single largest searchable document in Studio (F21) had no search at
           all — a find-in-document bar for Source, a plain substring filter for Structure. -->
      <Tooltip>
        <TooltipTrigger as-child>
          <Button
            variant="toolbar"
            size="kira-icon"
            :data-active="searchOpen"
            aria-label="Search"
            data-testid="definition-search-toggle"
            @click="toggleSearch"
          >
            <CodiconIcon name="search" :size="13" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{{ pane === 'source' ? 'Find in definition' : 'Filter columns/indexes/constraints' }}</TooltipContent>
      </Tooltip>
      <span class="ml-auto" />
      <span
        data-testid="run-state"
        class="inline-flex items-center gap-1 font-data text-kira-xs text-subtle"
        :class="{ 'text-info': runState.status === 'running', 'text-error': runState.status === 'error' }"
      >
        <span data-testid="run-state-label" class="label min-w-[7ch] text-right">{{ runStateLabel }}</span>
        <span
          class="h-3 w-3 shrink-0 rounded-full border-2 border-border-strong"
          :class="{
            'animate-kira-spin border-t-primary border-r-transparent border-b-primary border-l-primary': runState.status === 'running',
            'border-error': runState.status === 'error',
          }"
        />
      </span>
      <div class="flex items-center gap-1.5 min-w-0">
        <!-- D7: Copy/notes describe the Source pane's raw text specifically — Structure has its
             own per-section content and count badges, nothing to copy as one document. -->
        <template v-if="pane === 'source'">
          <div class="w-px h-3.5 bg-border-strong mx-0.5 shrink-0" />
          <Tooltip>
            <TooltipTrigger as-child>
              <Button variant="toolbar" size="kira" data-testid="definition-copy" @click="onCopy">
                <CodiconIcon name="copy" :size="13" />
                Copy
              </Button>
            </TooltipTrigger>
            <TooltipContent>Copy definition to clipboard</TooltipContent>
          </Tooltip>
        </template>
        <Tooltip v-if="canOpenConsole">
          <TooltipTrigger as-child>
            <Button variant="toolbar" size="kira" data-testid="definition-open-console" @click="onOpenConsole">
              <CodiconIcon name="terminal" :size="13" />
              Open in console
            </Button>
          </TooltipTrigger>
          <TooltipContent>Open query console here</TooltipContent>
        </Tooltip>
      </div>
    </div>

    <Alert v-if="rt?.status === 'error' && rt.error" variant="destructive" data-testid="definition-error">
      <AlertDescription><span class="err-message">{{ rt.error }}</span></AlertDescription>
    </Alert>
    <Alert
      v-if="pane === 'source' && definition && definition.notes.length > 0"
      variant="note"
      data-testid="definition-notes"
    >
      <AlertDescription class="flex items-start gap-1.5">
        <span class="size-4 flex items-center justify-center shrink-0"><CodiconIcon name="info" :size="13" /></span>
        <ul class="notes-list">
          <li v-for="(note, i) in definition.notes" :key="i">{{ note }}</li>
        </ul>
      </AlertDescription>
    </Alert>
    <InputGroup v-if="searchOpen && pane === 'structure'">
      <InputGroupAddon><CodiconIcon name="search" :size="13" /></InputGroupAddon>
      <InputGroupInput
        v-model="structureFilterQuery"
        placeholder="Filter columns, indexes, constraints"
        data-testid="definition-structure-filter"
      />
      <InputGroupAddon v-if="structureFilterQuery" align="inline-end">
        <InputGroupButton aria-label="Clear filter" @click="structureFilterQuery = ''">
          <CodiconIcon name="close" :size="13" />
        </InputGroupButton>
      </InputGroupAddon>
    </InputGroup>

    <!-- Item 4: the reconnect gate used to replace this whole view chrome (header, toolbar and
         all) — every other view but the grid's DataView.vue did the same, the one inconsistency
         this fixes. The chrome above always renders; only the body — the part that actually needs
         a live connection — swaps for the gate. -->
    <div
      v-if="needsReconnect"
      class="flex-1 min-h-0 flex flex-col items-center justify-center gap-2 text-subtle"
      data-testid="definition-reconnect"
    >
      <Button variant="dialog-primary" size="kira-lg" data-testid="definition-reconnect-load" @click="onReconnectAndLoad">
        Reconnect &amp; load
      </Button>
    </div>
    <template v-else>
    <div v-if="pane === 'source'" class="editor-body">
      <MonacoHost
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
  </div>
</template>

<style scoped>
@reference "@theme/base.css";

.definition-view {
  @apply h-full flex flex-col min-h-0;
}

.err-message {
  @apply whitespace-pre-wrap font-[family-name:var(--kira-font-data)];
}

.notes-list {
  @apply m-0 pl-3;
}

.editor-body {
  @apply flex-1 min-h-0;
}

.structure-body {
  @apply flex-1 min-h-0 overflow-y-auto flex flex-col gap-4 p-3;
}
</style>
