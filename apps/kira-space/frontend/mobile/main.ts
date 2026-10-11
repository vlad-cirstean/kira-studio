import { adeReaderKey } from '@ade/reader';
import { repoNamesKey } from '@ade/readQueries';
import { installAdeReadSignals } from '@ade/readSignals';
import { VueQueryPlugin } from '@tanstack/vue-query';
import { i18n } from '@theme/i18n';
import { createQueryClient } from '@workbench/state/queryClient';
import { createPinia } from 'pinia';
import { createApp } from 'vue';
import App from './App.vue';
import { httpAdeReader } from './api/adeReader';
import { onChannel, sseSignalSource } from './api/events';
import { setUnauthorizedHandler } from './api/http';
import { router } from './router';
import { useAuthStore } from './state/auth';
import './styles.css';

// Reads are push-invalidated (staleTime Infinity); a reconnect or a refocus refetches the rest.
const queryClient = createQueryClient({ remote: true });
installAdeReadSignals(queryClient, sseSignalSource);
onChannel('kira:adetask:repos', () => {
  void queryClient.invalidateQueries({ queryKey: repoNamesKey, exact: true });
});

const pinia = createPinia();
const app = createApp(App);
app.use(i18n);
app.use(pinia);
app.use(VueQueryPlugin, { queryClient });
app.provide(adeReaderKey, httpAdeReader);
setUnauthorizedHandler((code) => useAuthStore(pinia).onUnauthorized(code));
app.use(router);
app.mount('#app');
