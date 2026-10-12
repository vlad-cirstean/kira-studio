/**
 * Copy for `GitBlockedPanel.vue` (§4.2's block state) — kept pure and separate from the
 * component so the text/branching logic is unit-testable without a DOM (the pure/DOM-split
 * precedent `palette.ts`/`rowSvg.ts`/`refBadges.ts` established in W7/W8).
 *
 * §6.1 asks for "the platform's upgrade command" as a single line, but `GitStatus` carries no
 * platform field (`core`/`ipc` never learn the *host OS*) and P3's W1 deliberately left this as
 * UI copy rather than wire data. The
 * UI package runs inside a real browser-like environment regardless, though, so
 * `navigator.userAgent` is read directly here instead of guessing or listing all three
 * platforms' commands at once — the honest single-command copy §6.1 asks for, sourced from the
 * one place that can actually answer it.
 */
import type { GitStatus } from '@kira/git-ipc';
import { t } from '@theme/i18n';

export type Platform = 'mac' | 'windows' | 'linux' | 'unknown';

export function detectPlatform(userAgent: string): Platform {
  if (/Mac OS X|Macintosh/i.test(userAgent)) return 'mac';
  if (/Windows/i.test(userAgent)) return 'windows';
  if (/Linux/i.test(userAgent)) return 'linux';
  return 'unknown';
}

function upgradeCommandFor(platform: Platform): string {
  switch (platform) {
    case 'mac':
      return 'brew upgrade git';
    case 'windows':
      return 'winget upgrade --id Git.Git';
    case 'linux':
      return t('git.blocked.upgradeLinux.example');
    case 'unknown':
      return t('git.blocked.upgradeUnknown.example');
  }
}

export type BlockedGitStatus = Exclude<GitStatus, { readonly kind: 'ok' }>;

export interface GitBlockedCopy {
  readonly title: string;
  readonly detail: string;
}

export function gitBlockedCopy(status: BlockedGitStatus, platform: Platform): GitBlockedCopy {
  switch (status.kind) {
    case 'notFound':
      return {
        title: t('git.blocked.notFound.title'),
        detail:
          status.probed.length > 0
            ? t('git.blocked.notFound.body', { paths: status.probed.join(', ') })
            : t('git.blocked.notFoundNoPaths.body'),
      };
    case 'tooOld':
      return {
        title: t('git.blocked.tooOld.title'),
        detail: t('git.blocked.tooOld.body', {
          detected: status.detected,
          path: status.path,
          required: status.required,
          command: upgradeCommandFor(platform),
        }),
      };
    case 'unusable':
      return {
        title: t('git.blocked.unusable.title'),
        detail: t('git.blocked.unusable.error', { path: status.path, reason: status.reason }),
      };
  }
}
