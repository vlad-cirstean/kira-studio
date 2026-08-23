import { describe, expect, test } from "bun:test";
import { ElectronTheme, type NativeThemeApi } from "./theme.ts";

class FakeNativeTheme implements NativeThemeApi {
  shouldUseDarkColors: boolean;
  shouldUseHighContrastColors: boolean;
  readonly #listeners = new Set<() => void>();

  constructor(dark = false, highContrast = false) {
    this.shouldUseDarkColors = dark;
    this.shouldUseHighContrastColors = highContrast;
  }

  onUpdated(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  fireUpdated(): void {
    for (const listener of this.#listeners) listener();
  }
}

describe("ElectronTheme", () => {
  test("resolves system light/dark from nativeTheme when the override is system", () => {
    const light = new ElectronTheme(new FakeNativeTheme(false, false), () => "system");
    expect(light.current()).toBe("light");

    const dark = new ElectronTheme(new FakeNativeTheme(true, false), () => "system");
    expect(dark.current()).toBe("dark");
  });

  test("resolves high-contrast variants from nativeTheme when the override is system", () => {
    const highContrastDark = new ElectronTheme(new FakeNativeTheme(true, true), () => "system");
    expect(highContrastDark.current()).toBe("high-contrast");

    const highContrastLight = new ElectronTheme(new FakeNativeTheme(false, true), () => "system");
    expect(highContrastLight.current()).toBe("high-contrast-light");
  });

  test("a non-system override wins over nativeTheme entirely", () => {
    const theme = new ElectronTheme(new FakeNativeTheme(false, false), () => "dark");
    expect(theme.current()).toBe("dark");
  });

  test("onChanged fires with the freshly resolved kind when nativeTheme updates", () => {
    const nativeTheme = new FakeNativeTheme(false, false);
    const theme = new ElectronTheme(nativeTheme, () => "system");
    const seen: string[] = [];
    theme.onChanged((kind) => seen.push(kind));

    nativeTheme.shouldUseDarkColors = true;
    nativeTheme.fireUpdated();

    expect(seen).toEqual(["dark"]);
  });

  test("dispose unsubscribes from nativeTheme", () => {
    const nativeTheme = new FakeNativeTheme(false, false);
    const theme = new ElectronTheme(nativeTheme, () => "system");
    const seen: string[] = [];
    const subscription = theme.onChanged((kind) => seen.push(kind));

    subscription.dispose();
    nativeTheme.fireUpdated();

    expect(seen).toEqual([]);
  });
});
