import {
  CONTRACT_VERSION,
  startWebviewServer,
  type WebviewServer,
} from '../../support/webviewServer.ts';

/**
 * G19 §4.2: the interaction tier's own bootstrap for the shared `startWebviewServer` (P107
 * I2-27 pulled the static+document serving itself into `tests/support/webviewServer.ts`, shared
 * with `tests/layout/support/server.ts`) — extended with one thing the layout tier never needed: a
 * `target` for the `/review` document's own bootstrap island, so a cold review-view mount can go
 * straight into `setTarget` (D40's cold-bootstrap arm) instead of asking `repo.list` for an active
 * repo first — `fakeReviewHost.ts`'s four scripted responses do not include one.
 */
export type InteractionServer = WebviewServer;

export interface StartInteractionServerOptions {
  /** Seeded into the `/review` document's own bootstrap island as `target` — `null` for the
   *  ordinary "no branch yet" cold boot. */
  readonly reviewTarget?: { repoId: string; branch: string } | null;
  /** G-UX (item 13): seeded into both documents' own bootstrap island as `connectionState` —
   *  defaults to `connected` (the ordinary case for every existing spec built on this fixture,
   *  whose fake host answers every request as if connected). A spec exercising the connection
   *  banner's own cold-boot seed passes a different value here. */
  readonly connectionState?: { kind: string; detail?: string };
}

export async function startInteractionServer(
  options: StartInteractionServerOptions = {},
): Promise<InteractionServer> {
  const reviewTarget = options.reviewTarget ?? null;
  const connectionState = options.connectionState ?? { kind: 'connected' as const };

  return startWebviewServer({
    bootstrap: (view) => ({
      host: 'vscode' as const,
      contractVersion: CONTRACT_VERSION,
      repo: null,
      view,
      target: view === 'review' ? reviewTarget : null,
      pendingUiAction: null,
      connectionState,
    }),
  });
}
