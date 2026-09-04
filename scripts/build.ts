#!/usr/bin/env bun
/**
 * P3 W13, §3.1's own tree entry for this file. P0 needed no build script (nothing needed
 * bundling); this builds two, both into one shared, repo-root `dist/` (`packages/host-vscode`'s
 * own `package.json#main` field already commits to this layout — see `html.ts`'s own comment on
 * the coordination point this file has to satisfy exactly): the UI (Vite,
 * `packages/ui/vite.config.ts`) and one Bun bundle (the VS Code extension). P4b removed the
 * Electron host and its two bundles (main process, preload) — see
 * `docs/plans/P4b-remove-electron.md`. `--watch` is not built — nobody has asked for it, and the
 * harness already covers the inner dev loop.
 *
 * `dist/tests` is a *different* consumer of this same repo-root `dist/` — `tsc --build`'s
 * declaration output for the `tests` project — so this script only ever touches its own
 * subdirectories, never the whole of `dist/`.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { build as viteBuild } from "vite";

const ROOT = join(import.meta.dir, "..");
const DIST = join(ROOT, "dist");

async function buildUi(): Promise<void> {
  await viteBuild({ configFile: join(ROOT, "packages", "ui", "vite.config.ts") });
}

interface BunTarget {
  readonly label: string;
  readonly entry: string;
  readonly outFile: string;
  readonly external: readonly string[];
  readonly format: "esm" | "cjs";
}

const BUN_TARGETS: readonly BunTarget[] = [
  {
    label: "vscode extension",
    entry: join(ROOT, "packages", "host-vscode", "src", "extension.ts"),
    outFile: join(DIST, "vscode", "extension.js"),
    external: ["vscode"],
    format: "esm",
  },
];

/** Bun's own bundler, not `bun build`'s CLI: the exact output filename matters (`main.js`, not
 *  whatever Bun would derive from an entry named `main/index.ts`), and writing `result.outputs`
 *  ourselves is simpler than fighting the CLI's naming template for it. Each target bundles its
 *  workspace `@kira-version/*` dependencies in directly (source-only packages, no build step of
 *  their own) and leaves only `external` unbundled — the host's own runtime provides that. */
async function bunBuildOne(target: BunTarget): Promise<void> {
  const result = await Bun.build({
    entrypoints: [target.entry],
    target: "node",
    format: target.format,
    external: [...target.external],
  });
  if (!result.success) {
    for (const message of result.logs) console.error(String(message));
    throw new Error(`build: ${target.label} failed to bundle`);
  }
  const [output] = result.outputs;
  if (!output) throw new Error(`build: ${target.label} produced no output`);
  const code = await output.text();
  mkdirSync(dirname(target.outFile), { recursive: true });
  writeFileSync(target.outFile, code);
  console.log(`build: ${target.label} -> ${relative(ROOT, target.outFile)}`);
}

/** §3.1/§8.1's "a check that the built extension bundle contains no Bun references" — a plain
 *  substring check, not a parse: the failure mode is a lint override (or a fresh Bun-only API
 *  biome hasn't been taught to flag yet) slipping into the one bundle that runs inside VS
 *  Code's own Node, where neither exists. */
function checkNoBunReferences(file: string): string[] {
  const text = readFileSync(file, "utf8");
  const violations: string[] = [];
  if (text.includes("bun:"))
    violations.push(`${relative(ROOT, file)}: contains a "bun:" specifier`);
  if (text.includes("Bun."))
    violations.push(`${relative(ROOT, file)}: contains a "Bun." reference`);
  return violations;
}

/** The same backstop for the other direction (§3.1's B3: `packages/ui` may import `core` and
 *  `ipc` only, never a host module) — but only against `packages/ui`'s *own* code, found via
 *  the manifest's `isEntry` flag rather than a blanket scan of every `.js` file: `webview.js`
 *  is the VS Code host's own bootstrap glue (W10/W11), and it is entirely correct for it to say
 *  `host: "vscode"` — that literal is the whole mechanism host-detection runs on (§8.4). What
 *  must never mention a host is the shared chunk the entry `import`s, since that chunk *is*
 *  `packages/ui`'s compiled source. */
interface ViteManifestEntry {
  readonly file: string;
  readonly isEntry?: boolean;
}

function checkUiHostAgnostic(distUiDir: string): string[] {
  const manifestPath = join(distUiDir, ".vite", "manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<
    string,
    ViteManifestEntry
  >;
  const sharedChunks = Object.values(manifest)
    .filter((entry) => !entry.isEntry && entry.file.endsWith(".js"))
    .map((entry) => join(distUiDir, entry.file));

  return sharedChunks.flatMap((file) => {
    const text = readFileSync(file, "utf8");
    const violations: string[] = [];
    if (text.includes('require("vscode")')) {
      violations.push(`${relative(ROOT, file)}: contains require("vscode")`);
    }
    return violations;
  });
}

async function main(): Promise<void> {
  await buildUi();
  for (const target of BUN_TARGETS) await bunBuildOne(target);

  const violations = [
    ...checkNoBunReferences(join(DIST, "vscode", "extension.js")),
    ...checkUiHostAgnostic(join(DIST, "ui")),
  ];

  if (violations.length > 0) {
    console.error("build: bundle checks failed:\n");
    for (const v of violations) console.error(`  ${v}`);
    process.exit(1);
  }

  console.log("build: both bundles produced, bundle checks passed.");
}

main();
