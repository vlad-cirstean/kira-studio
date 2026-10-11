import { t } from '@theme/i18n';
import { errorText } from '@workbench/bridge/codedError';
import type { BridgeClient } from '../bridge/client.ts';

export interface ClipboardOutcome {
  readonly ok: boolean;
  /** Caller's success message, or the shared failure message on a rejection. */
  readonly message: string;
}

/**
 * P5 W10's one path to the `Clipboard` port: every copy site calls this rather than
 * `bridge.request("clipboard.write", ...)` directly, so a rejection is never silently swallowed
 * (§6.4: "silence is the one unacceptable outcome") and every site's wording matches. `message` is the translated success text and doubles as `clipboard.write`'s
 * own `label` param — the host's log line only, never the copied text itself.
 */
export async function copyToClipboard(
  bridge: BridgeClient,
  text: string,
  message: string,
): Promise<ClipboardOutcome> {
  try {
    await bridge.request('clipboard.write', { text, label: message });
    return { ok: true, message };
  } catch (error) {
    console.error(`clipboard.write failed (${message}):`, error);
    return { ok: false, message: t('common.copy.failed.error', { error: errorText(error) }) };
  }
}
