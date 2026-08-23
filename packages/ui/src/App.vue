<script setup lang="ts">
import type { GitStatus, HeadState, HostKind, Transport } from "@kira-version/ipc";
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from "vue";
import { BridgeClient } from "./bridge/client.ts";
import { ACTION_ICONS } from "./icons/index.ts";
import { GraphViewState } from "./state/graphView.ts";
import { RepoState } from "./state/repo.ts";
import { SettingsState } from "./state/settings.ts";
import type { ViewStateStore } from "./state/viewState.ts";

const props = defineProps<{
  transport: Transport;
  viewState: ViewStateStore;
  host: HostKind;
}>();

const bridge = new BridgeClient(props.transport);
const connectionState = bridge.connectionState;
const graphView = new GraphViewState(bridge);

const detailOpen = ref(true);
// Assigned once `bootstrap()`'s `app.init` round trip resolves — a `shallowRef` (not a plain
// `let`) specifically so the live-data strip below re-renders the moment each becomes ready,
// not just when a field inside it later changes.
const repoState = shallowRef<RepoState | undefined>(undefined);
const settingsState = shallowRef<SettingsState | undefined>(undefined);

function formatGitStatus(status: GitStatus | undefined): string {
  if (!status) return "…";
  switch (status.kind) {
    case "ok":
      return `${status.path} (${status.version})`;
    case "notFound":
      return "not found";
    case "tooOld":
      return `too old (${status.detected} < ${status.required})`;
    case "unusable":
      return `unusable: ${status.reason}`;
  }
}

function formatHead(head: HeadState | undefined): string {
  if (!head) return "";
  switch (head.kind) {
    case "branch":
      return head.name;
    case "detached":
      return head.sha.slice(0, 7);
    case "unborn":
      return `${head.name} (unborn)`;
  }
}

const gitStatusText = computed(() => formatGitStatus(repoState.value?.git.value));
const repoRootText = computed(() => repoState.value?.activeRepo.value?.root ?? "");
const headRefText = computed(() => formatHead(repoState.value?.activeRepo.value?.head));
const firstSha = computed(() =>
  graphView.loadedRows.value > 0 ? graphView.store.shortShaAt(0) : "",
);
const firstSubject = computed(() =>
  graphView.loadedRows.value > 0 ? graphView.store.subjectAt(0) : "",
);
const lastChangeText = computed(() => {
  const change = repoState.value?.lastChange.value;
  return change ? `${change.kind} (${change.count})` : "none";
});

onMounted(() => {
  // requestAnimationFrame so the mark lands after the browser has actually painted this
  // frame, not merely after Vue's synchronous mount work.
  requestAnimationFrame(() => {
    performance.mark("kira:first-paint");
    performance.measure("kira:first-paint", undefined, "kira:first-paint");
    // P0 has no real graph layout (§5.2 lands from P4) — this marks the placeholder shell
    // as "laid out" so the perf harness has a real third point to measure from day one.
    performance.mark("kira:layout-complete");
    performance.measure("kira:layout-complete", undefined, "kira:layout-complete");
  });

  void bootstrap();
});

async function bootstrap(): Promise<void> {
  const init = await bridge.init();
  settingsState.value = new SettingsState(bridge, init.settings);
  const repo = new RepoState(bridge, init.git);
  repoState.value = repo;

  const persisted = props.viewState.read();
  if (persisted) {
    detailOpen.value = persisted.detailOpen;
    if (persisted.repoId) {
      const outcome = await repo.open(persisted.repoId);
      // §5.4: a freshly (re)mounted GraphViewState's own `loadedRows` starts at 0, so the
      // default `resumeThroughRow` asks the host to replay every row it still has cached —
      // that single round trip is the whole of "rehydrates without re-running git".
      if (outcome.kind === "ok") await graphView.openStream(outcome.repo.repoId);
    }
  }

  watch(
    [() => repoState.value?.activeRepo.value?.repoId ?? null, graphView.loadedRows, detailOpen],
    ([repoId, loadedRows, isDetailOpen]) => {
      props.viewState.write({
        version: 1,
        repoId,
        loadedRows,
        detailOpen: isDetailOpen,
      });
    },
  );
}

onBeforeUnmount(() => {
  graphView.dispose();
  repoState.value?.dispose();
  settingsState.value?.dispose();
  bridge.dispose();
});
</script>

<template>
  <div class="kv-app" :data-connection-state="connectionState">
    <header class="kv-toolbar" role="toolbar" aria-label="Kira Version toolbar">
      <button type="button" class="kv-icon-button" aria-label="Refresh">
        <span class="codicon" :class="ACTION_ICONS.refresh" aria-hidden="true"></span>
      </button>
      <button type="button" class="kv-icon-button" aria-label="Search">
        <span class="codicon" :class="ACTION_ICONS.search" aria-hidden="true"></span>
      </button>
      <span class="kv-connection-state" data-testid="connection-state">{{ connectionState }}</span>
    </header>

    <!--
      A single row of labelled values, replaced by P4's real list and toolbar (P3 W9). It
      exists so the harness and Playwright have something real to assert on before there is a
      real graph — every value below reads straight from `state/`, nothing is invented here.
    -->
    <div class="kv-live-strip" role="status" aria-label="Live data">
      <span class="kv-strip-field">
        <span class="kv-strip-label">git</span>
        <span data-testid="git-status">{{ gitStatusText }}</span>
      </span>
      <span class="kv-strip-field">
        <span class="kv-strip-label">repo</span>
        <span data-testid="repo-root">{{ repoRootText }}</span>
      </span>
      <span class="kv-strip-field">
        <span class="kv-strip-label">head</span>
        <span data-testid="head-ref">{{ headRefText }}</span>
      </span>
      <span class="kv-strip-field">
        <span class="kv-strip-label">commits</span>
        <span data-testid="commit-count">{{ graphView.loadedRows.value }}</span>
      </span>
      <span class="kv-strip-field">
        <span class="kv-strip-label">remaining</span>
        <span data-testid="remaining-count">{{ graphView.remaining.value }}</span>
      </span>
      <span class="kv-strip-field">
        <span class="kv-strip-label">first sha</span>
        <span data-testid="first-sha">{{ firstSha }}</span>
      </span>
      <span class="kv-strip-field">
        <span class="kv-strip-label">first subject</span>
        <span data-testid="first-subject">{{ firstSubject }}</span>
      </span>
      <span class="kv-strip-field">
        <span class="kv-strip-label">source</span>
        <span data-testid="chunk-source">{{ graphView.lastChunkSource.value ?? "" }}</span>
      </span>
      <span class="kv-strip-field">
        <span class="kv-strip-label">last change</span>
        <span data-testid="last-change">{{ lastChangeText }}</span>
      </span>
    </div>

    <main class="kv-body">
      <section class="kv-graph-region" data-testid="graph-region" aria-label="Commit graph"></section>
      <aside
        v-if="detailOpen"
        class="kv-detail-region"
        data-testid="detail-region"
        aria-label="Commit detail"
      ></aside>
    </main>
  </div>
</template>

<style>
.kv-app {
  display: flex;
  flex-direction: column;
  height: 100%;
  width: 100%;
  background-color: var(--kv-app-bg);
  color: var(--kv-app-fg);
  font-family: var(--kv-font-family);
  font-size: var(--kv-font-size);
}

.kv-toolbar {
  display: flex;
  align-items: center;
  gap: var(--kv-space-2);
  height: var(--kv-toolbar-height);
  padding: 0 var(--kv-space-3);
  background-color: var(--kv-toolbar-bg);
  border-bottom: 1px solid var(--kv-toolbar-border);
  flex-shrink: 0;
}

.kv-icon-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  padding: 0;
  border: none;
  border-radius: var(--kv-radius);
  background: transparent;
  color: var(--kv-app-fg);
  cursor: pointer;
}

.kv-icon-button:hover {
  background-color: var(--kv-row-hover-bg);
}

.kv-icon-button:focus-visible {
  outline: 1px solid var(--kv-focus-border);
  outline-offset: -1px;
}

.kv-connection-state {
  margin-left: auto;
  font-size: var(--kv-mono-font-size);
  color: var(--kv-app-fg);
  opacity: 0.7;
}

.kv-live-strip {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--kv-space-4);
  padding: var(--kv-space-2) var(--kv-space-3);
  background-color: var(--kv-toolbar-bg);
  border-bottom: 1px solid var(--kv-toolbar-border);
  font-size: var(--kv-mono-font-size);
  flex-shrink: 0;
}

.kv-strip-field {
  display: inline-flex;
  align-items: baseline;
  gap: var(--kv-space-1);
  white-space: nowrap;
}

.kv-strip-label {
  opacity: 0.6;
}

.kv-body {
  display: flex;
  flex: 1;
  min-height: 0;
}

.kv-graph-region {
  flex: 1;
  min-width: 0;
  background-color: var(--kv-panel-bg);
}

.kv-detail-region {
  width: 380px;
  flex-shrink: 0;
  border-left: 1px solid var(--kv-panel-border);
  background-color: var(--kv-panel-bg);
}
</style>
