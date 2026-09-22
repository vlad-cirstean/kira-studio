<script setup lang="ts">
import CodiconIcon from '@theme/CodiconIcon.vue';
import EmptyState from '@theme/primitives/EmptyState.vue';
import IconButton from '@theme/primitives/IconButton.vue';
import PanelShell from '@theme/primitives/PanelShell.vue';
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { registerCommand } from '../shortcuts/commands';
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

// P4 C5: the placeholder is gone — this is a real tree now, mounted through the same PanelShell
// shell Studio's ProjectPanel.vue uses. `empty` is no longer hardcoded: it is "this app has no
// collections yet", which is also what gates PanelShell's own search box (F14).
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

// The fetch belongs to the panel rather than the tree: PanelShell renders #body only when it is
// non-empty, so a tree that loaded itself on mount would never load at all on a fresh install —
// no collections, no tree, no call, no collections.
onMounted(collectionsStore.initCollections);
// The header's Environments action and the active-environment select both read this; initVariables()
// is idempotent (state/variables.ts's own guard), so mounting it here as well as wherever else
// needs it is safe.
onMounted(variablesStore.initVariables);

// P22b D8: runtime-only collapse state for the two categories — a panel section is not a
// preference worth a storage round trip (ConsoleViewRuntime's own "runtime-only, never saved"
// rule). Collections starts expanded (today's only view of the tree); Environments starts
// collapsed (F11: it was behind a dialog before this, so a user has never had it open by default).
const collectionsExpanded = ref(true);
function onSearch(value: string): void {
  collectionsStore.search = value;
}

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
  <PanelShell :empty="empty" :search="collectionsStore.search" @update:search="onSearch">
    <template #title>
      <span>Collections</span>
    </template>
    <template #actions>
      <IconButton
        icon="add"
        aria-label="New request"
        v-tooltip="'New request'"
        data-testid="new-request"
        @click="openApiRequestTab"
      />
      <IconButton
        icon="new-folder"
        aria-label="New collection"
        v-tooltip="'New collection'"
        data-testid="new-collection"
        @click="onNewCollection"
      />
      <!-- P28 D18: the Postman import moved to the menu bar (App → Import Postman Collection…)
           and to the command palette entry it already had. D11's spinner-on-the-action reasoning
           went with the button; collectionsState.busy still gates re-entry inside
           importCollection() itself, so a second import cannot start while one is running. -->
      <!-- P5 D3/D11: the environments dialog's own entry point — environments exist
           independently of collections, so this lives in the panel's header, not the tree. -->
      <IconButton
        icon="server-environment"
        aria-label="Environments"
        v-tooltip="'Environments…'"
        data-testid="api-environments"
        @click="onEnvironments"
      />
    </template>
    <template #body>
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
    </template>
    <template #empty>
      <ImportReportStrip />
      <EmptyState icon="folder-library" label="No collections yet">
        <span class="p-xs dim side-empty-text"
          >Create one from the <b>+</b> above, or import a Postman collection.</span
        >
      </EmptyState>
    </template>
  </PanelShell>
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
  @apply flex shrink-0 cursor-pointer items-center gap-[var(--kira-s-2)] px-[var(--kira-s-3)] text-muted uppercase tracking-[0.05em] h-[var(--kira-control-h)] text-[length:var(--kira-t-sm)];
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
</style>
