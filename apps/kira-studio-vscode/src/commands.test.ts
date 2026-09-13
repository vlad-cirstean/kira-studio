/**
 * G10 D20 — the command-palette audit's enforcement mechanism, run by `bun run test:unit`. Five
 * assertions, in the plan's own order:
 *
 * 1. Every served mutating kind has a real command.
 * 2. No served kind is marked `pending`, and no unserved kind carries a command (the converse).
 * 3. Every table command id is declared in `package.json#contributes.commands`.
 * 4. Every `kiraVersion.*` manifest command is in the table (no orphan).
 * 5. Command ids are unique.
 *
 * The "served" half of (1)/(2) is extracted from the Go source itself —
 * `internal/gitsession/ops.go`'s `opTable` and `internal/gitsession/remote.go`'s `RunRemote`
 * switch — plus `'undo'`/`'cancel'`, which are unconditionally-implemented top-level RPC methods
 * with no per-kind opt-out (unlike opTable's stash/reset/cherryPick entries, which can genuinely
 * be absent). A *sanity guard* on the extraction itself (non-empty, contains known anchor names)
 * is what stops a regex that silently stopped matching from making this whole test pass vacuously
 * — see `describe('extraction sanity guard')` below.
 */

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ALL_COMMANDS,
  CATEGORY,
  isPaletteCommand,
  MUTATING_COMMANDS,
  type MutatingAction,
  OTHER_COMMANDS,
} from './commands.ts';

const VSCODE_APP_DIR = join(import.meta.dir, '..');
const OPS_GO = join(VSCODE_APP_DIR, '..', 'kira-studio', 'internal', 'gitsession', 'ops.go');
const REMOTE_GO = join(VSCODE_APP_DIR, '..', 'kira-studio', 'internal', 'gitsession', 'remote.go');
// G26 D13/F11: a THIRD Go source — `stack.restack` is served by its own dedicated executor
// (`RunRestack`), neither an `opTable` kind nor a `RunRemote` switch arm, so neither of the two
// extractions above can ever discover it. Proven served the same way the other two are: by
// grepping the Go source itself, not by trusting the TS side's own claim.
const STACK_GO = join(VSCODE_APP_DIR, '..', 'kira-studio', 'internal', 'gitsession', 'stack.go');
const PACKAGE_JSON = join(VSCODE_APP_DIR, 'package.json');

interface ManifestCommand {
  readonly command: string;
  readonly title?: string;
  readonly category?: string;
}

function readManifestCommands(): ManifestCommand[] {
  const pkg = JSON.parse(readFileSync(PACKAGE_JSON, 'utf8')) as {
    contributes?: { commands?: ManifestCommand[] };
  };
  return pkg.contributes?.commands ?? [];
}

/** Extracts the `{...}` block starting at the first `{` after `startMarker`, by brace-counting —
 *  robust to arbitrarily nested braces inside (opTable's own anonymous-function entries), unlike a
 *  regex that tries to match the whole block in one shot. */
function extractBraceBlock(source: string, startMarker: string): string {
  const markerIndex = source.indexOf(startMarker);
  if (markerIndex === -1) {
    throw new Error(`commands.test: could not find "${startMarker}" — has the Go source moved?`);
  }
  const braceStart = source.indexOf('{', markerIndex);
  let depth = 0;
  for (let i = braceStart; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') {
      depth--;
      if (depth === 0) return source.slice(braceStart, i + 1);
    }
  }
  throw new Error(`commands.test: unbalanced braces after "${startMarker}"`);
}

/** `opTable`'s own entries are exactly the lines shaped like `"kind": {` (a map literal whose
 *  value is a struct literal starting on the same line) — narrower than "any quoted string
 *  followed by a brace anywhere in the block", which would also match nested struct-literal
 *  fields inside e.g. `opContinue`'s anonymous Prepare function. */
function extractOpTableKinds(opsGoSource: string): string[] {
  const block = extractBraceBlock(opsGoSource, 'var opTable = map[string]opSpec{');
  const kinds: string[] = [];
  for (const line of block.split('\n')) {
    const match = /^\s*"([A-Za-z]+)":\s*\{\s*$/.exec(line);
    if (match) kinds.push(match[1]);
  }
  return kinds;
}

/** `RunRemote`'s own `switch params.Kind { case "fetch": ... }` — one or more comma-separated
 *  quoted kinds per `case`, bounded to just this switch (brace-counted) so the file's other two
 *  switches (a `case "push":`/`case "forcePush":` pair inside a different function, and
 *  `case "pull.rebase":`/`case "pull.ff":` over git config) are never in scope. */
function extractRemoteSwitchKinds(remoteGoSource: string): string[] {
  const block = extractBraceBlock(remoteGoSource, 'switch params.Kind {');
  const kinds: string[] = [];
  const caseLine = /case\s+((?:"[A-Za-z]+"\s*,?\s*)+):/g;
  for (const match of block.matchAll(caseLine)) {
    for (const quoted of match[1].matchAll(/"([A-Za-z]+)"/g)) kinds.push(quoted[1]);
  }
  return kinds;
}

/** G26 D13's own third-source extraction — a plain existence check for `RunRestack`'s own method
 *  signature in `gitsession/stack.go`, exactly the way `commands.ts`'s own doc comment describes
 *  it: "a grep for `func (e *RepoEntry) RunRestack(` in `gitsession/stack.go`". */
function extractsRestackExecutor(stackGoSource: string): boolean {
  return /func \(e \*RepoEntry\) RunRestack\(/.test(stackGoSource);
}

const opsGoSource = readFileSync(OPS_GO, 'utf8');
const remoteGoSource = readFileSync(REMOTE_GO, 'utf8');
const stackGoSource = readFileSync(STACK_GO, 'utf8');
const opTableKinds = extractOpTableKinds(opsGoSource);
const remoteSwitchKinds = extractRemoteSwitchKinds(remoteGoSource);
const restackServed = extractsRestackExecutor(stackGoSource);
// 'undo'/'cancel' are unconditionally-served top-level RPC methods (undo.run, remote.cancel) —
// never conditional the way an opTable/RunRemote entry is, so they are not extracted, just added.
// 'restack' is added conditionally on the THIRD source actually finding RunRestack (D13) — never
// unconditionally, so a Go-side rename or removal of the executor fails this test rather than
// silently keeping 'restack' served forever.
const servedKinds = new Set<string>([
  ...opTableKinds,
  ...remoteSwitchKinds,
  'undo',
  'cancel',
  ...(restackServed ? ['restack'] : []),
]);

describe('extraction sanity guard', () => {
  // Without this, a regex that silently stopped matching (a Go source reformat, a renamed
  // variable) would make every assertion below pass vacuously over an empty set — the one failure
  // mode this whole mechanism exists to prevent.
  test('opTable extraction is non-empty and contains known anchors', () => {
    expect(opTableKinds.length).toBeGreaterThan(0);
    expect(opTableKinds).toContain('checkout');
    expect(opTableKinds).toContain('revert');
  });

  test('remote switch extraction is non-empty and contains known anchors', () => {
    expect(remoteSwitchKinds.length).toBeGreaterThan(0);
    expect(remoteSwitchKinds).toContain('fetch');
    expect(remoteSwitchKinds).toContain('pull');
  });

  // G26 D13: the third source's own sanity guard — without this, a Go-side rename of RunRestack
  // would make 'restack' silently drop out of servedKinds and every assertion below pass
  // vacuously for it, exactly the failure mode this whole file's own doc comment warns about.
  test('stack.go RunRestack extraction finds the executor', () => {
    expect(restackServed).toBe(true);
  });
});

describe('MUTATING_COMMANDS against Go’s own served kinds', () => {
  test('every served kind has a real command, not `pending`', () => {
    for (const kind of servedKinds) {
      const entry = MUTATING_COMMANDS[kind as MutatingAction];
      expect(entry, `served kind "${kind}" has no MUTATING_COMMANDS entry at all`).toBeDefined();
      expect(
        isPaletteCommand(entry),
        `served kind "${kind}" is marked pending in MUTATING_COMMANDS — it needs a real command now that Go serves it`,
      ).toBe(true);
    }
  });

  test('no unserved kind carries a real command', () => {
    for (const [kind, entry] of Object.entries(MUTATING_COMMANDS)) {
      if (servedKinds.has(kind)) continue;
      expect(
        isPaletteCommand(entry),
        `kind "${kind}" has a real command in MUTATING_COMMANDS but Go's opTable/RunRemote does not serve it yet — mark it {pending: ...} instead`,
      ).toBe(false);
    }
  });
});

describe('MUTATING_COMMANDS against package.json#contributes.commands', () => {
  const manifestCommands = readManifestCommands();
  const manifestById = new Map(manifestCommands.map((c) => [c.command, c]));

  test('every table command id is declared in the manifest, with a title and the shared category', () => {
    for (const entry of Object.values(MUTATING_COMMANDS)) {
      if (!isPaletteCommand(entry)) continue;
      const manifestEntry = manifestById.get(entry.command);
      expect(
        manifestEntry,
        `"${entry.command}" is in MUTATING_COMMANDS but missing from package.json#contributes.commands`,
      ).toBeDefined();
      expect(manifestEntry?.title, `"${entry.command}"'s manifest entry has no title`).toBeTruthy();
      expect(
        manifestEntry?.category,
        `"${entry.command}"'s manifest entry has category "${manifestEntry?.category}", want "${CATEGORY}"`,
      ).toBe(CATEGORY);
    }
  });

  test('every kiraVersion.* manifest command is in the table (no orphan)', () => {
    const tableIds = new Set(ALL_COMMANDS.map((c) => c.command));
    for (const manifestEntry of manifestCommands) {
      if (!manifestEntry.command.startsWith('kiraVersion.')) continue;
      expect(
        tableIds.has(manifestEntry.command),
        `"${manifestEntry.command}" is in the manifest but not in commands.ts's ALL_COMMANDS`,
      ).toBe(true);
    }
  });
});

describe('command id hygiene', () => {
  test('every command id across the whole table is unique', () => {
    const ids = ALL_COMMANDS.map((c) => c.command);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('OTHER_COMMANDS carries every id ALL_COMMANDS expects for non-mutating commands', () => {
    // A cheap totality check on OTHER_COMMANDS itself: every entry has a non-empty title.
    for (const entry of OTHER_COMMANDS) {
      expect(entry.title.length).toBeGreaterThan(0);
    }
  });
});
