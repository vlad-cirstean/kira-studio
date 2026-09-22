import { describe, expect, test } from 'bun:test';
import { isValidPrBrowserUrl } from './prUrl.ts';

describe('isValidPrBrowserUrl', () => {
  test('accepts a well-formed github.com pull-request URL', () => {
    expect(isValidPrBrowserUrl('https://github.com/owner/repo/pull/42')).toBe(true);
  });

  test('accepts a well-formed GHES pull-request URL', () => {
    expect(isValidPrBrowserUrl('https://ghe.example.com/owner/repo/pull/42')).toBe(true);
  });

  test('rejects a non-https scheme', () => {
    expect(isValidPrBrowserUrl('http://github.com/owner/repo/pull/42')).toBe(false);
    expect(isValidPrBrowserUrl('javascript:alert(1)')).toBe(false);
  });

  test('rejects a non-pull-request path', () => {
    expect(isValidPrBrowserUrl('https://github.com/owner/repo/issues/42')).toBe(false);
  });

  test('rejects an unparseable URL', () => {
    expect(isValidPrBrowserUrl('not a url')).toBe(false);
  });
});
