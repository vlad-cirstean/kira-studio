// Mirrors claudemodel.Aliases.
export const CLAUDE_MODELS = ['haiku', 'sonnet', 'opus'] as const;
export type ClaudeModel = (typeof CLAUDE_MODELS)[number];
export const DEFAULT_CLAUDE_MODEL: ClaudeModel = 'sonnet';
