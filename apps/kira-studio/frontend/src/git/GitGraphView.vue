<script setup lang="ts">
/**
 * P1 C7/C9: the whole of this app's git-ui host integration. mount()'s three-argument surface
 * (packages/git-ui/src/main.ts) is the entire seam a host implements against — a Transport, a
 * ViewStateStore, and a HostKind — so this component is deliberately thin: it owns none of Git
 * mode's actual UI, only the mount/unmount lifecycle and which concrete implementations of those
 * three arguments this app supplies.
 */
import { type MountHandle, mount } from '@kira/git-ui';
import type { TabRecord } from '@shared/domain/tabs';
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { createGitTransport } from './transport';
import { createTabViewStateStore } from './viewStateStore';

const props = defineProps<{ tab: TabRecord }>();

const container = ref<HTMLDivElement | null>(null);
let handle: MountHandle | undefined;

onMounted(() => {
  if (!container.value) return;
  handle = mount(container.value, {
    transport: createGitTransport(),
    // D7: backed by this tab's own persisted TabRecord.state (viewStateStore.ts) — a mode
    // switch unmounts and remounts this component, and this is what restores scroll/selection/
    // column widths rather than resetting them.
    viewState: createTabViewStateStore(props.tab.id),
    host: 'kira-studio',
  });
});

onBeforeUnmount(() => {
  handle?.unmount();
  handle = undefined;
});
</script>

<template>
  <div ref="container" class="git-graph-view" data-testid="git-graph-view"></div>
</template>

<style scoped>
.git-graph-view {
  flex: 1;
  min-height: 0;
  min-width: 0;
  display: flex;
}
</style>
