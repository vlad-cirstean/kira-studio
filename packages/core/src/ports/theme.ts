/**
 * The current *resolved* theme — never `"system"`, which is a setting value
 * (`kiraVersion.theme.kind`) meaning "resolve it for me"; `Theme.current()` always reports one
 * of the four concrete kinds VS Code itself distinguishes. VS Code pushes its resolved theme
 * into the webview automatically (§3.4); Electron's implementation watches the OS theme and
 * applies the manual override itself.
 */
import type { Disposable } from "./disposable.ts";

export type ThemeKind = "light" | "dark" | "high-contrast" | "high-contrast-light";

export interface Theme {
  current(): ThemeKind;
  onChanged(fn: (kind: ThemeKind) => void): Disposable;
}
