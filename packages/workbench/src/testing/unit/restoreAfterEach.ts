import { afterEach } from 'bun:test';

// `control` and `data` (bridge/control.ts, bridge/data.ts) are each one shared singleton object
// across the whole bun test process — Bun's module registry, not per-file (wailsRuntime.ts's own
// comment documents this hazard class for callFactory/Stream). A spec that overwrites one of
// their methods with a stub, without restoring it, leaks that stub into every spec that runs
// afterward in the same process. Confirmed in practice: ops-markraw.spec.ts's own opsRecent
// override reached bridge-unwrap.spec.ts's generic "every control method rejects" check, on
// whichever CI run's file-discovery order happened to put it first — invisible locally, where the
// opposite order never let the override survive that long.
//
// Call this once per spec file, right after importing the object, for every shared object a test
// in that file overwrites a method on. It shallow-snapshots the object as it is at that moment and
// restores exactly that snapshot after every test in the file, so a later spec never sees this
// file's own stubs.
export function restoreAfterEach<T extends object>(obj: T): void {
  const original = { ...obj };
  afterEach(() => {
    Object.assign(obj, original);
  });
}
