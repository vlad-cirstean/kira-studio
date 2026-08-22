import { createApp } from 'vue';
import App from './App.vue';
import './theme/base.css';
import { hydrateConnections } from './project/state/connections';
import { hydrateTree } from './project/state/tree';
import { initDataScheduler } from './workbench/state/data';
import { hydrateLayout } from './workbench/state/layout';
import { hydrateOps } from './workbench/state/ops';
import { hydrateSettings } from './workbench/state/settings';
import { hydrateTabs } from './workbench/state/tabs';

async function bootstrap(): Promise<void> {
  await Promise.all([hydrateLayout(), hydrateSettings(), hydrateConnections()]);
  await hydrateTree();
  await hydrateOps();
  await hydrateTabs();
  initDataScheduler();
  createApp(App).mount('#app');
}

void bootstrap();
