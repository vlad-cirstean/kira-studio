/**
 * `Theme` over Electron's `nativeTheme` (P3 W11), overridden by `kiraVersion.theme.kind`
 * (§3.4 D5: Electron has no host to push a theme *into* it the way VS Code does, so this
 * setting — `hosts: ["electron"]` in the schema — is Electron's only way to pin one). P3 has
 * no settings UI, so the override is read once at startup and `onChanged` only ever fires from
 * the OS side; a later phase's settings UI is what makes a live override change meaningful.
 *
 * The real `nativeTheme` is injected as a minimal `NativeThemeApi` rather than imported at
 * module scope, so a fake can drive `current`/`onChanged` in a unit test without the real
 * `electron` module — `main/index.ts` adapts the real singleton into this shape.
 */
import type { Disposable, Settings, Theme, ThemeKind } from "@kira-version/core";

export interface NativeThemeApi {
  readonly shouldUseDarkColors: boolean;
  readonly shouldUseHighContrastColors: boolean;
  /** Subscribes to the OS theme changing and returns the unsubscribe function directly — a
   *  structural simplification of `nativeTheme`'s `on("updated", fn)` / `off("updated", fn)`
   *  pair, adapted once in `main/index.ts`. */
  onUpdated(listener: () => void): () => void;
}

function resolveSystemKind(nativeTheme: NativeThemeApi): ThemeKind {
  if (nativeTheme.shouldUseHighContrastColors) {
    return nativeTheme.shouldUseDarkColors ? "high-contrast" : "high-contrast-light";
  }
  return nativeTheme.shouldUseDarkColors ? "dark" : "light";
}

export class ElectronTheme implements Theme {
  readonly #nativeTheme: NativeThemeApi;
  readonly #getOverride: () => Settings["kiraVersion.theme.kind"];

  constructor(nativeTheme: NativeThemeApi, getOverride: () => Settings["kiraVersion.theme.kind"]) {
    this.#nativeTheme = nativeTheme;
    this.#getOverride = getOverride;
  }

  current(): ThemeKind {
    const override = this.#getOverride();
    return override === "system" ? resolveSystemKind(this.#nativeTheme) : override;
  }

  onChanged(fn: (kind: ThemeKind) => void): Disposable {
    const dispose = this.#nativeTheme.onUpdated(() => fn(this.current()));
    return { dispose };
  }
}
