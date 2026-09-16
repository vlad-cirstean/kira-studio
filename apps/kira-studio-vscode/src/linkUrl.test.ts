import { describe, expect, test } from 'bun:test';
import { isValidExternalLinkUrl } from './linkUrl.ts';

describe('isValidExternalLinkUrl', () => {
  test('accepts a well-formed https URL', () => {
    expect(isValidExternalLinkUrl('https://example.com/some/page')).toBe(true);
  });

  test('accepts a well-formed http URL', () => {
    expect(isValidExternalLinkUrl('http://example.com/some/page')).toBe(true);
  });

  test('rejects a javascript scheme', () => {
    expect(isValidExternalLinkUrl('javascript:alert(1)')).toBe(false);
  });

  test('rejects a file scheme', () => {
    expect(isValidExternalLinkUrl('file:///etc/passwd')).toBe(false);
  });

  test('rejects an unparseable URL', () => {
    expect(isValidExternalLinkUrl('not a url')).toBe(false);
  });
});
