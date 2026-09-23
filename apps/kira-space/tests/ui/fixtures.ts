import { resolve } from 'node:path';
import type { Page } from '@playwright/test';
import { createUiFixtures, type UiFixturesOptions } from '@workbench/testing/ui/fixtures';
import { mergeBootSnapshots } from './support/bootSnapshots';
import { type ControlMockHandle, installControlMocks } from './support/mockRuntime';
import type { ControlSnapshot } from './support/types';

// P103 Part 4 (closing audit, §10): tests/ui/support/server.ts hoisted to
// @workbench/testing/ui/server — see that file's own doc comment for why it now takes `distDir`.
const DIST_DIR = resolve(__dirname, '../../frontend/dist');

interface KiraAppExtra {
  control: ControlMockHandle;
}

export type KiraApp = { window: Page } & KiraAppExtra;

export interface RelaunchOptions extends UiFixturesOptions {
  control?: readonly ControlSnapshot[];
}

/**
 * Kira Studio's own `tests/ui/fixtures.ts`, ported — `relaunch()` means "open a fresh page against
 * the static build and mock the control-call wire protocol from scratch". No `stream`/`MockStreamHandle`
 * fixture here: that whole mechanism (mockStream.ts) is Studio's own bulk-data grid-page protocol
 * (`window._wails.streamFactory('data')`), which this app has no counterpart for — the one stream
 * this app's own repo-graph mount opens (`window._wails.streamFactory('git')`) is a different wire
 * entirely, mocked per-spec by `installGitStreamMock` (support/gitStreamMock.ts), not by this
 * fixture's own boot-time `relaunch()`.
 */
export const test = createUiFixtures<KiraAppExtra, RelaunchOptions>({
  distDir: DIST_DIR,
  installMocks: async (page, options) => ({
    control: await installControlMocks(page, mergeBootSnapshots(options?.control ?? [])),
  }),
});

export { expect } from '@playwright/test';
