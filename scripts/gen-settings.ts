#!/usr/bin/env bun
/**
 * D25 — regenerates `packages/host-vscode/package.json`'s `contributes.configuration` from
 * `@kira-version/core`'s settings schema (`packages/core/src/settings/schema.ts`), the single
 * source of truth. `--check` (what `bun run check` calls) exits non-zero instead of writing, in
 * the same spirit as `check-tokens.ts`: the failure mode this prevents — a setting added in
 * `core` and never surfaced in VS Code, or the manifest edited by hand and silently overwritten
 * on the next real run — is invisible in review and obvious to a generator.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { toVsCodeConfiguration } from "../packages/core/src/settings/schema.ts";

const MANIFEST_PATH = join(import.meta.dir, "..", "packages", "host-vscode", "package.json");

function render(manifestText: string): string {
  const manifest = JSON.parse(manifestText) as Record<string, unknown>;
  const existingContributes = manifest.contributes as Record<string, unknown> | undefined;
  const contributes = { ...existingContributes, configuration: toVsCodeConfiguration() };
  const next = { ...manifest, contributes };
  return `${JSON.stringify(next, null, 2)}\n`;
}

function main(): void {
  const check = process.argv.includes("--check");
  const current = readFileSync(MANIFEST_PATH, "utf8");
  const next = render(current);

  if (check) {
    if (next !== current) {
      console.error(
        "gen-settings --check: packages/host-vscode/package.json's contributes.configuration " +
          "is out of date — run `bun run scripts/gen-settings.ts` to regenerate.",
      );
      process.exit(1);
    }
    console.log("gen-settings --check: packages/host-vscode/package.json is up to date.");
    return;
  }

  if (next === current) {
    console.log("gen-settings: packages/host-vscode/package.json is already up to date.");
    return;
  }
  writeFileSync(MANIFEST_PATH, next);
  console.log("gen-settings: wrote packages/host-vscode/package.json's contributes.configuration.");
}

main();
