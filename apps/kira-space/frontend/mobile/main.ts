import { registerSW } from 'virtual:pwa-register';
import { adeReaderKey } from '@ade/reader';
import { repoNamesKey } from '@ade/readQueries';
import { installAdeReadSignals } from '@ade/readSignals';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
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
const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: true, refetchOnReconnect: true },
  },
});
installAdeReadSignals(queryClient, sseSignalSource);
onChannel('kira:adetask:repos', () => {
  void queryClient.invalidateQueries({ queryKey: repoNamesKey, exact: true });
});

const pinia = createPinia();
const app = createApp(App);
app.use(pinia);
app.use(VueQueryPlugin, { queryClient });
app.provide(adeReaderKey, httpAdeReader);
setUnauthorizedHandler((code) => useAuthStore(pinia).onUnauthorized(code));
app.use(router);
app.mount('#app');
registerSW({ immediate: true });
