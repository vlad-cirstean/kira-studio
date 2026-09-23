import {
  CONTRACT_VERSION,
  startWebviewServer,
  type WebviewServer,
} from '../../support/webviewServer.ts';

export type LayoutServer = WebviewServer;

/**
 * A per-worker static server over `dist/ui`, serving both the built assets and the document
 * `buildWebviewDocument` produces at `/graph` and `/review` — the same document `renderHtml`
 * emits for a real webview, minus the `vscode.Webview`/`vscode.Uri` plumbing this test has no
 * host for. No transport, no backend, no repo: the app boots into its pre-connect state, which is
 * all G16's geometry assertions need. Built on the shared `startWebviewServer` (P107 I2-27),
 * which also backs `tests/interaction/support/server.ts` — this tier just supplies the plainer of
 * the two bootstrap payloads (no `target`, always `connected`).
 */
export async function startLayoutServer(): Promise<LayoutServer> {
  return startWebviewServer({
    bootstrap: (view) => ({
      host: 'vscode' as const,
      contractVersion: CONTRACT_VERSION,
      repo: null,
      view,
      target: null,
      pendingUiAction: null,
      // G-UX (item 13): see tests/interaction/support/server.ts's own copy of this field.
      connectionState: { kind: 'connected' as const },
    }),
  });
}
