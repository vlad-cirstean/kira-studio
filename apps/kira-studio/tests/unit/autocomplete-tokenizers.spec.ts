// P15b D3(b): wholeFieldToken and templateToken are pure, DOM-free tokenizers behind
// AutocompleteField.vue — completion.ts is app-side (theme/primitives/), so this lives here rather
// than in packages/api-core/test.
import { describe, expect, test } from 'bun:test';
import { templateToken, wholeFieldToken } from '../../frontend/src/theme/primitives/completion';

describe('wholeFieldToken (item 7 — F1: Content-T must not become Content-Content-Type)', () => {
  test('a hyphenated header name is one token, trimmed', () => {
    expect(wholeFieldToken('Content-T', 9)).toEqual({ from: 0, to: 9, word: 'Content-T' });
  });

  test('leading/trailing whitespace is trimmed for the match, but the replace range is the whole field', () => {
    expect(wholeFieldToken('  Content-T  ', 5)).toEqual({
      from: 0,
      to: 13,
      word: 'Content-T',
    });
  });

  test('the caret position does not affect the token — any caret means "the whole field"', () => {
    expect(wholeFieldToken('Content-Type', 0)).toEqual({
      from: 0,
      to: 12,
      word: 'Content-Type',
    });
  });

  test('an empty field is an empty token', () => {
    expect(wholeFieldToken('', 0)).toEqual({ from: 0, to: 0, word: '' });
  });
});

describe('templateToken (item 10 — the {{variable}} completion popup only opens inside a reference)', () => {
  test('the caret just after an unclosed {{ is inside a reference, with an empty word', () => {
    expect(templateToken('{{', 2)).toEqual({ from: 2, to: 2, word: '' });
  });

  test('the caret mid-name inside an unclosed reference', () => {
    expect(templateToken('{{ba', 4)).toEqual({ from: 2, to: 4, word: 'ba' });
  });

  test('the caret before any {{ is not inside a reference', () => {
    expect(templateToken('plain text', 5)).toBeNull();
  });

  test('the caret after a closed reference is not inside it any more', () => {
    expect(templateToken('{{name}}', 8)).toBeNull();
  });

  test('the caret inside a closed reference IS still inside it — only text after the caret matters', () => {
    // "Unclosed" is decided from the text *before* the caret only (substitute.ts's own grammar
    // reads forward from `{{`, but this tokenizer's job is "what should the popup match right
    // now", which only cares what has been typed so far).
    expect(templateToken('{{na', 4)).toEqual({ from: 2, to: 4, word: 'na' });
  });

  test('an earlier closed reference does not leak into a later, still-open one', () => {
    expect(templateToken('{{a}}xxx{{b', 11)).toEqual({ from: 10, to: 11, word: 'b' });
  });

  test('the caret right after a {{ that immediately follows a closed reference is empty, not null', () => {
    expect(templateToken('{{a}}{{', 7)).toEqual({ from: 7, to: 7, word: '' });
  });
});
