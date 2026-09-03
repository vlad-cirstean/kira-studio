/**
 * The Electron renderer's bootstrap (P3 W11) — the same shape as `host-vscode/src/webview/
 * main.ts`, minus the bootstrap JSON island: `renderer/index.html` is a static file Vite
 * processes once at build time (W13), not regenerated per-load the way VS Code's `html.ts`
 * rebuilds its document with a fresh nonce and CSP every time the panel opens — so `host` is a
 * compile-time literal here rather than something read out of the document. `window.kiraBridge`
 * is the surface `preload/index.ts` exposes over `contextBridge`; nothing here imports
 * `electron` (that module exists only in the main and preload contexts).
 *
 * §3.4/W11: nothing injects `--vscode-*` variables or a theme-kind body class the way a real VS
 * Code webview host does, so this file is the one place that stamps `vscode-dark` /
 * `vscode-light` / `vscode-high-contrast` / `vscode-high-contrast-light` onto `<body>` — the
 * same signal `vscode-tokens.css` already keys off, so no component changes for either host.
 * There is no fourth `contextBridge` member for this (W11's `kiraBridge` is deliberately exactly
 * three members) and no dedicated `theme.changed` RPC event (§3.5's contract is sealed at W1), so
 * the resolved kind is derived here, independently of the Vue app, from two things already on
 * hand: the `kiraVersion.theme.kind` override, read via one extra `app.init` call over the same
 * transport `mount()` gets and kept current via `settings.changed`; and, when the override is
 * `"system"`, `prefers-color-scheme`/`prefers-contrast`/`forced-colors` media queries, which
 * Chromium resolves from the same OS signals `ports/theme.ts`'s `nativeTheme` reads on the main
 * side. Applying the class before `mount()` (rather than reacting to it afterward) avoids a
 * flash of the wrong palette.
 */
import type { MessageChannelLike, SettingsSnapshot } from "@kira-version/ipc";
import { createRpcClient } from "@kira-version/ipc";
import {
  DEFAULT_COLUMN_WIDTHS,
  DEFAULT_DETAIL_WIDTH,
  InMemoryViewStateStore,
  mount,
} from "@kira-version/ui";

interface KiraBridge {
  onPort(cb: () => void): void;
  postMessage(message: unknown, transfer?: readonly ArrayBuffer[]): void;
  onMessage(cb: (message: unknown) => void): () => void;
}

declare global {
  interface Window {
    readonly kiraBridge: KiraBridge;
  }
}

function createElectronChannel(bridge: KiraBridge): MessageChannelLike {
  return {
    post(message, transfer): void {
      bridge.postMessage(message, transfer);
    },
    onMessage(handler): () => void {
      return bridge.onMessage(handler);
    },
    close(): void {},
  };
}

type ResolvedThemeKind = "dark" | "light" | "high-contrast" | "high-contrast-light";

const THEME_BODY_CLASSES: Record<ResolvedThemeKind, string> = {
  dark: "vscode-dark",
  light: "vscode-light",
  "high-contrast": "vscode-high-contrast",
  "high-contrast-light": "vscode-high-contrast-light",
};

function systemPrefersDark(): boolean {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function systemPrefersHighContrast(): boolean {
  return (
    window.matchMedia("(forced-colors: active)").matches ||
    window.matchMedia("(prefers-contrast: more)").matches
  );
}

function resolveThemeKind(override: SettingsSnapshot["kiraVersion.theme.kind"]): ResolvedThemeKind {
  if (override !== "system") return override;
  const dark = systemPrefersDark();
  return systemPrefersHighContrast()
    ? dark
      ? "high-contrast"
      : "high-contrast-light"
    : dark
      ? "dark"
      : "light";
}

function applyThemeClass(kind: ResolvedThemeKind): void {
  document.body.classList.remove(...Object.values(THEME_BODY_CLASSES));
  document.body.classList.add(THEME_BODY_CLASSES[kind]);
}

/** Wires the body class to `override` now and to every future change — the setting changing,
 *  or (while the override is `"system"`) the OS-level signals changing underneath it. */
function watchThemeKind(
  transport: ReturnType<typeof createRpcClient>,
  initial: SettingsSnapshot,
): void {
  let override = initial["kiraVersion.theme.kind"];
  const reapply = (): void => applyThemeClass(resolveThemeKind(override));

  reapply();
  transport.on("settings.changed", (event) => {
    override = event.settings["kiraVersion.theme.kind"];
    reapply();
  });
  for (const query of [
    "(prefers-color-scheme: dark)",
    "(forced-colors: active)",
    "(prefers-contrast: more)",
  ]) {
    window.matchMedia(query).addEventListener("change", reapply);
  }
}

const container = document.getElementById("app");
if (!container) throw new Error("renderer: #app container missing from renderer/index.html");

window.kiraBridge.onPort(async () => {
  const transport = createRpcClient(createElectronChannel(window.kiraBridge));
  const { settings } = await transport.request("app.init", {});
  watchThemeKind(transport, settings);

  // P3 has no scenario where this window is unmounted and remounted within a session — a
  // `BrowserWindow` is not hidden/recreated the way a VS Code webview is — so there is
  // nothing real to rehydrate yet. A `Storage`-backed store (docs/plans/P3.md's W9 text:
  // "an Electron one over the Storage port through the bridge") is the natural next step
  // once a reload or relaunch flow gives it something to prove; mirrors host-vscode's own
  // Storage-port omission (W10).
  const viewState = new InMemoryViewStateStore();

  // `main/index.ts`'s `KIRA_REPO` dev/e2e hook (W15): when set, main appends `?repo=<path>` to
  // this static HTML's own URL via `loadFile`'s `query` option. Pre-seeding the same
  // `PersistedViewState` shape the harness's `main.ts` uses exploits `App.vue`'s existing
  // `bootstrap()` logic to auto-open it — there is no repo-picker UI yet (P4+) to do this any
  // other way.
  const initialRepoPath = new URLSearchParams(location.search).get("repo");
  if (initialRepoPath) {
    viewState.setRaw({
      version: 2,
      repoId: initialRepoPath,
      loadedRows: 0,
      detailOpen: true,
      scrollRow: 0,
      selectedSha: null,
      columnWidths: DEFAULT_COLUMN_WIDTHS,
      dateFormat: "relative",
      detailWidth: DEFAULT_DETAIL_WIDTH,
    });
  }

  mount(container, { transport, viewState, host: "electron" });
});
