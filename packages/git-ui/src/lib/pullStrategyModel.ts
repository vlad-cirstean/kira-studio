import type { PullStrategy, PullStrategySource } from '@kira/git-ipc';
import { type MessageKey, t } from '@theme/i18n';

/**
 * `docs/plans/P8.md` §7.3: "the resolved strategy and its provenance are always shown before the
 * op runs" — this is the one place that provenance text is composed, so the toolbar caption and
 * `PullStrategyPicker.vue`'s own popover never drift into two different wordings for the same
 * `PullStrategySource`.
 */
export function describePullStrategySource(source: PullStrategySource): string {
  switch (source) {
    case 'explicit':
      return t('git.pullStrategy.explicit.status');
    case 'setting':
      return t('git.pullStrategy.setting.status', { setting: 'pull.strategy' });
    case 'branchConfig':
      return t('git.pullStrategy.branchConfig.status');
    case 'pullConfig':
      return t('git.pullStrategy.pullConfig.status', { rebase: 'pull.rebase', ff: 'pull.ff' });
    case 'default':
      return t('git.pullStrategy.default.status');
  }
}

const PULL_STRATEGY_KEYS: Record<PullStrategy, MessageKey> = {
  'ff-only': 'git.pullStrategy.ffOnly.option',
  merge: 'common.merge.label',
  rebase: 'common.rebase.label',
};

export function pullStrategyLabel(strategy: PullStrategy): string {
  return t(PULL_STRATEGY_KEYS[strategy]);
}
