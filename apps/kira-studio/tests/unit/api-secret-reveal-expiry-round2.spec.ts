// P21 round 2 architecture/security finding 5: round 1 (api-variables-reveal-grace-expiry.spec.ts)
// pinned that `revealedValues` re-masks itself at the grace window. Two sibling maps did not:
// `revealedHistoryValues` (a prior secret value revealed from the history popover) and
// `copyAsCurlDialogState.revealedSecretValues` (the fully-substituted Copy-as-curl command, the
// more serious of the two — the dialog can sit open on screen indefinitely with a real credential
// inline). Both were cleared only by their own dialog/popover's close path, never by expiry. This
// test fails against the pre-fix code (neither map ever schedules a timer) and passes once both
// share the same createRevealExpiry discipline `revealedValues` already had.
import './support/window';

import { describe, expect, test } from 'bun:test';

const { control } = await import('../../frontend/src/bridge/control');
const { revealHistoryEntry, revealedHistoryValues, openHistoryMenu, closeHistoryMenu } =
  await import('../../frontend/src/api/state/variables');
const { copyAsCurlDialogState, openCopyAsCurlDialog, revealSecretValues, currentCurlCommand } =
  await import('../../frontend/src/api/state/curl');
const { ensureVariablesLoaded } = await import('../../frontend/src/api/state/variables');

function withCapturedTimeout<T>(run: (fire: () => void) => Promise<T>): Promise<T> {
  const realSetTimeout = globalThis.setTimeout;
  let captured: { fn: () => void; ms: number } | null = null;
  (globalThis as { setTimeout: typeof setTimeout }).setTimeout = ((fn: () => void, ms: number) => {
    captured = { fn, ms };
    return 0 as unknown as ReturnType<typeof setTimeout>;
  }) as typeof setTimeout;
  const fire = () => {
    if (!captured) throw new Error('setTimeout was never called');
    captured.fn();
  };
  return run(fire).finally(() => {
    globalThis.setTimeout = realSetTimeout;
  });
}

describe('revealHistoryEntry grace-window expiry (round 2 finding 5)', () => {
  test('a revealed history value is scheduled for re-masking at the auth grace, not only on popover close', async () => {
    closeHistoryMenu();
    (
      control as unknown as { variablesRevealHistory: typeof control.variablesRevealHistory }
    ).variablesRevealHistory = async () => ({
      outcome: 'revealed',
      value: 'old_sk_live_secret',
      error: null,
    });
    (control as unknown as { variablesHistory: typeof control.variablesHistory }).variablesHistory =
      async () => [];

    await openHistoryMenu('tab-1', 'environment', 'env-1', 'var-1');

    await withCapturedTimeout(async (fire) => {
      const value = await revealHistoryEntry('hist-1');
      expect(value).toBe('old_sk_live_secret');
      expect(revealedHistoryValues['hist-1']).toBe('old_sk_live_secret');

      fire();

      expect(revealedHistoryValues['hist-1']).toBeUndefined();
    });
  });
});

describe('Copy-as-curl revealed secret grace-window expiry (round 2 finding 5)', () => {
  test('the rendered command re-masks itself once the reveal grace elapses, without the dialog closing', async () => {
    (control as unknown as { variablesList: typeof control.variablesList }).variablesList =
      async () => [
        {
          id: 'secret-var-1',
          scope: 'environment',
          ownerId: 'env-curl-1',
          name: 'apiToken',
          value: '',
          isSecret: true,
          sortOrder: 0,
          description: '',
        },
      ];
    (control as unknown as { variablesReveal: typeof control.variablesReveal }).variablesReveal =
      async () => ({ outcome: 'revealed', value: 'sk_live_curl_secret', error: null });

    await ensureVariablesLoaded('environment', 'env-curl-1');

    openCopyAsCurlDialog(
      'GET',
      {
        url: 'https://api.example.com/{{apiToken}}',
        headers: [],
        body: {
          mode: 'none',
          raw: '',
          code: '',
          codeLanguage: 'json',
          urlEncoded: [],
          formData: [],
          file: '',
        },
        refs: [],
      },
      ['apiToken'],
      '',
      '',
      'env-curl-1',
    );

    await withCapturedTimeout(async (fire) => {
      await revealSecretValues();
      expect(copyAsCurlDialogState.revealedSecretValues.apiToken).toBe('sk_live_curl_secret');
      expect(currentCurlCommand()).toContain('sk_live_curl_secret');

      fire();

      expect(copyAsCurlDialogState.revealedSecretValues.apiToken).toBeUndefined();
      expect(currentCurlCommand()).not.toContain('sk_live_curl_secret');
      expect(currentCurlCommand()).toContain('{{apiToken}}');
    });
  });
});
