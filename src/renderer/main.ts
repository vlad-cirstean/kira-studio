import { createApp } from 'vue';
import App from './App.vue';
import { hydrateConnections } from './state/connections';
import { hydrateOps } from './state/ops';
import { hydrateTabs } from './state/tabs';
import './theme/base.css';
import { hydrateLayout } from './workbench/state/layout';
import { hydrateSettings } from './workbench/state/settings';

async function bootstrap(): Promise<void> {
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
