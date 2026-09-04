/**
 * `git-ipc` depends on nothing — not even `git-core` — so `contract.ts` declares its own
 * structural copies of `git-core`'s wire-relevant types rather than importing them. This file is
 * the check that closes the drift that resolution risks: every assignment below is
 * compile-time-only, so `typecheck:packages` fails if a field is added to one side and not the
 * other, in either direction, which is exactly what an import would have caught for free.
 *
 * The import below reaches into `git-core`'s source by relative path rather than through a
 * `workspace:*` dependency, deliberately: adding `@kira/git-core` to this package's manifest —
 * even as a devDependency — would make the dependency-direction rule (`docs/v1.3/SPEC.md`,
 * "Studio / Api / Git module boundary") unenforceable by inspecting manifests, which is the
 * cheapest place to enforce it. A test-only relative path costs nothing and states plainly that
 * this is a conformance check across a boundary, not a use of one package by the other.
 */
import { describe, expect, test } from 'bun:test';
import type { DecorationRef as CoreDecorationRef } from '../../git-core/src/model/commit';
import type { HeadState as CoreHeadState } from '../../git-core/src/model/repo';
import { type Settings as CoreSettings, defaultSettings } from '../../git-core/src/settings/schema';
import type {
  DecorationRef as WireDecorationRef,
  HeadState as WireHeadState,
  SettingsSnapshot as WireSettingsSnapshot,
} from '../src/contract';

/** Never called — its only job is to make the assignments inside it part of the compiled
 *  program, so a type mismatch is a typecheck error rather than dead code eliminated before it
 *  can be checked. */
function assertBothWays<Wire, Core>(
  _toWire: (core: Core) => Wire,
  _toCore: (wire: Wire) => Core,
): void {
  // intentionally empty
}

describe('ipc wire conformance', () => {
  test('HeadState: core and ipc’s wire copy are assignable both ways', () => {
    assertBothWays<WireHeadState, CoreHeadState>(
      (core) => core,
      (wire) => wire,
    );
    // A real value, so this test is not vacuous under `bun test` (which does not itself
    // typecheck) — it also exercises the shape at runtime.
    const branch: CoreHeadState = { kind: 'branch', name: 'main' };
    const wire: WireHeadState = branch;
    expect(wire).toEqual(branch);
  });

  test('DecorationRef: core and ipc’s wire copy are assignable both ways', () => {
    assertBothWays<WireDecorationRef, CoreDecorationRef>(
      (core) => core,
      (wire) => wire,
    );
    const tag: CoreDecorationRef = { kind: 'tag', name: 'v1' };
    const wire: WireDecorationRef = tag;
    expect(wire).toEqual(tag);
  });

  test('SettingsSnapshot: core’s generated Settings and ipc’s wire copy are assignable both ways', () => {
    assertBothWays<WireSettingsSnapshot, CoreSettings>(
      (core) => core,
      (wire) => wire,
    );
    const settings: CoreSettings = defaultSettings();
    const wire: WireSettingsSnapshot = settings;
    expect(wire).toEqual(settings);
  });
});
