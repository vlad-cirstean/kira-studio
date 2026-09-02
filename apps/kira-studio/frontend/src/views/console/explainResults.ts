import type { QueryPlan } from './planModel';

// P18 (v1.1) D17: the plan-result sibling of resultPages.ts's own `pages` map — a plan is not a
// `Page` (ConsoleResult.kind distinguishes the two, state.ts), so it gets its own store rather
// than widening Page's union for one client-only shape. `statement` is the exact text that was
// explained, kept alongside the plan so the result view's header can show it without the caller
// threading it through a second prop.
export interface ExplainResult {
  plan: QueryPlan;
  statement: string;
}

const results = new Map<string, ExplainResult>();

export function setPlan(key: string, result: ExplainResult): void {
  results.set(key, result);
}

export function getPlan(key: string): ExplainResult | undefined {
  return results.get(key);
}

/** Mirrors resultPages.ts's `drop` — called unconditionally by state.ts's `releaseResult` for
 *  every closed result, a harmless no-op for a `kind: 'page'` result that was never in this map. */
export function dropPlan(key: string): void {
  results.delete(key);
}
