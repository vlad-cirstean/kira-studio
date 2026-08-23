/**
 * The Electron main entry (P3 W11, §2.2) — `app.whenReady`, a single-instance lock, one
 * `RepoService` shared by the one window this phase creates, and a `MessageChannelMain` handed
 * to the renderer over `webContents.postMessage("kira:port", null, [port2])`: main keeps
 * `port1` wrapped as a `MessageChannelLike` for the RPC server, `port2` goes to the renderer.
 * Requests and streams share this one port rather than splitting across `ipcRenderer.invoke`
 * and a channel — §3.5 names both mechanisms, and one is simpler than two while remaining
 * exactly what §3.5 asks for. `ipcRenderer.invoke` is not used anywhere in this package, which
 * is worth stating so a reader does not go looking for it.
 *
 * Settings are read once at startup through `Storage` and `coerceSettings` — there is no
 * `workspace.getConfiguration` equivalent to watch here, and P3 has no settings UI to change
 * them live (docs/plans/P3.md's W11 text: "the settings *UI* has no phase yet and is not
 * invented here").
 */
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { coerceSettings, SETTINGS, type SettingKey, type Settings } from "@kira-version/core";
import {
  createRepoHandlers,
  NodeFileWatcher,
  NodeProcessRunner,
  RepoService,
  type RepoServicePort,
} from "@kira-version/git";
import { createRpcServer } from "@kira-version/ipc";
import { app, BrowserWindow, dialog, MessageChannelMain, nativeTheme } from "electron";
import { type DialogApi, ElectronDialogs } from "../ports/dialogs.ts";
import { ElectronLogger } from "../ports/logger.ts";
import { ElectronStorage } from "../ports/storage.ts";
import { ElectronTheme, type NativeThemeApi } from "../ports/theme.ts";
import { ElectronWorkspaceRoots } from "../ports/workspaceRoots.ts";
import { createMainChannel } from "./channel.ts";
import { buildMenu } from "./menu.ts";
import { RecentRepos } from "./recentRepos.ts";
import { createWindow } from "./window.ts";

const SETTINGS_STORAGE_KEY = "settings";
const SETTING_KEYS = Object.keys(SETTINGS) as readonly SettingKey[];

/** W13's build must place these two files here, both relative to the running `dist/electron/
 *  main.js` — the same kind of coordination point `html.ts`'s `WEBVIEW_ENTRY` names for the
 *  webview build. `dist/ui`'s own internal shape mirrors `packages/ui/vite.config.ts`'s Vite
 *  `root` (`packages/`, the closest common ancestor of this file's own HTML entry and
 *  `host-vscode`'s webview entry — a single Vite build cannot place an HTML entry outside its
 *  root), so this file's built output lands at `dist/ui/host-electron/src/renderer/index.html`,
 *  not `dist/ui/renderer/index.html`. */
const PRELOAD_PATH = fileURLToPath(new URL("./preload.cjs", import.meta.url));
const RENDERER_HTML_PATH = fileURLToPath(
  new URL("../ui/host-electron/src/renderer/index.html", import.meta.url),
);

function readRawSettings(storage: ElectronStorage): Record<string, unknown> {
  const raw = storage.get<Record<string, unknown>>("global", SETTINGS_STORAGE_KEY) ?? {};
  const filtered: Record<string, unknown> = {};
  for (const key of SETTING_KEYS) {
    if (key in raw) filtered[key] = raw[key];
  }
  return filtered;
}

/** `repo.open`'s only Electron-specific behaviour: a successful open is remembered in
 *  `recentRepos`, the Electron half of `WorkspaceRoots` (§3.3) — everything else forwards to
 *  the real `RepoService` untouched. */
function withRecentRepos(service: RepoService, recentRepos: RecentRepos): RepoServicePort {
  return {
    git: service.git,
    async open(path) {
      const outcome = await service.open(path);
      if (outcome.kind === "ok") void recentRepos.add(path);
      return outcome;
    },
    close(repoId) {
      service.close(repoId);
    },
    status(repoId) {
      return service.status(repoId);
    },
    async loadMore(repoId, pages) {
      await service.loadMore(repoId, pages);
    },
    async streamGraph(repoId, opts) {
      await service.streamGraph(repoId, opts);
    },
  };
}

/** Adapts the real `dialog` + `BrowserWindow.getFocusedWindow()` into `ports/dialogs.ts`'s
 *  minimal, testable `DialogApi` — attaching to the focused window so the OS picker shows as a
 *  sheet on macOS is this adapter's job, not `ElectronDialogs`'s. */
function createDialogApi(): DialogApi {
  return {
    showOpenDialog(opts) {
      const focused = BrowserWindow.getFocusedWindow();
      const dialogOptions = {
        title: opts.title,
        buttonLabel: opts.buttonLabel,
        properties: [...opts.properties] as NonNullable<Electron.OpenDialogOptions["properties"]>,
      };
      return focused
        ? dialog.showOpenDialog(focused, dialogOptions)
        : dialog.showOpenDialog(dialogOptions);
    },
  };
}

/** Adapts the `nativeTheme` singleton into `ports/theme.ts`'s minimal, testable
 *  `NativeThemeApi` — live getters, since the OS theme can change at any time. */
function createNativeThemeApi(): NativeThemeApi {
  return {
    get shouldUseDarkColors() {
      return nativeTheme.shouldUseDarkColors;
    },
    get shouldUseHighContrastColors() {
      return nativeTheme.shouldUseHighContrastColors;
    },
    onUpdated(listener) {
      nativeTheme.on("updated", listener);
      return () => nativeTheme.off("updated", listener);
    },
  };
}

async function main(): Promise<void> {
  const gotLock = app.requestSingleInstanceLock();
  if (!gotLock) {
    app.quit();
    return;
  }

  let window: BrowserWindow | undefined;
  app.on("second-instance", () => {
    if (!window) return;
    if (window.isMinimized()) window.restore();
    window.focus();
  });

  await app.whenReady();

  const userDataDir = app.getPath("userData");
  const storage = new ElectronStorage(userDataDir);
  const { settings: initialSettings, problems } = coerceSettings(readRawSettings(storage));
  const currentSettings: Settings = initialSettings;

  const logger = new ElectronLogger(
    join(userDataDir, "logs"),
    () => currentSettings["kiraVersion.log.level"],
  );
  for (const problem of problems) logger.log("warn", "invalid setting, using default", problem);

  const dialogs = new ElectronDialogs(createDialogApi());
  const theme = new ElectronTheme(
    createNativeThemeApi(),
    () => currentSettings["kiraVersion.theme.kind"],
  );
  const recentRepos = new RecentRepos(storage);
  const roots = new ElectronWorkspaceRoots(recentRepos);

  const repoService = await RepoService.create({
    runner: new NodeProcessRunner(),
    fileWatcher: new NodeFileWatcher(logger.child("fileWatcher")),
    logger,
    settings: currentSettings,
    configuredGitCandidates: [currentSettings["kiraVersion.git.path"]].filter(
      (path) => path.length > 0,
    ),
  });
  logger.log("info", "activated", { git: repoService.git, theme: theme.current() });

  const service = withRecentRepos(repoService, recentRepos);

  window = createWindow({ storage, preloadPath: PRELOAD_PATH });
  buildMenu({ dialogs, recentRepos });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
  app.on("before-quit", () => repoService.dispose());

  window.webContents.once("did-finish-load", () => {
    if (!window) return;
    const { port1, port2 } = new MessageChannelMain();
    const channel = createMainChannel(port1);
    const handlers = createRepoHandlers({
      service,
      roots,
      dialogs,
      settings: () => currentSettings,
      host: "electron",
      logger,
    });
    const server = createRpcServer(channel, handlers);
    repoService.onChanged((event) => server.emit("repo.changed", event));
    window.webContents.postMessage("kira:port", null, [port2]);
    window.once("closed", () => server.dispose());
  });

  await window.loadFile(RENDERER_HTML_PATH);
}

void main();
