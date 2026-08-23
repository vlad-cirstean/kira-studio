/**
 * `Theme` over `vscode.window.activeColorTheme` (P3 W10). VS Code reports the resolved kind and
 * does nothing else here — the CSS variables and body classes that make styling actually work
 * are injected automatically (§3.4); this port exists only so `app.init`'s `settings`/UI code
 * that wants the *current* kind (not just CSS) has one to read.
 */
import type { Disposable, Theme, ThemeKind } from "@kira-version/core";
import * as vscode from "vscode";

function toThemeKind(kind: vscode.ColorThemeKind): ThemeKind {
  switch (kind) {
    case vscode.ColorThemeKind.Light:
      return "light";
    case vscode.ColorThemeKind.Dark:
      return "dark";
    case vscode.ColorThemeKind.HighContrast:
      return "high-contrast";
    case vscode.ColorThemeKind.HighContrastLight:
      return "high-contrast-light";
  }
}

export class VsCodeTheme implements Theme {
  current(): ThemeKind {
    return toThemeKind(vscode.window.activeColorTheme.kind);
  }

  onChanged(fn: (kind: ThemeKind) => void): Disposable {
    return vscode.window.onDidChangeActiveColorTheme((theme) => fn(toThemeKind(theme.kind)));
  }
}
