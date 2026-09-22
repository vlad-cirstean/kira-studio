import type { LayoutPatch } from '@shared/domain/layout';
import type { TerminalLaunchKind } from '@shared/domain/tabs';
import { CHANNEL, type TerminalEvent } from '@shared/protocol/events';
import { on, trust, unwrap, windowKey } from './rpc';

// P103 Part 2 (§5.6): the 20 bound-call methods that were byte-for-byte identical between Kira
// Studio's own studioControl object (bridge/index.ts) and Kira Space's control object (§1.6/§1.7's
// own "confirmed shared" survey, re-verified here by manually counting both files rather than
// trusting either's own stale internal comment) — settings/layout get-all-and-set-plus-changed,
// the quit and close-window flush handshakes, the folder picker, tabsList/tabsSave, the five
// terminal methods, and linkOpenExternal. Everything else (94 more methods in Kira Studio's own
// studioControl, 24 more in Kira Space's) stays app-side, unmoved, in each app's own bridge/index.ts.
//
// `CoreBindings` is a **structural** interface, not an adapter: each app's own generated
// `@bindings/*` service modules (SettingsService, LayoutService, TabsService, LifecycleService,
// TerminalService, FilesService, LinkService) already satisfy it by shape — no per-app glue code,
// no change to Wails' own binding generation. Every method here is typed against `unknown`
// deliberately (the plan's own §5.6 sketch): a shared package can't import either app's own
// `@bindings/*` alias (it resolves to a different generated module per app, and CLAUDE.md's "a
// shared package never imports apps/*/internal/..." rules out depending on either app's generated
// output directly), and TypeScript's method-shorthand parameter checking is bivariant, so a real
// service's own narrower argument type (e.g. TerminalService.Open's `launchKind: TerminalLaunchKind`
// against this interface's plain `string`) still satisfies it in either direction. `tabs.Save`'s
// own `tabs` field stays scalar `unknown` rather than `unknown[]`: each app's real TabsService.Save
// takes `tabs: TabRecord[]` for that app's own (large, discriminated-union) TabRecord, and the
// bivariant check that lets every other field here stay narrow didn't clear an array of one —
// `unknown` (checked once as a whole, not per element) does.
export interface CoreBindings {
  settings: {
    GetAll(): Promise<unknown>;
    Set(a: { patch: unknown }): Promise<unknown>;
  };
  layout: {
    GetAll(): Promise<unknown>;
    Set(a: { patch: unknown }): Promise<unknown>;
  };
  tabs: {
    List(a: { windowKey: string }): Promise<unknown>;
    Save(a: { windowKey: string; tabs: unknown }): Promise<void>;
  };
  lifecycle: {
    Flushed(a: { windowKey: string }): void;
    WindowFlushed(a: { windowKey: string }): void;
  };
  terminal: {
    DefaultCwd(): Promise<unknown>;
    Open(a: {
      terminalId: string;
      cwd: string;
      cols: number;
      rows: number;
      windowKey: string;
      command: string;
      launchKind: string;
    }): Promise<unknown>;
    Write(a: { terminalId: string; data: string }): Promise<void>;
    Resize(a: { terminalId: string; cols: number; rows: number }): Promise<void>;
    Close(a: { terminalId: string }): Promise<void>;
  };
  files: {
    ChooseFolder(a: { title: string }): Promise<unknown>;
  };
  link: {
    OpenExternal(a: { url: string }): Promise<void>;
  };
}

// P25 D13's folder-picker result — identical shape in both apps' own generated
// FilesChooseFolderResult (`{ canceled: boolean; path: string | null }`, confirmed by reading both
// apps' generated bridge/models.ts side by side), restated here rather than imported from either
// app's own `@bindings/*` output for the same reason `CoreBindings` above stays on `unknown`.
interface FolderChoice {
  canceled: boolean;
  path: string | null;
}

// `S`/`L`/`T`/`P` are each app's own Settings, Layout, TabRecord and SettingsPatch shape. Layout is
// actually the same type in both apps today (both import `@shared/domain/layout`'s `Layout`
// verbatim, with no bridge-level narrowing — unlike SettingsShell.vue's own `Pick<Settings, …>`
// narrowing, which is a UI-layer concern §5.5 added, not a bridge one), but TabRecord genuinely
// differs (each app's own `state/tabDomain.ts` declares a different `z.discriminatedUnion`), and
// Settings/SettingsPatch now genuinely differ too (P103 Part 4 §7.3: each app's own
// `state/settingsDomain.ts`, not one shared `@shared/domain/settings` shape) — so all four stay
// generic, matching the plan's own `createCoreControl<Settings, Layout, TabRecord, SettingsPatch>
// (...)` call-site shape, rather than only genericizing the ones that must be.
export interface CoreControl<S, L, T, P> {
  linkOpenExternal: (url: string) => Promise<void>;

  settingsGetAll: () => Promise<S>;
  settingsSet: (patch: P) => Promise<S>;
  onSettingsChanged: (cb: (settings: S) => void) => () => void;

  layoutGetAll: () => Promise<L>;
  layoutSet: (patch: LayoutPatch) => Promise<L>;
  onLayoutChanged: (cb: (layout: L) => void) => () => void;

  // Quit handshake (P8 C8) and its close-window analogue (P8 C6/F8) — identical in both apps.
  onFlushBeforeClose: (cb: () => void) => () => void;
  appFlushed: () => void;
  onWindowFlushBeforeClose: (cb: () => void) => () => void;
  windowFlushed: () => void;

  filesChooseFolder: (title?: string) => Promise<FolderChoice>;

  // Both scoped to this page's own workbench (windowKey, read once at module load — P8 D2/F6).
  tabsList: () => Promise<T[]>;
  tabsSave: (tabs: T[]) => Promise<void>;

  terminalDefaultCwd: () => Promise<{ path: string }>;
  terminalOpen: (
    terminalId: string,
    cwd: string,
    cols: number,
    rows: number,
    command?: string,
    launchKind?: TerminalLaunchKind,
  ) => Promise<{ shell: string }>;
  terminalWrite: (terminalId: string, data: string) => Promise<void>;
  terminalResize: (terminalId: string, cols: number, rows: number) => Promise<void>;
  terminalClose: (terminalId: string) => Promise<void>;
  onTerminal: (cb: (event: TerminalEvent) => void) => () => void;
}

export function createCoreControl<S, L, T, P>(b: CoreBindings): CoreControl<S, L, T, P> {
  return {
    linkOpenExternal: (url: string): Promise<void> => unwrap(b.link.OpenExternal({ url })),

    settingsGetAll: (): Promise<S> => unwrap(b.settings.GetAll()).then((r) => trust<S>(r)),
    settingsSet: (patch: P): Promise<S> =>
      unwrap(b.settings.Set({ patch })).then((r) => trust<S>(r)),
    onSettingsChanged: (cb: (settings: S) => void): (() => void) => on(CHANNEL.settingsChanged, cb),

    layoutGetAll: (): Promise<L> => unwrap(b.layout.GetAll()).then((r) => trust<L>(r)),
    layoutSet: (patch: LayoutPatch): Promise<L> =>
      unwrap(b.layout.Set({ patch })).then((r) => trust<L>(r)),
    onLayoutChanged: (cb: (layout: L) => void): (() => void) => on(CHANNEL.layoutChanged, cb),

    onFlushBeforeClose: (cb: () => void): (() => void) => on(CHANNEL.appFlushBeforeClose, cb),
    appFlushed: (): void => {
      void b.lifecycle.Flushed({ windowKey });
    },
    onWindowFlushBeforeClose: (cb: () => void): (() => void) =>
      on(CHANNEL.windowFlushBeforeClose, cb),
    windowFlushed: (): void => {
      void b.lifecycle.WindowFlushed({ windowKey });
    },

    filesChooseFolder: (title?: string): Promise<FolderChoice> =>
      unwrap(b.files.ChooseFolder({ title: title ?? '' })).then((r) => trust<FolderChoice>(r)),

    tabsList: (): Promise<T[]> =>
      unwrap(b.tabs.List({ windowKey })).then((r) => trust<T[]>(r ?? [])),
    tabsSave: (tabs: T[]): Promise<void> => unwrap(b.tabs.Save({ windowKey, tabs })),

    terminalDefaultCwd: (): Promise<{ path: string }> =>
      unwrap(b.terminal.DefaultCwd()).then((r) => trust<{ path: string }>(r)),
    terminalOpen: (
      terminalId: string,
      cwd: string,
      cols: number,
      rows: number,
      command?: string,
      launchKind?: TerminalLaunchKind,
    ): Promise<{ shell: string }> =>
      unwrap(
        b.terminal.Open({
          terminalId,
          cwd,
          cols,
          rows,
          windowKey,
          command: command ?? '',
          launchKind: launchKind ?? 'shell',
        }),
      ).then((r) => trust<{ shell: string }>(r)),
    terminalWrite: (terminalId: string, data: string): Promise<void> =>
      unwrap(b.terminal.Write({ terminalId, data })),
    terminalResize: (terminalId: string, cols: number, rows: number): Promise<void> =>
      unwrap(b.terminal.Resize({ terminalId, cols, rows })),
    terminalClose: (terminalId: string): Promise<void> => unwrap(b.terminal.Close({ terminalId })),
    onTerminal: (cb: (event: TerminalEvent) => void): (() => void) => on(CHANNEL.terminal, cb),
  };
}
