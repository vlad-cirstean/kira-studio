<script setup lang="ts">
import CodiconIcon from '@theme/CodiconIcon.vue';
import { Button } from '@theme/components/ui/button';
import { t } from '@theme/i18n';
import { ICON } from '@theme/icons';
import ModuleStart from '@workbench/components/ModuleStart.vue';
import { useCollectionsStore } from './state/collections';
import { useImportCurlStore } from './state/curl';
import { openApiRequestTab, openGrpcRequestTab } from './tabs';

const collectionsStore = useCollectionsStore();
const importCurlStore = useImportCurlStore();

// D13: the mode's front door — StudioStart.vue's own first-run shape verbatim (mark, title, one
// line of copy, one Button variant="dialog-primary" button), the same `api/ -> state/` edge
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
  <ModuleStart
    icon="globe"
    :title="t('studio.api.start.empty')"
    :description="t('studio.api.start.emptyHint')"
    data-testid="api-start"
  >
    <Button
      variant="dialog-primary"
      size="kira-lg"
      data-testid="new-request-start"
      @click="openApiRequestTab"
    >
      <CodiconIcon :name="ICON.add" :size="13" />
      {{ t('studio.api.common.newRequest.label') }}
    </Button>
    <template #secondary>
      <Button
        variant="dialog"
        size="kira-lg"
        data-testid="new-grpc-request-start"
        @click="openGrpcRequestTab"
      >
        <CodiconIcon name="symbol-interface" :size="13" />
        {{ t('shared.grpc.newRequest.title') }}
      </Button>
      <Button
        variant="dialog"
        size="kira-lg"
        data-testid="import-collection-start"
        @click="onImport"
      >
        <CodiconIcon name="cloud-download" :size="13" />
        {{ t('studio.api.common.importCollection.label') }}
      </Button>
      <Button variant="dialog" size="kira-lg" data-testid="import-curl-start" @click="onImportCurl">
        <CodiconIcon name="terminal" :size="13" />
        {{ t('studio.api.common.importCurl.label') }}
      </Button>
    </template>
  </ModuleStart>
</template>
