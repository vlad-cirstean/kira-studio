/**
 * `git merge-tree --write-tree --messages --name-only <base> <other>` (§4.4, §7.5, §7.6):
 * conflict prediction without touching the worktree. Exit code is part of the parse contract
 * — 0 means clean, 1 means conflicts (both real outcomes; only >1 is an execution error, left
 * to errors.ts) — so this parser takes it as an argument rather than inferring the outcome
 * from output shape alone.
 *
 * Output is plain LF-terminated text, not NUL-framed — merge-tree has no `-z` mode, and
 * neither a tree id, a path (`--name-only` suppresses everything else) nor these fixed
 * messages can contain a raw LF.
 */
import type { MergePrediction } from "@kira-version/core";
import { assert } from "@kira-version/core";

export function mergeTreeArgs(base: string, other: string): string[] {
  return [
    "--no-optional-locks",
    "merge-tree",
    "--write-tree",
    "--messages",
    "--name-only",
    base,
    other,
  ];
}

/** Groups lines into blank-line-separated blocks, dropping the separators themselves. */
function blockify(lines: readonly string[]): string[][] {
  const blocks: string[][] = [[]];
  for (const line of lines) {
    if (line.length === 0) {
      blocks.push([]);
      continue;
    }
    blocks[blocks.length - 1]?.push(line);
  }
  return blocks.filter((block) => block.length > 0);
}

export function parseMergeTreeOutput(stdout: string, exitCode: number): MergePrediction {
  assert(
    exitCode === 0 || exitCode === 1,
    `merge-tree exited ${exitCode}, not a clean/conflict result`,
  );

  const lines = stdout.split("\n");
  const treeId = lines[0] ?? "";
  const blocks = blockify(lines.slice(1));

  if (exitCode === 0) {
    return { kind: "clean", treeId, messages: blocks.flat() };
  }
  const [paths, ...messageBlocks] = blocks;
  return { kind: "conflicts", paths: paths ?? [], messages: messageBlocks.flat() };
}
