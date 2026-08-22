import { createApp } from 'vue';
import App from './App.vue';
import { initCacheStats } from './state/cacheStats';
import { hydrateConnections } from './state/connections';
import { hydrateOps } from './state/ops';
import { hydrateTabs } from './state/tabs';
import './theme/base.css';
import { hydrateSettings } from './state/settings';
import { hydrateLayout } from './workbench/state/layout';

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
