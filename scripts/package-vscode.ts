#!/usr/bin/env bun
/**
 * G10 D7 — packages the built extension into a real `.vsix`: `apps/kira-studio/bin/kira-version.vsix`.
 * That directory is the repo's one build-output location (already gitignored, already where
 * `Kira Studio.app`/`.dmg` land) and, decisively, is *outside* the directory vsce packages
 * (`apps/kira-studio-vscode`), so a previous run's own `.vsix` can never be packaged into the next
 * one. A fixed filename (no version in it) keeps the Taskfile copy step and the Go-side path
 * constant; the version lives inside the manifest, where `code` reads it.
 *
 * `--no-dependencies` is mandatory, not a tidiness flag (F1): without it vsce shells `npm list
 * --production` to decide what to bundle from `node_modules`, and npm cannot resolve this
 * workspace's `workspace:*` protocol — it never succeeds either way. `dist/extension.cjs` is
 * already a complete bundle (D6), so there is nothing in `node_modules` the extension needs at
 * runtime regardless.
 *
 * Invoked as `bun <root>/node_modules/@vscode/vsce/vsce`, never `node` — this repo declares no
 * `node` dependency anywhere (verify-packaging.sh's own S5 note), and `vsce` under Bun produces a
 * byte-comparable `.vsix` to running it under Node (F6).
 */
import { closeSync, openSync, readSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { buildVsCodeBundles } from './build-vscode.ts';

const ROOT = join(import.meta.dir, '..');
const VSCODE_APP = join(ROOT, 'apps', 'kira-studio-vscode');
const OUT = join(ROOT, 'apps', 'kira-studio', 'bin', 'kira-version.vsix');
const VSCE = join(ROOT, 'node_modules', '@vscode', 'vsce', 'vsce');

async function main(): Promise<void> {
  await buildVsCodeBundles();

  const proc = Bun.spawn([process.execPath, VSCE, 'package', '--no-dependencies', '--out', OUT], {
    cwd: VSCODE_APP,
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    console.error(`package-vscode: vsce package exited ${exitCode}`);
    process.exit(1);
  }

  let stat: ReturnType<typeof statSync>;
  try {
    stat = statSync(OUT);
  } catch {
    console.error(`package-vscode: vsce exited 0 but ${OUT} does not exist`);
    process.exit(1);
  }

  // A well-formed .vsix is a zip archive — "PK" is its magic number. Anything smaller couldn't
  // possibly be one; this is a sanity floor, not a full validation.
  const head = Buffer.alloc(2);
  const fd = openSync(OUT, 'r');
  try {
    readSync(fd, head, 0, 2, 0);
  } finally {
    closeSync(fd);
  }
  if (stat.size < 1024 || head.toString('ascii') !== 'PK') {
    console.error(
      `package-vscode: ${OUT} does not look like a real .vsix (size=${stat.size}, head=${head.toString('hex')})`,
    );
    process.exit(1);
  }

  console.log(`package-vscode: wrote ${OUT} (${stat.size} bytes)`);
}

await main();
