/**
 * The extension-host half of the postMessage channel (P3 W10) — the "~ten lines of channel
 * adapter" `packages/ipc/src/rpc.ts` leaves to each host. `webview.postMessage` takes no
 * transfer list (V1 exists to confirm this): `ArrayBuffer`s crossing this boundary are
 * structured-*cloned*, not transferred, so `transfer` is accepted for interface parity with
 * `MessageChannelLike` and otherwise ignored — the design does not change, W17 measures the
 * cost rather than assuming it away.
 *
 * The webview's own half (running inside the iframe, never importing `vscode`) is
 * `src/webview/main.ts` — a separate, browser-only entry point built and loaded like any other
 * host's UI bootstrap (`apps/harness/src/main.ts`'s precedent), implementing this same
 * `MessageChannelLike` shape against `window.addEventListener("message")` /
 * `acquireVsCodeApi().postMessage`.
 */
import type { MessageChannelLike } from "@kira-version/ipc";
import type * as vscode from "vscode";

export function createWebviewChannel(webview: vscode.Webview): MessageChannelLike {
  return {
    post(message): void {
      void webview.postMessage(message);
    },
    onMessage(handler): () => void {
      const subscription = webview.onDidReceiveMessage((message) => handler(message));
      return () => subscription.dispose();
    },
    close(): void {
      // Nothing owned beyond the onDidReceiveMessage subscription above, which callers already
      // drop via the returned unsubscribe function — the webview itself is torn down by
      // panelView.ts's onDidDispose, not by this channel.
    },
  };
}
