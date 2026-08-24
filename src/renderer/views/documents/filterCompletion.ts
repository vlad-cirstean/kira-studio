// P18 D9: candidate lists for DocumentView.vue's filter/SORT boxes.
import type { Completion } from '../../theme/primitives/completion';
import { MONGO_QUERY_OPERATORS } from '../shared/mongoVocabulary';
import { fieldNamesOnPage } from './docPage';

// Mirrors engine/adapters/mongo/literal.ts's own bare-identifier tokenizer rule exactly — a field
// outside it must be quoted to parse as a filter/sort-document key.
const BARE_SAFE_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

function fieldNames(tabId: string): string[] {
  // fieldNamesOnPage deliberately excludes _id ("it is always returned regardless of projection
  // ... so it is never a real projection choice") — correct for the projection picker it was
  // written for, wrong here: _id is the single most-filtered Mongo field.
  return ['_id', ...fieldNamesOnPage(tabId)];
}

// The trailing ": " is the one place an insertion usefully exceeds its label — a filter/sort
// document is always `key: value`.
function fieldInsertion(name: string): string {
  return BARE_SAFE_RE.test(name) ? `${name}: ` : `'${name.replace(/'/g, "\\'")}': `;
}

function fieldCompletions(tabId: string): Completion[] {
  return fieldNames(tabId).map((name) => ({
    label: name,
    insert: fieldInsertion(name),
    detail: 'field',
    icon: 'symbol-field',
  }));
}

export function mongoFilterCandidates(tabId: string): Completion[] {
  const operators = MONGO_QUERY_OPERATORS.map((label) => ({
    label,
    detail: 'operator',
    icon: 'symbol-operator',
  }));
  return [...fieldCompletions(tabId), ...operators];
}

// The sort box's own key: value grammar (DocumentView.vue's parseSortText) supplies the rest —
// bare field names only, no operators (a sort document has no use for one).
export function mongoSortCandidates(tabId: string): Completion[] {
  return fieldCompletions(tabId);
}
