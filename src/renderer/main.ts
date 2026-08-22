import { createApp } from 'vue';
import App from './App.vue';
import { initCacheStats } from './state/cacheStats';
import { hydrateConnections } from './state/connections';
import { hydrateOps } from './state/ops';
import { hydrateTabs } from './state/tabs';
import './theme/base.css';
import { hydrateSettings } from './state/settings';
import { totalRetainedBytes } from './views/grid/page';
import { hydrateLayout } from './workbench/state/layout';

declare global {
  interface Window {
    /**
     * Playwright-only hook (tests/ui/perf.spec.ts) — the exact §2.2 retained-bytes figure, so
     * "closing a tab frees its page immediately" can be asserted deterministically instead of
     * read off a flaky RSS sample.
     */
    __kiraGridRetainedBytes?: () => number;
  }
}
window.__kiraGridRetainedBytes = totalRetainedBytes;

async function bootstrap(): Promise<void> {
  initCacheStats();
  await Promise.all([
    hydrateLayout(),
    hydrateSettings(),
    hydrateConnections(),
    hydrateOps(),
    hydrateTabs(),
  ]);
  createApp(App).mount('#app');
}

void bootstrap();
