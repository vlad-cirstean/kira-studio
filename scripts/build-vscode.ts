#!/usr/bin/env bun
/**
 * G1 §5.2/F18 — the extension's own build, in this repo's style (a small script beside
 * generate-wire.sh, `Bun.build` over the CLI so the exact output filename is ours to name, the
 * same call upstream's own scripts/build.ts made). Two outputs, both under
 * apps/kira-studio-vscode/dist/ (that package's own package.json#main commits to this, unlike
 * upstream's shared repo-root dist/ — see html.ts's own comment): the webview UI
 * (packages/git-ui/vite.config.ts) and the extension bundle itself.
 *
 * Not wired into scripts/setup.sh or `bun run build` (G1 §5.2): nothing in this phase's own proof
 * loads the bundle (D13 — activate() registers no webview view yet), and setup.sh is on the
 * critical path of every dev/e2e run. G3, the phase that first loads a webview, wires this in.
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
  const outFile = join(DIST, 'extension.js');

  const result = await Bun.build({
    entrypoints: [entry],
    target: 'node',
    format: 'esm',
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

async function main(): Promise<void> {
  await buildUi();
  await buildExtension();

  const violations = checkNoBunReferences(join(DIST, 'extension.js'));
  if (violations.length > 0) {
    console.error('build-vscode: bundle checks failed:\n');
    for (const v of violations) console.error(`  ${v}`);
    process.exit(1);
  }

  console.log('build-vscode: both bundles produced, bundle checks passed.');
}

main();
