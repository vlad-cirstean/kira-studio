// P5 D20: the TypeScript mirrors of Go's model.Variable/model.Environment/model.VariableHistoryEntry
// and httpvars.RevealResult. Following P2 D5's rule — "the wire shapes live in Go and are
// mirrored, not re-validated" — these are types, not guards; control.ts `trust<T>()`s them like
// every other bound result. Nothing here becomes tab state (unlike httpSavedRequestSchema in
// collections.ts), so none of it earns the one Zod-parse boundary that file's own comment explains.

export const VARIABLE_SCOPES = ['collection', 'environment'] as const;
export type VariableScope = (typeof VARIABLE_SCOPES)[number];

// D12: the row model, deliberately without `enabled`, `description` or `type` — see the plan's own
// table for why each is left out. `value` is '' whenever `isSecret` — a secret's plaintext never
// crosses the bridge except through the gated Reveal (D5).
export interface HttpVariable {
  id: string;
  scope: VariableScope;
  ownerId: string;
  name: string;
  value: string;
  isSecret: boolean;
  sortOrder: number;
}

// D3: the active environment is app-global, a column on the row itself rather than a layout leaf
// or a settings key.
export interface HttpEnvironment {
  id: string;
  name: string;
  sortOrder: number;
  isActive: boolean;
}

// D13: history is per-entry — an environment has no history of its own, only its entries do.
export interface HttpVariableHistoryEntry {
  id: string;
  variableId: string;
  value: string;
  isSecret: boolean;
  recordedAt: string;
}

// D8: the same four-outcome vocabulary v1.1 P14 already established for connections.RevealResult,
// redeclared here rather than shared — importing internal/connections from internal/httpvars would
// be exactly the Studio<->Http coupling this app's module-boundary rule exists to prevent.
export type RevealOutcome = 'revealed' | 'cancelled' | 'confirmation-required' | 'error';

export interface RevealResult {
  value: string | null;
  error: string | null;
  outcome: RevealOutcome;
}
