/**
 * The current *resolved* theme — always one of the four concrete kinds VS Code itself
 * distinguishes, never an unresolved "follow the OS" value. VS Code pushes its resolved theme
 * into the webview automatically (§3.4).
 */
import type { Disposable } from './disposable.ts';

export type ThemeKind = 'light' | 'dark' | 'high-contrast' | 'high-contrast-light';

export interface Theme {
  current(): ThemeKind;
  onChanged(fn: (kind: ThemeKind) => void): Disposable;
}
