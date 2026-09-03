<script setup lang="ts">
/**
 * §6.2's toolbar: `[repo ▾] [branch ▾] │ ⟳ │ Fetch Pull Push │ Stash ▾ │ Search […] ⚙`. P4 builds
 * only the first and third groups — the branch picker needs P6's ref list, the four operation
 * buttons need P7/P8, search needs P10, and none of those are in this phase's scope table. The
 * missing groups are not stubbed with disabled placeholders; they are simply absent until their
 * own phase adds them, so this toolbar renders exactly what P4 owns and nothing pretending to be
 * more finished than it is.
 *
 * Metrics match the panel title bar's, not an invented toolbar height (§6.1): 35px
 * (`--kv-toolbar-height`), square corners (`--kv-radius: 0`), no shadow.
 */
import { ref } from "vue";
import type { GraphViewState } from "../state/graphView.ts";
import type { RepoState } from "../state/repo.ts";
import RefreshButton from "./RefreshButton.vue";
import RepoPicker from "./RepoPicker.vue";

defineProps<{ graphView: GraphViewState; repoState: RepoState }>();
const emit = defineEmits<(event: "repo-opened", repoId: string) => void>();

const refreshButtonRef = ref<InstanceType<typeof RefreshButton> | null>(null);

// Forwarded so App.vue can drive the same refresh RefreshButton's own click uses from
// CommitGrid.vue's "refresh" emit (F5/Ctrl+R while the grid has focus) — one implementation,
// reached from two inputs, rather than App.vue reimplementing RefreshButton's own idempotency
// and hasPendingChange bookkeeping a second time.
defineExpose({ refresh: () => refreshButtonRef.value?.refresh() });
</script>

<template>
  <!-- W14 (axe `aria-allowed-role`): `role="toolbar"` is not among the roles the ARIA spec
       allows overriding a `<header>`'s own implicit "banner" role with — a plain `<div>` carries
       no implicit role of its own to conflict with the explicit one, which is all this element
       ever wanted (§6.2's own layout, not a page banner). -->
  <div class="kv-toolbar" role="toolbar" aria-label="Kira Version toolbar">
    <RepoPicker :repo-state="repoState" @repo-opened="(repoId) => emit('repo-opened', repoId)" />
    <span class="kv-toolbar-separator" aria-hidden="true"></span>
    <RefreshButton ref="refreshButtonRef" :graph-view="graphView" :repo-state="repoState" />
  </div>
</template>

<style>
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

.kv-toolbar-separator {
  width: 1px;
  align-self: stretch;
  margin: var(--kv-space-2) 0;
  background-color: var(--kv-toolbar-border);
}
</style>
