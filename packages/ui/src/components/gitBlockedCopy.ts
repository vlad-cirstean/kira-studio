/**
 * Copy for `GitBlockedPanel.vue` (§4.2's block state) — kept pure and separate from the
 * component so the text/branching logic is unit-testable without a DOM (the pure/DOM-split
 * precedent `palette.ts`/`rowSvg.ts`/`refBadges.ts` established in W7/W8).
 *
 * §6.1 asks for "the platform's upgrade command" as a single line, but `GitStatus` carries no
 * platform field (`core`/`ipc` never learn the *host OS*, only the host *kind* — vscode/harness
 * — see `HostKind`) and P3's W1 deliberately left this as UI copy rather than wire data. The
 * UI package runs inside a real browser-like environment regardless, though, so
 * `navigator.userAgent` is read directly here instead of guessing or listing all three
 * platforms' commands at once — the honest single-command copy §6.1 asks for, sourced from the
 * one place that can actually answer it.
 */
import type { GitStatus } from "@kira-version/ipc";

export type Platform = "mac" | "windows" | "linux" | "unknown";

export function detectPlatform(userAgent: string): Platform {
  if (/Mac OS X|Macintosh/i.test(userAgent)) return "mac";
  if (/Windows/i.test(userAgent)) return "windows";
  if (/Linux/i.test(userAgent)) return "linux";
  return "unknown";
}

const UPGRADE_COMMANDS: Record<Platform, string> = {
  mac: "brew upgrade git",
  windows: "winget upgrade --id Git.Git",
  linux: "sudo apt install --only-upgrade git  (or your distribution's equivalent)",
  unknown: "your package manager's git upgrade command",
};

export function upgradeCommandFor(platform: Platform): string {
  return UPGRADE_COMMANDS[platform];
}

export type BlockedGitStatus = Exclude<GitStatus, { readonly kind: "ok" }>;

export interface GitBlockedCopy {
  readonly title: string;
  readonly detail: string;
}

export function gitBlockedCopy(status: BlockedGitStatus, platform: Platform): GitBlockedCopy {
  switch (status.kind) {
    case "notFound":
      return {
        title: "Git was not found",
        detail:
          status.probed.length > 0
            ? `Looked for git at: ${status.probed.join(", ")}. Install git, or set kiraVersion.git.path to point at it.`
            : "Install git, or set kiraVersion.git.path to point at it.",
      };
    case "tooOld":
      return {
        title: "Git is too old",
        detail: `Found ${status.detected} at ${status.path}; Kira Version needs at least ${status.required}. Run "${upgradeCommandFor(platform)}", or set ${status.settingId} to a newer git.`,
      };
    case "unusable":
      return {
        title: "Git is not usable",
        detail: `${status.path}: ${status.reason}`,
      };
  }
}
