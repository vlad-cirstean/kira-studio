import type { Transport } from '@kira/git-ipc';
import { InMemoryViewStateStore, mount } from '@kira/git-ui';

/**
 * F3's own dev-only route (P1 C7): mounts git-ui against a bare stub Transport that never
 * resolves a request — this file exists solely to answer F3's question ("does the module worker
 * load under this app's real CSP?") by getting git-ui's App.vue past its first render, which is
 * where GraphViewState's default LayoutClient constructs the module worker (state/graphView.ts),
 * without needing a real Go backend behind it. Never imported by the app's real boot path
 * (main.ts) — only git-dev.html reaches this, and that page is excluded from a production build
 * (vite.config.ts's own debugHooks gate).
 */
const stubTransport: Transport = {
  request: () => new Promise(() => {}),
  on: () => () => {},
  stream: () => new Promise(() => {}),
  dispose: () => {},
};

const container = document.getElementById('app');
if (container) {
  mount(container, {
    transport: stubTransport,
    viewState: new InMemoryViewStateStore(),
    host: 'kira-studio',
  });
}
