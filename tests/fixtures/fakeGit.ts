/**
 * A stand-in `git` binary for testing discovery.ts's resolution and version-probe logic end
 * to end — through the real resolution order, against a real (if fake) executable — rather
 * than by injecting a parsed version number past the code under test.
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export type FakeGitBehaviour = "ok" | "exitNonZero" | "garbageOutput" | "hang";

export interface FakeGitOptions {
  /** What `git version` should print. Only meaningful when `behaviour` is `"ok"`. */
  readonly version?: string;
  readonly behaviour?: FakeGitBehaviour;
}

// Real invocations carry other flags around "version" (discovery.ts always prepends
// `--no-optional-locks`), so these scripts scan every arg rather than checking only `$1`.
const HAS_VERSION_ARG = 'for a in "$@"; do if [ "$a" = "version" ]; then VERSION_ARG=1; fi; done';

function scriptFor(version: string, behaviour: FakeGitBehaviour): string {
  switch (behaviour) {
    case "ok":
      return `#!/bin/sh\n${HAS_VERSION_ARG}\nif [ "$VERSION_ARG" = "1" ]; then echo "git version ${version}"; exit 0; fi\nexit 1\n`;
    case "exitNonZero":
      return `#!/bin/sh\necho "fatal: fake git refuses everything" >&2\nexit 128\n`;
    case "garbageOutput":
      return `#!/bin/sh\n${HAS_VERSION_ARG}\nif [ "$VERSION_ARG" = "1" ]; then echo "not a version string at all"; exit 0; fi\nexit 1\n`;
    case "hang":
      return `#!/bin/sh\nsleep 999999\n`;
  }
}

/** Writes a fake `git` executable to a fresh temp directory and returns its path. */
export function makeFakeGit(opts: FakeGitOptions = {}): string {
  const { version = "2.38.0", behaviour = "ok" } = opts;
  const dir = mkdtempSync(join(tmpdir(), "kira-fake-git-"));
  const path = join(dir, "git");
  writeFileSync(path, scriptFor(version, behaviour), { mode: 0o755 });
  return path;
}
