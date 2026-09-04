import { InMemoryViewStateStore, mount } from '@kira/git-ui';
import { createHarnessTransport } from './mockTransport';

/**
 * D5/OQ-1's resolved decision: reachable at `/git-dev.html?scenario=<name>` — the existing
 * build:test bundle plus a query param, not a second Vite app. Also F3's own dev-only mount point
 * (unrelated to a scenario's own content): any scenario reaching git-ui's App.vue is what proves
 * the module worker loads under this app's real CSP, which is how that question got answered in
 * the first place (see the C7 commit).
 */
const scenario = new URLSearchParams(location.search).get('scenario') ?? 'no-repository';
const container = document.getElementById('app');
if (container) {
  mount(container, {
    transport: createHarnessTransport(scenario),
    viewState: new InMemoryViewStateStore(),
    host: 'harness',
  });
}
