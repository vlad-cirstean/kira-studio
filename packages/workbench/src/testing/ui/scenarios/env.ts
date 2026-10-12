import type { Page } from '@playwright/test';
import type { createContract } from '../contract';
import type { UiFixturesOptions } from '../fixtures';
import type { ControlMockHandle, ControlSnapshot } from '../mockRuntime';

// What a shared scenario needs from an app: its `test`, its IPC channel map and its contract loader.
export interface ScenarioFixtures {
  relaunch: (
    options?: UiFixturesOptions & { control?: readonly ControlSnapshot[] },
  ) => Promise<{ window: Page; control: ControlMockHandle }>;
}

export type ScenarioTest = (
  title: string,
  body: (fixtures: ScenarioFixtures) => Promise<void>,
) => void;

export interface ScenarioEnv<K extends string> {
  test: ScenarioTest;
  ipc: Record<K, string>;
  contract: ReturnType<typeof createContract>;
}
