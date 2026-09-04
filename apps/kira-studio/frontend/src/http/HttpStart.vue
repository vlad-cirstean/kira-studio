<script setup lang="ts">
import { openHttpRequestTab } from '../state/tabs';
import CodiconIcon from '../theme/CodiconIcon.vue';
import { importCollection } from './state/collections';
import { openImportCurlDialog } from './state/curl';

// D13: the mode's front door — StudioStart.vue's own first-run shape verbatim (mark, title, one
// line of copy, one p-dlgbtn primary button), the same `http/ -> state/` edge
// CollectionsPanel.vue's own New request action uses (D7).
//
// P4 C9 adds a secondary action beside it: on a first run there is nothing to open, and importing
// an existing collection is the other thing someone arriving here wants to do. The primary
// button's `new-request-start` testid is untouched — two existing specs click it (F11).
function onImport(): void {
  void importCollection();
}

// P7 D12: a third front-door button — pasting a curl command is the other common way someone
// arrives with a request already in hand.
function onImportCurl(): void {
  openImportCurlDialog();
}
</script>

<template>
  <div class="start" data-testid="http-start">
    <div class="start-inner">
      <span class="start-mark dim"><CodiconIcon name="globe" :size="32" /></span>
      <div class="start-title">No request open</div>
      <div class="start-sub muted">Send an HTTP request and see its response here.</div>
      <div class="start-actions">
        <button type="button" class="p-dlgbtn primary" data-testid="new-request-start" @click="openHttpRequestTab">
          <span class="icon-box"><CodiconIcon name="add" :size="13" /></span>
          New request
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

<style scoped>
.start {
  flex: 1;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--kira-s-6);
}

.start-inner {
  width: 360px;
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: var(--kira-s-4);
}

.start-title {
  font-size: var(--kira-t-xl);
  color: var(--kira-fg);
  letter-spacing: -0.01em;
}

.start-sub {
  font-size: var(--kira-t-md);
  line-height: 1.5;
}

.start-actions {
  display: flex;
  gap: var(--kira-s-2);
  align-items: center;
}
</style>
