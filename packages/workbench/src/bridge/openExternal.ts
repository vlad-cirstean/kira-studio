import { t } from '@theme/i18n';
import { announceApp } from '../behaviour/liveRegion';
import { toCodedError } from './codedError';
import { logWarn } from './log';

/** Wraps an OS open-link call: a failure is announced in the app live region, never thrown. */
export function createOpenExternal(
  call: (url: string) => Promise<void>,
): (url: string) => Promise<void> {
  return async (url) => {
    try {
      await call(url);
    } catch (err) {
      logWarn('openExternal', toCodedError(err).message);
      announceApp(t('common.error.openLink.announce'));
    }
  };
}
