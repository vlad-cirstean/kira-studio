import { resolve } from 'node:path';
import type { Page } from '@playwright/test';
import { createUiFixtures } from '@workbench/testing/ui/fixtures';
import type { RelaunchOptions } from '../fixtures';
import { mergeBootSnapshots } from './bootSnapshots';
import { contract } from './contract';
import { IPC } from './ipcChannels';
import { type ControlMockHandle, installControlMocks } from './mockRuntime';
import type { ControlSnapshot } from './types';

// A host view window is ready once its own root renders; it has no status bar. installMocks is a
// reduced copy of fixtures.ts's (that file is not this stream's): control mocks plus storage.
const DIST_DIR = resolve(__dirname, '../../../frontend/dist');

const installMocks = async (
  page: Page,
  options?: RelaunchOptions,
): Promise<{ control: ControlMockHandle }> => ({
  control: await installControlMocks(page, mergeBootSnapshots(options?.control ?? [])),
});

export const hostViewTest = createUiFixtures<{ control: ControlMockHandle }, RelaunchOptions>({
  distDir: DIST_DIR,
  installMocks,
  readySelector: '[data-testid="host-view-window"]',
});

export const t = (id: string) => `[data-testid="${id}"]`;

export interface Wire {
  kind: string;
  detail?: Record<string, unknown>;
  status: Record<string, unknown>;
}

type Target = {
  kind: string;
  url: string;
  provider: string;
  host: Record<string, string>;
  repo: string;
  number: number;
};

export const azureTarget = contract<Target>('host-view', 'HostViewService.WindowTarget#azure');
export const azureDetail = contract<Wire>('host-view', 'HostViewService.ChangeRequest#azure');
export const githubDetail = contract<Wire>('host-view', 'HostViewService.ChangeRequest#github');
export const unavailable = contract<Wire>('host-view', 'HostViewService.ChangeRequest#unavailable');
export const gone = contract<Wire>('host-view', 'HostViewService.ChangeRequest#gone');

// The contract holds no GitHub target (no GitHub link resolves through the fake registry); this one
// is the Azure target's shape with GitHub's identity and the detail fixture's own URL and number.
export const githubTarget: Target = {
  ...azureTarget,
  provider: 'github',
  host: {
    id: 'github',
    label: 'GitHub',
    changeRequest: 'Pull request',
    changeRequestNoun: 'pull request',
    changeRequestShort: 'PR',
    cli: 'GitHub CLI (gh)',
  },
  repo: 'acme/api',
  url: githubDetail.detail?.url as string,
  number: 7,
};

export function hostViewControl(
  target: Target,
  result: Wire,
  extra: readonly ControlSnapshot[] = [],
): ControlSnapshot[] {
  return [
    { channel: IPC.hostViewWindowTarget, response: target },
    { channel: IPC.hostViewChangeRequest, response: result },
    ...extra,
  ];
}

export function calls(control: ControlMockHandle, channel: string) {
  return control.log().filter((e) => e.channel === channel);
}

export interface IssueWire {
  kind: string;
  detail?: Record<string, unknown>;
  reason?: string;
}

type IssueTarget = {
  kind: string;
  url: string;
  provider: string;
  tracker: Record<string, string>;
  key: string;
};

// issue-view.json is written by issueview_test.go.
export const issueTarget = contract<IssueTarget>(
  'issue-view',
  'HostViewService.WindowTarget#issue',
);
export const issueOk = contract<IssueWire>('issue-view', 'HostViewService.Issue#ok');
export const issueFallback = contract<IssueWire>(
  'issue-view',
  'HostViewService.Issue#commentsFallback',
);
export const issueOmitted = contract<IssueWire>(
  'issue-view',
  'HostViewService.Issue#commentsOmitted',
);
export const issueGone = contract<IssueWire>('issue-view', 'HostViewService.Issue#gone');
export const issueUnauthenticated = contract<IssueWire>(
  'issue-view',
  'HostViewService.Issue#unauthenticated',
);

export function issueControl(
  result: IssueWire,
  extra: readonly ControlSnapshot[] = [],
): ControlSnapshot[] {
  return [
    { channel: IPC.hostViewWindowTarget, response: issueTarget },
    { channel: IPC.hostViewIssue, response: result },
    ...extra,
  ];
}
