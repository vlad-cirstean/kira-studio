// P2 R2 (task #99): views/shared/document/rows.ts's parseRow() used to compute a document row's
// byteLabel by re-encoding the already-decoded `body` string with `new TextEncoder()` just to read
// its `.length` — a redundant decode-then-reencode round trip. The fix reads the byte length
// straight from the wire's own chunk offsets (`cellByteLength`, threaded through documentRow()).
// This is the regression case that would fail silently under a naive `body.length` shortcut: a
// multi-byte UTF-8 character's *byte* length differs from its UTF-16 string length, so a body
// containing one lets a wrong byte count slip through undetected by anything that just checks
// "some number came back".
import { describe, expect, test } from 'bun:test';
import { createDocumentPageBuilder, unpagedPosition } from '@shared/protocol/page';

const documentsPage = await import('../../apps/kira-studio/frontend/src/views/documents/page');
const { registerDocumentRows, rowView, unregisterDocumentRows, resetRows } = await import(
  '../../apps/kira-studio/frontend/src/views/shared/document/rows'
);

describe('document byteLabel (P2 R2 #99)', () => {
  test('1. byteLabel reflects the raw UTF-8 byte length, not the UTF-16 string length', () => {
    // '𝌆' (U+1D306, a 4-byte UTF-8 / 2-UTF-16-code-unit character) repeated so the gap between
    // "string length" and "byte length" is large enough to catch a wrong formula, not just an
    // off-by-one.
    const body = `{"v":"${'𝌆'.repeat(50)}"}`;
    const expectedBytes = new TextEncoder().encode(body).length;
    // Sanity check the fixture actually exercises the gap this test is for.
    expect(expectedBytes).not.toBe(body.length);

    const tabId = 'byte-label-test-tab';
    const builder = createDocumentPageBuilder();
    builder.push('{"$oid":"abc"}', body);
    const page = builder.finish(unpagedPosition(1));
    documentsPage.setPage(tabId, page);
    registerDocumentRows(tabId, (row) => documentsPage.documentRow(tabId, row));

    try {
      const view = rowView(tabId, 0);
      expect(view?.byteLabel).toBe(`${expectedBytes} bytes`);
    } finally {
      unregisterDocumentRows(tabId);
      resetRows(tabId);
    }
  });

  test('2. an ASCII-only body has an identical byte and string length (the common case stays correct)', () => {
    const body = '{"v":"plain"}';
    const tabId = 'byte-label-test-tab-ascii';
    const builder = createDocumentPageBuilder();
    builder.push('{"$oid":"def"}', body);
    const page = builder.finish(unpagedPosition(1));
    documentsPage.setPage(tabId, page);
    registerDocumentRows(tabId, (row) => documentsPage.documentRow(tabId, row));

    try {
      const view = rowView(tabId, 0);
      expect(view?.byteLabel).toBe(`${body.length} bytes`);
    } finally {
      unregisterDocumentRows(tabId);
      resetRows(tabId);
    }
  });
});
