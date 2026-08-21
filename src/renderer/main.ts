import { createApp } from 'vue';
import App from './App.vue';
import './theme/base.css';
import { hydrateConnections } from './project/state/connections';
import { hydrateTree } from './project/state/tree';
import { hydrateLayout } from './workbench/state/layout';
import { hydrateOps } from './workbench/state/ops';
import { hydrateSettings } from './workbench/state/settings';

async function bootstrap(): Promise<void> {
  await Promise.all([hydrateLayout(), hydrateSettings(), hydrateConnections()]);
  await hydrateTree();
  await hydrateOps();
  createApp(App).mount('#app');
}

void bootstrap();
