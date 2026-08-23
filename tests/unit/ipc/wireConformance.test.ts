/**
 * `packages/ipc` may not import `@kira-version/core` (§3.1, B3), so `contract.ts` declares its
 * own structural copies of core's wire-relevant types instead of importing them. This file is
 * the check that closes the drift that resolution risks (`docs/plans/P3.md`'s "The `ipc` →
 * `core` boundary" section): every assignment below is compile-time-only — `tsc --build`
 * (`bun run check`) fails if a field is added to one side and not the other, in either
 * direction, which is exactly what an import would have caught for free.
 *
 * Lives under `tests/unit/` rather than colocated in either package for the same `rootDir`
 * reason P2 discovered (`docs/SPEC.md` §3.1): a test that imports both `packages/core` and
 * `packages/ipc` cannot live inside either package's own `src/`.
 */
import { describe, expect, test } from "bun:test";
import type { DecorationRef as CoreDecorationRef } from "../../../packages/core/src/model/commit.ts";
import type { HeadState as CoreHeadState } from "../../../packages/core/src/model/repo.ts";
import type {
  DecorationRef as WireDecorationRef,
  HeadState as WireHeadState,
} from "../../../packages/ipc/src/contract.ts";

/** Never called — its only job is to make the assignments inside it part of the compiled
 *  program, so a type mismatch is a `tsc` error rather than dead code eliminated before it
 *  can be checked. */
function assertBothWays<Wire, Core>(
  _toWire: (core: Core) => Wire,
  _toCore: (wire: Wire) => Core,
): void {
  // intentionally empty
}

describe("ipc wire conformance", () => {
  test("HeadState: core and ipc's wire copy are assignable both ways", () => {
    assertBothWays<WireHeadState, CoreHeadState>(
      (core) => core,
      (wire) => wire,
    );
    // A real value, so this test is not vacuous under `bun test` (which does not itself
    // typecheck) — it also exercises the shape at runtime.
    const branch: CoreHeadState = { kind: "branch", name: "main" };
    const wire: WireHeadState = branch;
    expect(wire).toEqual(branch);
  });

  test("DecorationRef: core and ipc's wire copy are assignable both ways", () => {
    assertBothWays<WireDecorationRef, CoreDecorationRef>(
      (core) => core,
      (wire) => wire,
    );
    const tag: CoreDecorationRef = { kind: "tag", name: "v1" };
    const wire: WireDecorationRef = tag;
    expect(wire).toEqual(tag);
  });
});
