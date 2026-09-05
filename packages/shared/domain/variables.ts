// P5 D20: the TypeScript mirrors of Go's model.Variable/model.Environment/model.VariableHistoryEntry
// and apivars.RevealResult. Following P2 D5's rule — "the wire shapes live in Go and are
// mirrored, not re-validated" — these are types, not guards; control.ts `trust<T>()`s them like
// every other bound result. Nothing here becomes tab state (unlike httpSavedRequestSchema in
// collections.ts), so none of it earns the one Zod-parse boundary that file's own comment explains.
//
// P12 D3: Http* → Api* — a variable is resolved for both protocols (Api* names the module).

export const VARIABLE_SCOPES = ['collection', 'environment'] as const;
export type VariableScope = (typeof VARIABLE_SCOPES)[number];

// D12: the row model, deliberately without `enabled` or `type` — see the plan's own table for why
// each is left out. `value` is '' whenever `isSecret` — a secret's plaintext never crosses the
// bridge except through the gated Reveal (D5). `description` is P17 D14 — a plain field, not a
// secret, added alongside the four already here.
export interface ApiVariable {
  id: string;
  scope: VariableScope;
  ownerId: string;
  name: string;
  value: string;
  isSecret: boolean;
  sortOrder: number;
  description: string;
}

// D3: the active environment is app-global, a column on the row itself rather than a layout leaf
// or a settings key. `description` is P17 D14 — app-local free text, no Postman round-trip
// question at all (unlike a variable's, F10).
export interface ApiEnvironment {
  id: string;
  name: string;
  sortOrder: number;
  isActive: boolean;
  description: string;
}

// D13: history is per-entry — an environment has no history of its own, only its entries do.
export interface ApiVariableHistoryEntry {
  id: string;
  variableId: string;
  value: string;
  isSecret: boolean;
  recordedAt: string;
}

// P17 D21/D22/D23: one line of a parsed `.env` bulk edit — the wire mirror of
// api-core's own dotenv.ts#EnvEntry, carried across the bridge to VariablesRepo.ApplyBulk.
// hasValue is false for a bare `KEY=` line (D22 rule 3).
export interface ApiVariableBulkEntry {
  name: string;
  value: string;
  hasValue: boolean;
  description: string;
}

// ApplyBulk's own answer — the same counts the renderer's own reconcileEnv already computed
// locally for its live summary (§4's guard that the two reconciles agree).
export interface ApiVariableBulkResult {
  added: number;
  updated: number;
  removed: number;
  reordered: boolean;
}

// D8: the same four-outcome vocabulary v1.1 P14 already established for connections.RevealResult,
// redeclared here rather than shared — importing internal/connections from internal/apivars would
// be exactly the Studio<->Api coupling this app's module-boundary rule exists to prevent.
export type RevealOutcome = 'revealed' | 'cancelled' | 'confirmation-required' | 'error';

export interface RevealResult {
  value: string | null;
  error: string | null;
  outcome: RevealOutcome;
}
