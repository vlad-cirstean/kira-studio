import { setMessageDefaults } from '@theme/i18n';

// A unit spec renders catalog text with no app root to feed the agent names: call this in beforeAll
// to get the claude provider's wording.
export function useClaudeAgentText(): void {
  setMessageDefaults({
    agent: 'Claude',
    product: 'Claude Code',
    headless: 'claude -p',
    command: 'claude',
  });
}
