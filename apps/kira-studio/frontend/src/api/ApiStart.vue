<script setup lang="ts">
import CodiconIcon from '@theme/CodiconIcon.vue';
import { useCollectionsStore } from './state/collections';
import { useImportCurlStore } from './state/curl';
import { openApiRequestTab, openGrpcRequestTab } from './tabs';

const collectionsStore = useCollectionsStore();
const importCurlStore = useImportCurlStore();

// D13: the mode's front door — StudioStart.vue's own first-run shape verbatim (mark, title, one
// line of copy, one p-dlgbtn primary button), the same `api/ -> state/` edge
// CollectionsPanel.vue's own New request action uses (D7).
//
// P4 C9 adds a secondary action beside it: on a first run there is nothing to open, and importing
// an existing collection is the other thing someone arriving here wants to do. The primary
// button's `new-request-start` testid is untouched — two existing specs click it (F11).
function onImport(): void {
  void collectionsStore.importCollection();
}

// P7 D12: a third front-door button — pasting a curl command is the other common way someone
// arrives with a request already in hand.
function onImportCurl(): void {
  importCurlStore.openImportCurlDialog();
}
</script>

<template>
  <div
    class="flex flex-1 min-h-0 items-center justify-center overflow-auto p-[var(--kira-s-6)]"
    data-testid="api-start"
  >
    <div class="flex w-[420px] max-w-full flex-col items-center gap-[var(--kira-s-4)] text-center">
      <span class="dim"><CodiconIcon name="globe" :size="32" /></span>
      <div class="tracking-[-0.01em] text-fg text-[length:var(--kira-t-xl)]">No request open</div>
      <div class="muted leading-normal text-[length:var(--kira-t-md)]">
        Send a request and see its response here.
      </div>
      <div class="flex flex-wrap items-center justify-center gap-[var(--kira-s-2)]">
        <button type="button" class="p-dlgbtn primary" data-testid="new-request-start" @click="openApiRequestTab">
          <span class="icon-box"><CodiconIcon name="add" :size="13" /></span>
          New request
        </button>
      </div>
      <div class="flex flex-wrap items-center justify-center gap-[var(--kira-s-2)]">
        <button type="button" class="p-dlgbtn" data-testid="new-grpc-request-start" @click="openGrpcRequestTab">
          <span class="icon-box"><CodiconIcon name="symbol-interface" :size="13" /></span>
          New gRPC request
        </button>
        <button type="button" class="p-dlgbtn" data-testid="import-collection-start" @click="onImport">
          <span class="icon-box"><CodiconIcon name="cloud-download" :size="13" /></span>
          Import collection…
        </button>
        <button type="button" class="p-dlgbtn" data-testid="import-curl-start" @click="onImportCurl">
          <span class="icon-box"><CodiconIcon name="terminal" :size="13" /></span>
          Import from curl…
        </button>
      </div>
    </div>
  </div>
</template>
