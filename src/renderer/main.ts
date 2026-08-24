import type { CacheStats, CountRequestWire, CountResponse } from '@shared/protocol/data-ops';
import { createApp } from 'vue';
import App from './App.vue';
import { data } from './bridge/data';
import { knownConnectionIds } from './project/state/tree';
import { initCacheStats } from './state/cacheStats';
import { hydrateConnections } from './state/connections';
import { hydrateOps } from './state/ops';
import { hydrateTabs } from './state/tabs';
import './theme/base.css';
import { hydrateSettings } from './state/settings';
import { totalRetainedBytes as consoleRetainedBytes } from './views/console/resultPages';
import { totalRetainedBytes as documentRetainedBytes } from './views/documents/docPage';
import { totalRetainedBytes } from './views/grid/page';
import { totalRetainedBytes as keyValueRetainedBytes } from './views/keyvalue/kvPage';
import { totalRetainedBytes as streamRetainedBytes } from './views/stream/streamPage';
import { hydrateLayout } from './workbench/state/layout';
import { vTooltip } from './workbench/state/tooltip';

declare global {
  interface Window {
    /**
     * Playwright-only hook (tests/ui/perf.spec.ts) — the exact §2.2 retained-bytes figure, so
     * "closing a tab frees its page immediately" can be asserted deterministically instead of
     * read off a flaky RSS sample. Grid-only, kept as-is so that assertion's meaning is unchanged.
     */
    __kiraGridRetainedBytes?: () => number;
    /** D5: the sum across all five page stores — what §2.2's symmetry assertion should see. */
    __kiraRetainedBytes?: () => number;
    /**
     * Playwright-only hooks (tests/ui/leaks.spec.ts) — the same `data` bridge and tree-state
     * accessor the app itself uses, exposed so a leak regression test can drive many distinct
     * count() requests and read L3's entry count / the tree's live connection ids directly,
     * instead of round-tripping every one of them through real UI clicks.
     */
    __kiraCount?: (req: CountRequestWire) => Promise<CountResponse>;
    __kiraCacheStats?: () => Promise<CacheStats>;
    __kiraTreeConnectionIds?: () => string[];
  }
}
window.__kiraGridRetainedBytes = totalRetainedBytes;
window.__kiraRetainedBytes = () =>
  totalRetainedBytes() +
  consoleRetainedBytes() +
  documentRetainedBytes() +
  keyValueRetainedBytes() +
  streamRetainedBytes();
window.__kiraCount = data.count;
window.__kiraCacheStats = data.cacheStats;
window.__kiraTreeConnectionIds = () => Array.from(knownConnectionIds());

async function bootstrap(): Promise<void> {
  initCacheStats();
  await Promise.all([
    hydrateLayout(),
    hydrateSettings(),
    hydrateConnections(),
    hydrateOps(),
    hydrateTabs(),
  ]);
  createApp(App).directive('tooltip', vTooltip).mount('#app');
}

void bootstrap();
