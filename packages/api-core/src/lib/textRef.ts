import type { MessageKey, MessageParams } from '@theme/i18n';

/** A catalog message reference. api-core holds no English; the host renders it with `t()`. */
export interface TextRef {
  readonly key: MessageKey;
  readonly params?: MessageParams;
}
