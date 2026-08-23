/**
 * The webview-side bootstrap (P3 W10) — this package's *other* entry point, built and loaded
 * exactly like `apps/harness/src/main.ts`, except it runs inside a VS Code webview iframe
 * rather than a plain browser tab. Never imports `vscode` (that module exists only in the
 * extension host); the one VS Code-specific thing it touches is `acquireVsCodeApi()`, the
 * function VS Code injects into every webview's global scope for exactly this purpose.
 *
 * `html.ts` is what actually loads this file (via a built, `asWebviewUri`-rewritten `<script
 * type="module">` tag) and hands it nothing at runtime beyond the DOM — `#kira-bootstrap`'s
 * JSON island is this file's only input, read below.
 */
import type { MessageChannelLike } from "@kira-version/ipc";
import { createRpcClient } from "@kira-version/ipc";
import type { ViewStateStore } from "@kira-version/ui";
import { mount, type PersistedViewState, parsePersistedViewState } from "@kira-version/ui";

declare function acquireVsCodeApi<T = unknown>(): {
  getState(): T | undefined;
  setState(state: T): void;
  postMessage(message: unknown): void;
};

interface Bootstrap {
  readonly host: "vscode";
  readonly contractVersion: number;
}

function readBootstrap(): Bootstrap {
  const el = document.getElementById("kira-bootstrap");
  if (!el?.textContent) throw new Error("webview: #kira-bootstrap script tag is missing");
  return JSON.parse(el.textContent) as Bootstrap;
}

/** §2.1's `getState`/`setState` — the mechanism a hidden/recreated webview view survives
 *  through, since `retainContextWhenHidden` is deliberately left off (panelView.ts). */
class VsCodeApiViewStateStore implements ViewStateStore {
  readonly #api: ReturnType<typeof acquireVsCodeApi<unknown>>;

  constructor(api: ReturnType<typeof acquireVsCodeApi<unknown>>) {
    this.#api = api;
  }

  read(): PersistedViewState | null {
    return parsePersistedViewState(this.#api.getState());
  }

  write(state: PersistedViewState): void {
    this.#api.setState(state);
  }
}

function createVsCodeChannel(
  api: ReturnType<typeof acquireVsCodeApi<unknown>>,
): MessageChannelLike {
  return {
    post(message): void {
      api.postMessage(message);
    },
    onMessage(handler): () => void {
      const listener = (event: MessageEvent): void => handler(event.data);
      window.addEventListener("message", listener);
      return () => window.removeEventListener("message", listener);
    },
    close(): void {},
  };
}

const container = document.getElementById("app");
if (!container) throw new Error("webview: #app container missing from html.ts's document");

const vscodeApi = acquireVsCodeApi();
const bootstrap = readBootstrap();

mount(container, {
  transport: createRpcClient(createVsCodeChannel(vscodeApi)),
  viewState: new VsCodeApiViewStateStore(vscodeApi),
  host: bootstrap.host,
});
