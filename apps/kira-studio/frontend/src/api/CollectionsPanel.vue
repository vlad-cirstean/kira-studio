<script setup lang="ts">
import CodiconIcon from '@theme/CodiconIcon.vue';
import { Alert, AlertTitle } from '@theme/components/ui/alert';
import { Button } from '@theme/components/ui/button';
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from '@theme/components/ui/input-group';
import { Tooltip, TooltipContent, TooltipTrigger } from '@theme/components/ui/tooltip';
import { registerCommand } from '@workbench/shortcuts/commands';
import { usePanelHeaderSearch } from '@workbench/util/panelSearch';
import { computed, onMounted, onUnmounted, ref, useTemplateRef } from 'vue';
import CollectionsTree from './CollectionsTree.vue';
import ImportReportStrip from './ImportReportStrip.vue';
import { useCollectionsStore } from './state/collections';
import { useImportCurlStore } from './state/curl';
import { useDynamicValuesStore } from './state/dynamicValues';
import { useVariablesStore } from './state/variables';
import { openApiRequestTab, openVariableSetTab } from './tabs';

const dynamicValuesStore = useDynamicValuesStore();
const collectionsStore = useCollectionsStore();
const importCurlStore = useImportCurlStore();
const variablesStore = useVariablesStore();

// P4 C5: the placeholder is gone — this is a real tree now, mounted through the same panel-shell
// geometry Studio's ProjectPanel.vue uses. `empty` is no longer hardcoded: it is "this app has no
// collections yet", which is also what gates the search box below (F14).
//
// The header's own `new-request` testid is the one front door left (P1's own affordance) — P13
// D6 removed the empty state's duplicate `new-request-empty`/`new-collection-empty`/
// `import-collection-empty` actions entirely; tests/ui/api-ui-consistency.spec.ts asserts none of
// the three exist, not that they are preserved.
// P28 D16(d): back to "no collections" alone. P22b D8 had widened this to also require no
// environments, because the environments category lived in this panel and a project with
// environments but no collections still had something to show; with that category gone, this
// panel shows collections and nothing else, so an environment must not keep the empty state away.
const empty = computed(() => collectionsStore.collections.length === 0);

// P112: useCollectionsStore's own app-lifetime query observer fetches the tree on store creation
// (same as useVariablesStore's own environments query below) — there is nothing left to trigger
// on mount here. PanelShell still renders #body only once `empty` reads false, which now follows
// the query's own data rather than a mount-triggered fetch.

// P22b D8: runtime-only collapse state for the two categories — a panel section is not a
// preference worth a storage round trip (ConsoleViewRuntime's own "runtime-only, never saved"
// rule). Collections starts expanded (today's only view of the tree); Environments starts
// collapsed (F11: it was behind a dialog before this, so a user has never had it open by default).
const collectionsExpanded = ref(true);
function onSearch(value: string): void {
  collectionsStore.search = value;
}

// P104 §3, P107 T1-17: PanelShell's own header/search-reveal/type-ahead-redirect logic, via the
// shared usePanelHeaderSearch composable rather than an inline copy.
const rootEl = useTemplateRef<HTMLElement>('rootEl');
const { showSearch, toggleSearch } = usePanelHeaderSearch(rootEl, {
  searchable: () => true,
  getSearch: () => collectionsStore.search,
  setSearch: onSearch,
});

function onNewCollection(): void {
  void collectionsStore.createCollection();
}

function onImport(): void {
  void collectionsStore.importCollection();
}

// P5 D11, re-homed to a tab by P17 D16: the palette's Variables… entry — opens the tab for
// whichever collection is currently selected in the tree (a collection row directly, or a
// folder/request's own collection). A no-op with nothing selected, the same "view-scoped, no-op
// elsewhere" shape view.run/api.save already have.
function onVariablesCommand(): void {
  const selected = collectionsStore.selected;
  if (!selected) return;
  if (selected.startsWith('c:')) {
    const id = selected.slice(2);
    const collection = collectionsStore.collectionRecord(id);
    if (collection) openVariableSetTab('collection', id, collection.name);
    return;
  }
  if (selected.startsWith('i:')) {
    const item = collectionsStore.itemRecord(selected.slice(2));
    const collection = item ? collectionsStore.collectionRecord(item.collectionId) : undefined;
    if (item && collection) {
      openVariableSetTab('collection', item.collectionId, collection.name);
    }
  }
}

function onEnvironments(): void {
  variablesStore.openEnvironments();
}

// P6 D11: the palette's own "Dynamic values…" entry — not scoped to any selection, unlike
// Variables… above.
function onDynamicValues(): void {
  dynamicValuesStore.openDynamicValuesDialog();
}

// P7 D12: the palette's own "Import from curl…" entry — same shape as the three above, not
// tab-scoped.
function onImportCurl(): void {
  importCurlStore.openImportCurlDialog();
}

// D15: the palette's Import collection…, Variables…, Environments…, (P6) Dynamic values… and
// (P7) Import from curl… entries. Registered by the panel rather than a view, since the panel is
// mounted for the whole of Api mode — none is tab-scoped.
let unregisterCommands: Array<() => void> = [];
onMounted(() => {
  unregisterCommands = [
    registerCommand('api.import', onImport),
    registerCommand('api.variables', onVariablesCommand),
    registerCommand('api.environments', onEnvironments),
    registerCommand('api.dynamicValues', onDynamicValues),
    registerCommand('api.importCurl', onImportCurl),
  ];
});
onUnmounted(() => {
  for (const off of unregisterCommands) off();
});
</script>

<template>
  <!-- P104 §3: PanelShell inlined (no library counterpart). -->
  <div ref="rootEl" class="flex h-full flex-col">
    <div class="flex items-center shrink-0 h-bar gap-1 px-1.5 border-b border-border text-kira-sm text-muted-foreground uppercase tracking-wider">
      <span>Collections</span>
      <Tooltip>
        <TooltipTrigger as-child>
          <Button
            variant="toolbar"
            size="kira-icon"
            class="ml-auto"
            :class="{ 'bg-field text-fg': showSearch }"
            aria-label="Search"
            data-testid="toggle-search"
            @click="toggleSearch"
          >
            <CodiconIcon name="search" :size="13" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{{ showSearch ? 'Hide search' : 'Search' }}</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger as-child>
          <Button
            variant="toolbar"
            size="kira-icon"
            aria-label="New request"
            data-testid="new-request"
            @click="openApiRequestTab"
          >
            <CodiconIcon name="add" :size="13" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>New request</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger as-child>
          <Button
            variant="toolbar"
            size="kira-icon"
            aria-label="New collection"
            data-testid="new-collection"
            @click="onNewCollection"
          >
            <CodiconIcon name="new-folder" :size="13" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>New collection</TooltipContent>
      </Tooltip>
      <!-- P28 D18: the Postman import moved to the menu bar (App → Import Postman Collection…)
           and to the command palette entry it already had. D11's spinner-on-the-action reasoning
           went with the button; collectionsState.busy still gates re-entry inside
           importCollection() itself, so a second import cannot start while one is running. -->
      <!-- P5 D3/D11: the environments dialog's own entry point — environments exist
           independently of collections, so this lives in the panel's header, not the tree. -->
      <Tooltip>
        <TooltipTrigger as-child>
          <Button
            variant="toolbar"
            size="kira-icon"
            aria-label="Environments"
            data-testid="api-environments"
            @click="onEnvironments"
          >
            <CodiconIcon name="server-environment" :size="13" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Environments…</TooltipContent>
      </Tooltip>
    </div>
    <template v-if="!empty">
      <InputGroup v-if="showSearch" data-testid="collections-search-group">
        <InputGroupAddon><CodiconIcon name="search" :size="13" /></InputGroupAddon>
        <InputGroupInput
          :model-value="collectionsStore.search"
          data-testid="tree-search"
          @update:model-value="onSearch(String($event))"
        />
        <InputGroupAddon v-if="collectionsStore.search" align="inline-end">
          <InputGroupButton aria-label="Clear search" @click="onSearch('')">
            <CodiconIcon name="close" :size="13" />
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
      <div class="min-h-0 flex-1">
        <div class="panel-body">
          <ImportReportStrip />
          <div class="panel-category" :class="{ collapsed: !collectionsExpanded }">
            <button
              type="button"
              class="panel-category-head"
              data-testid="collections-category-toggle"
              @click="collectionsExpanded = !collectionsExpanded"
            >
              <CodiconIcon :name="collectionsExpanded ? 'chevron-down' : 'chevron-right'" :size="13" />
              <span>Collections</span>
            </button>
            <CollectionsTree v-if="collectionsExpanded" class="tree-body" />
          </div>
          <!-- P28 D16(d) removes P22b D8's environments category from this panel by user request
               ("remove the environment list from alongside the collections list entirely"). The
               environments themselves did not go anywhere: the header's own action opens the
               environments tab, which lists and manages them, and each row there still opens the
               same openVariableSetTab('environment', …) this category used to. -->
        </div>
      </div>
    </template>
    <div v-else class="side-empty flex flex-1 min-h-0 flex-col items-center justify-center gap-2 p-4 text-center">
      <ImportReportStrip />
      <Alert class="empty-state" data-testid="collections-empty">
        <CodiconIcon name="folder-library" :size="24" class="text-subtle" />
        <AlertTitle class="text-kira-md text-muted-foreground font-normal">No collections yet</AlertTitle>
        <span class="text-kira-xs text-subtle side-empty-text"
          >Create one from the <b>+</b> above, or import a Postman collection.</span
        >
      </Alert>
    </div>
  </div>
</template>

<style scoped>
@reference "@theme/base.css";

.panel-body {
  @apply flex h-full min-h-0 flex-col;
}

/* P22b D8: the collections tree's own category — flex: 1 always, so its own collapse (a rarer
   action than environments', which starts collapsed by default) never fights environments-
   category's fixed 40% cap below for space. */
.panel-category {
  @apply flex flex-1 min-h-0 flex-col;
}

/* No new primitive (F12): reuses primitives.css's own .def-section-title idiom (uppercase/muted/
   t-sm/letter-spacing) — promote to primitives.css only if a second panel wants this exact
   category shape (P18's own "promote when a second consumer appears" rule). */
.panel-category-head {
  all: unset;
  @apply flex shrink-0 cursor-pointer items-center gap-1 px-1.5 text-muted-foreground uppercase tracking-wider h-control text-kira-sm;
}
.panel-category-head:hover {
  @apply text-fg;
}

.tree-body {
  @apply flex-1 min-h-0;
}

.side-empty-text {
  @apply leading-normal;
}

.empty-state {
  @apply flex flex-1 min-h-0 flex-col items-center justify-center gap-2 border-0 bg-transparent text-center;
}
</style>
