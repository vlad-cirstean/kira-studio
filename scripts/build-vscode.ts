#!/usr/bin/env bun
/**
 * G1 §5.2/F18 — the extension's own build, in this repo's style (a small script beside
 * generate-wire.sh, `Bun.build` over the CLI so the exact output filename is ours to name, the
 * same call upstream's own scripts/build.ts made). Two outputs, both under
 * apps/kira-studio-vscode/dist/ (that package's own package.json#main commits to this, unlike
 * upstream's shared repo-root dist/ — see html.ts's own comment): the webview UI
 * (packages/git-ui/vite.config.ts) and the extension bundle itself.
 *
 * G10 D6: the extension bundle is CommonJS (`dist/extension.cjs`), not ESM — the first phase whose
 * artifact is ever loaded from a real installed `.vsix` (every prior phase used
 * `--extensionDevelopmentPath`), and whether VS Code's `require()`-based extension host accepts an
 * ESM `main` cannot be settled in this container. CJS is free here (+1 KB, still purity-clean) and
 * removes the question outright. The webview bundle stays Vite/ESM (loaded by a `<script
 * type="module">` tag, never `require`d) — untouched by this.
 *
 * G10 D7: `buildVsCodeBundles()` is exported so `scripts/package-vscode.ts` can call it directly
 * (one implementation of "build the extension", not a subprocess) — `main()` runs only when this
 * file is executed directly.
 *
 * G10 D8: wired into the *packaging* graph now (`apps/kira-studio/build/Taskfile.yml`'s
 * `build:vsix`, reached only from `darwin:package`/`darwin:package:universal`) — still out of `bun
 * run build` and `scripts/setup.sh`, per G3 D20's own reasoning: neither is on a path that has any
 * use for a packaged extension.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { build as viteBuild } from 'vite';

const ROOT = join(import.meta.dir, '..');
const VSCODE_APP = join(ROOT, 'apps', 'kira-studio-vscode');
const DIST = join(VSCODE_APP, 'dist');

async function buildUi(): Promise<void> {
  await viteBuild({ configFile: join(ROOT, 'packages', 'git-ui', 'vite.config.ts') });
}

async function buildExtension(): Promise<void> {
  const entry = join(VSCODE_APP, 'src', 'extension.ts');
  const outFile = join(DIST, 'extension.cjs');

  const result = await Bun.build({
    entrypoints: [entry],
    target: 'node',
    format: 'cjs',
    external: ['vscode'],
  });
  if (!result.success) {
    for (const message of result.logs) console.error(String(message));
    throw new Error('build-vscode: extension failed to bundle');
  }
  const [output] = result.outputs;
  if (!output) throw new Error('build-vscode: extension produced no output');
  const code = await output.text();
  mkdirSync(dirname(outFile), { recursive: true });
  writeFileSync(outFile, code);
  console.log(`build-vscode: extension -> ${relative(ROOT, outFile)}`);
}

/** The same bundle-purity backstop upstream's own scripts/build.ts carries (§3.1/§8.1's own
 *  check there): the extension bundle runs inside VS Code's own Node, where neither `bun:*` nor
 *  the global `Bun` exists. A plain substring check, not a parse — the failure mode is a stray
 *  Bun-only API biome hasn't been taught to flag yet slipping into the one bundle that can never
 *  run it. */
function checkNoBunReferences(file: string): string[] {
  const text = readFileSync(file, 'utf8');
  const violations: string[] = [];
  if (text.includes('bun:'))
    violations.push(`${relative(ROOT, file)}: contains a "bun:" specifier`);
  if (text.includes('Bun.'))
    violations.push(`${relative(ROOT, file)}: contains a "Bun." reference`);
  return violations;
}

export async function buildVsCodeBundles(): Promise<void> {
  await buildUi();
  await buildExtension();

  const violations = checkNoBunReferences(join(DIST, 'extension.cjs'));
  if (violations.length > 0) {
    console.error('build-vscode: bundle checks failed:\n');
    for (const v of violations) console.error(`  ${v}`);
    process.exit(1);
  }

  console.log('build-vscode: both bundles produced, bundle checks passed.');
}

if (import.meta.main) {
  await buildVsCodeBundles();
}
