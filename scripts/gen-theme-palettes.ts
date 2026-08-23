#!/usr/bin/env bun
/**
 * §3.4, P3 W12 — reads the JSON of VS Code's four built-in default themes (Default Dark
 * Modern, Default Light Modern, and the two high-contrast themes) and emits
 * `packages/host-electron/src/theme/palettes.generated.css`, defining the same `--vscode-*`
 * variable names for the subset `vscode-tokens.css` actually consumes — so Electron's window
 * is, literally, wearing VS Code's palette. Which names to emit is derived from
 * `vscode-tokens.css` itself, not hand-listed, so a new token added there cannot silently go
 * unpalette-d in Electron; a name that isn't a real theme colour id (VS Code injects some
 * `--vscode-*` names, like the two `font-family`/`font-size` pairs, from editor settings
 * rather than the colour theme) simply isn't found in any theme's colours and is omitted, so
 * `vscode-tokens.css`'s own fallback chain takes over for it — which is exactly what that
 * chain is for.
 *
 * **Source resolution**, first match wins, failing loudly (naming all four) rather than
 * fabricating a palette: `--source <dir>` (a directory holding the theme JSON files
 * directly); `$KIRA_VSCODE_APP` (a VS Code install's `resources/app` directory);
 * `/Applications/Visual Studio Code.app/Contents/Resources/app` (the macOS default install);
 * a `.vscode-test` download (whatever `@vscode/test-electron` downloads for W15, searched for
 * by folder name since the exact archive path differs macOS/Windows/Linux).
 *
 * The generated file is committed, with a header naming the VS Code version it came from, so
 * neither a build nor a test needs VS Code present. `--check` compares the freshly rendered
 * CSS against what is on disk and exits non-zero on a mismatch (a hand edit, or a stale file
 * after `vscode-tokens.css` changed); `bun run check` skips it with a message rather than
 * failing when the generated file does not exist yet, since generating it needs a real VS
 * Code install this sandbox may not have (docs/plans/P3.md's W12 "if generation cannot run in
 * this sandbox" clause) — see the phase's Findings for the exact command a macOS machine
 * with VS Code runs to close that gap.
 */
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const THEMES_SUBPATH = join("extensions", "theme-defaults", "themes");

const THEME_FILES = {
  dark: "dark_modern.json",
  light: "light_modern.json",
  "high-contrast": "hc_black.json",
  "high-contrast-light": "hc_light.json",
} as const;

type ThemeKindKey = keyof typeof THEME_FILES;

const TOKENS_PATH = join(
  import.meta.dir,
  "..",
  "packages",
  "ui",
  "src",
  "theme",
  "vscode-tokens.css",
);
const OUTPUT_PATH = join(
  import.meta.dir,
  "..",
  "packages",
  "host-electron",
  "src",
  "theme",
  "palettes.generated.css",
);
const VSCODE_TEST_DIR = join(import.meta.dir, "..", ".vscode-test");
const MACOS_DEFAULT_APP = "/Applications/Visual Studio Code.app/Contents/Resources/app";

// ---------------------------------------------------------------------------------------
// Pure logic — no filesystem, easy to unit test with fixture strings/maps.
// ---------------------------------------------------------------------------------------

/** Every `--vscode-*` custom property `vscode-tokens.css` references, deduplicated and
 *  sorted — the exact set this script is responsible for trying to fill in. */
export function extractVscodeVarNames(css: string): string[] {
  const matches = css.match(/--vscode-[A-Za-z0-9-]+/g) ?? [];
  return [...new Set(matches)].sort();
}

/**
 * VS Code's own CSS variable naming for a colour id: dots become hyphens (`editor.background`
 * → `--vscode-editor-background`, `gitDecoration.addedResourceForeground` →
 * `--vscode-gitDecoration-addedResourceForeground`), and every id used here has at most one
 * dot, so reversing it is "replace the first hyphen after the prefix with a dot". A name that
 * was never a colour id in the first place (the font tokens) reverses into a string that
 * simply never appears in a theme's `colors`, which is the intended "omit it" outcome, not a
 * case this function needs to special-case.
 */
export function varNameToColorId(varName: string): string {
  const suffix = varName.slice("--vscode-".length);
  const hyphenAt = suffix.indexOf("-");
  return hyphenAt === -1 ? suffix : `${suffix.slice(0, hyphenAt)}.${suffix.slice(hyphenAt + 1)}`;
}

/** Strips line comments and block comments from VS Code's theme JSON (JSONC in practice,
 *  even where not required), respecting string literals so a `//` inside a hex-ish string is
 *  never mistaken for a comment. */
export function stripJsonComments(text: string): string {
  let out = "";
  let inString = false;
  let inLineComment = false;
  let inBlockComment = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];
    if (inLineComment) {
      if (ch === "\n") {
        inLineComment = false;
        out += ch;
      }
      continue;
    }
    if (inBlockComment) {
      if (ch === "*" && next === "/") {
        inBlockComment = false;
        i++;
      }
      continue;
    }
    if (inString) {
      out += ch;
      if (ch === "\\") {
        out += next;
        i++;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
    } else if (ch === "/" && next === "/") {
      inLineComment = true;
      i++;
    } else if (ch === "/" && next === "*") {
      inBlockComment = true;
      i++;
    } else {
      out += ch;
    }
  }
  return out;
}

interface ThemeFile {
  readonly include?: string;
  readonly colors?: Record<string, string>;
}

/**
 * Resolves a theme file's full colour map by following `include` (the base file's colours
 * merged first, the including file's colours applied on top — `dark_modern.json` includes
 * `dark_plus.json` includes `dark_vs.json`, so the most-derived file wins any id it redefines).
 * `readThemeFile` is injected so this is testable against fixture strings, not real VS Code
 * files, on disk in every environment this generator runs in.
 */
export function resolveThemeColors(
  fileName: string,
  readThemeFile: (fileName: string) => string,
): Record<string, string> {
  const parsed = JSON.parse(stripJsonComments(readThemeFile(fileName))) as ThemeFile;
  const base = parsed.include ? resolveThemeColors(parsed.include, readThemeFile) : {};
  return { ...base, ...parsed.colors };
}

/** Renders the four palettes as one CSS file, one selector per theme kind, each defining only
 *  the `--vscode-*` names the theme actually resolved a colour for — everything else keeps
 *  falling through to `vscode-tokens.css`'s own literal fallback. */
export function renderPalettesCss(
  varNames: readonly string[],
  palettes: Readonly<Record<ThemeKindKey, Readonly<Record<string, string>>>>,
  vsCodeVersion: string,
): string {
  // `renderer/index.ts` stamps the resolved kind as a class on `<body>` (matching the classes
  // real VS Code itself stamps there, per `vscode-tokens.css`'s own comment) — but every
  // `--kv-*` consumer in `vscode-tokens.css` reads its `--vscode-*` source through a `var()`
  // written on `:root`. CSS custom-property substitution resolves a `var()` using the value
  // visible *at the element carrying the declaration*, then that one resolved value is what
  // inherits down — so a `--vscode-editor-background` declared only on `body` is invisible to
  // `:root`'s own `--kv-app-bg: var(--vscode-editor-background, #1e1e1e)`, which freezes to the
  // fallback regardless of body's class (confirmed the hard way: P3 W15's electron e2e spec
  // read a fallback colour under both a real light and a real dark body class until this
  // selector changed). `:root:has(body.vscode-dark)` puts the declaration back on `:root` — the
  // element every `--kv-*` var() actually reads from — while keying off the same body class.
  const SELECTORS: Record<ThemeKindKey, string> = {
    dark: ":root:has(body.vscode-dark)",
    light: ":root:has(body.vscode-light)",
    "high-contrast": ":root:has(body.vscode-high-contrast)",
    "high-contrast-light": ":root:has(body.vscode-high-contrast-light)",
  };

  const blocks = (Object.keys(THEME_FILES) as ThemeKindKey[]).map((kind) => {
    const colorsById = palettes[kind];
    const lines = varNames
      .map((varName) => {
        const value = colorsById[varNameToColorId(varName)];
        return value === undefined ? null : `  ${varName}: ${value};`;
      })
      .filter((line): line is string => line !== null);
    return `${SELECTORS[kind]} {\n${lines.join("\n")}\n}`;
  });

  return (
    `/*\n` +
    ` * Generated by scripts/gen-theme-palettes.ts from VS Code ${vsCodeVersion}'s built-in\n` +
    ` * theme JSON — do not hand-edit (P3 W12). Re-run the generator after a VS Code update or\n` +
    ` * after vscode-tokens.css references a new --vscode-* name.\n` +
    ` */\n\n${blocks.join("\n\n")}\n`
  );
}

// ---------------------------------------------------------------------------------------
// Filesystem glue — source resolution, reading, writing. Adapter code, no logic worth unit
// testing separately from the pure functions above (check-tokens.ts's and gen-settings.ts's
// own precedent: neither script has a test file either).
// ---------------------------------------------------------------------------------------

function themesDirFromAppRoot(appRoot: string): string {
  return join(appRoot, THEMES_SUBPATH);
}

/** Depth-bounded search for a `theme-defaults/themes` directory under `.vscode-test` — the
 *  archive layout `@vscode/test-electron` downloads differs by platform (a `.app` bundle on
 *  macOS, a flat `resources/app` on Windows/Linux), so this looks for the one subpath every
 *  layout shares rather than hardcoding any one of them. */
function findInVscodeTestDir(dir: string, depth = 0): string | undefined {
  if (depth > 6 || !existsSync(dir)) return undefined;
  if (dir.endsWith(THEMES_SUBPATH) && existsSync(join(dir, THEME_FILES.dark))) return dir;
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return undefined;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      const found = findInVscodeTestDir(full, depth + 1);
      if (found) return found;
    }
  }
  return undefined;
}

interface ResolvedSource {
  readonly themesDir: string;
  readonly describedAs: string;
}

function resolveThemesDir(argv: readonly string[]): ResolvedSource | undefined {
  const sourceFlagIndex = argv.indexOf("--source");
  const explicitSource = sourceFlagIndex === -1 ? undefined : argv[sourceFlagIndex + 1];
  const candidates: Array<{ dir: string; describedAs: string }> = [];

  if (explicitSource) {
    candidates.push({ dir: explicitSource, describedAs: `--source ${explicitSource}` });
  }
  const kiraVscodeApp = process.env.KIRA_VSCODE_APP;
  if (kiraVscodeApp) {
    candidates.push({
      dir: themesDirFromAppRoot(kiraVscodeApp),
      describedAs: `$KIRA_VSCODE_APP (${kiraVscodeApp})`,
    });
  }
  candidates.push({
    dir: themesDirFromAppRoot(MACOS_DEFAULT_APP),
    describedAs: "the macOS default install",
  });
  const fromVscodeTest = findInVscodeTestDir(VSCODE_TEST_DIR);
  if (fromVscodeTest) {
    candidates.push({ dir: fromVscodeTest, describedAs: ".vscode-test download" });
  }

  for (const candidate of candidates) {
    if (existsSync(join(candidate.dir, THEME_FILES.dark))) {
      return { themesDir: candidate.dir, describedAs: candidate.describedAs };
    }
  }
  return undefined;
}

function readVsCodeVersion(themesDir: string): string {
  // `themesDir` is `<app root>/extensions/theme-defaults/themes`; the app root's own
  // `product.json` names the version VS Code itself reports.
  const appRoot = dirname(dirname(dirname(themesDir)));
  const productJsonPath = join(appRoot, "product.json");
  if (!existsSync(productJsonPath)) return "unknown version";
  try {
    const product = JSON.parse(readFileSync(productJsonPath, "utf8")) as { version?: string };
    return product.version ?? "unknown version";
  } catch {
    return "unknown version";
  }
}

function main(): void {
  const argv = process.argv.slice(2);
  const check = argv.includes("--check");

  if (check && !existsSync(OUTPUT_PATH)) {
    console.log(
      "gen-theme-palettes --check: packages/host-electron/src/theme/palettes.generated.css " +
        "does not exist yet (no VS Code install was available to generate it from) — skipping.",
    );
    return;
  }

  const resolved = resolveThemesDir(argv);
  if (!resolved) {
    console.error(
      "gen-theme-palettes: could not find VS Code's built-in themes. Tried, in order:\n" +
        "  1. --source <dir>\n" +
        "  2. $KIRA_VSCODE_APP\n" +
        "  3. /Applications/Visual Studio Code.app/Contents/Resources/app (macOS default)\n" +
        "  4. a .vscode-test download\n" +
        "Pass --source <dir> pointing at a directory containing dark_modern.json, " +
        "light_modern.json, hc_black.json and hc_light.json.",
    );
    process.exit(1);
  }

  const { themesDir } = resolved;
  const readThemeFile = (fileName: string): string =>
    readFileSync(join(themesDir, fileName), "utf8");

  const varNames = extractVscodeVarNames(readFileSync(TOKENS_PATH, "utf8"));
  const palettes = Object.fromEntries(
    (Object.entries(THEME_FILES) as [ThemeKindKey, string][]).map(([kind, fileName]) => [
      kind,
      resolveThemeColors(fileName, readThemeFile),
    ]),
  ) as Record<ThemeKindKey, Record<string, string>>;

  const vsCodeVersion = readVsCodeVersion(themesDir);
  const next = renderPalettesCss(varNames, palettes, vsCodeVersion);

  if (check) {
    const current = existsSync(OUTPUT_PATH) ? readFileSync(OUTPUT_PATH, "utf8") : "";
    if (next !== current) {
      console.error(
        "gen-theme-palettes --check: palettes.generated.css is out of date — run " +
          "`bun run gen:theme-palettes` to regenerate.",
      );
      process.exit(1);
    }
    console.log("gen-theme-palettes --check: palettes.generated.css is up to date.");
    return;
  }

  writeFileSync(OUTPUT_PATH, next);
  console.log(
    `gen-theme-palettes: wrote packages/host-electron/src/theme/palettes.generated.css from VS Code ${vsCodeVersion} (${resolved.describedAs}).`,
  );
}

main();
