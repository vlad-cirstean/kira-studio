<script setup lang="ts">
import CodiconIcon from '@theme/CodiconIcon.vue';
import { Button } from '@theme/components/ui/button';
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
    class="flex flex-1 min-h-0 items-center justify-center overflow-auto p-4"
    data-testid="api-start"
  >
    <div class="flex w-[420px] max-w-full flex-col items-center gap-2 text-center">
      <span class="dim"><CodiconIcon name="globe" :size="32" /></span>
      <div class="tracking-normal text-fg text-kira-xl">No request open</div>
      <div class="muted leading-normal text-kira-md">
        Send a request and see its response here.
      </div>
      <div class="flex flex-wrap items-center justify-center gap-1">
        <Button variant="dialog-primary" size="kira-lg" data-testid="new-request-start" @click="openApiRequestTab">
          <CodiconIcon name="add" :size="13" />
          New request
        </Button>
      </div>
      <div class="flex flex-wrap items-center justify-center gap-1">
        <Button variant="dialog" size="kira-lg" data-testid="new-grpc-request-start" @click="openGrpcRequestTab">
          <CodiconIcon name="symbol-interface" :size="13" />
          New gRPC request
        </Button>
        <Button variant="dialog" size="kira-lg" data-testid="import-collection-start" @click="onImport">
          <CodiconIcon name="cloud-download" :size="13" />
          Import collection…
        </Button>
        <Button variant="dialog" size="kira-lg" data-testid="import-curl-start" @click="onImportCurl">
          <CodiconIcon name="terminal" :size="13" />
          Import from curl…
        </Button>
      </div>
    </div>
  </div>
</template>
