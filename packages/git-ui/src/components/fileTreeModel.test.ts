import { describe, expect, test } from 'bun:test';
import { fileIconFor } from './fileTreeModel.ts';

describe('fileIconFor', () => {
  test('json gets the named json glyph', () => {
    expect(fileIconFor('package.json')).toBe('codicon-json');
  });

  test('markdown gets the named markdown glyph', () => {
    expect(fileIconFor('docs/README.md')).toBe('codicon-markdown');
    expect(fileIconFor('CHANGES.markdown')).toBe('codicon-markdown');
  });

  test('pdf gets the pdf glyph', () => {
    expect(fileIconFor('report.pdf')).toBe('codicon-file-pdf');
  });

  test('media extensions get the media glyph', () => {
    expect(fileIconFor('logo.png')).toBe('codicon-file-media');
    expect(fileIconFor('clip.mp4')).toBe('codicon-file-media');
  });

  test('archive extensions get the zip glyph', () => {
    expect(fileIconFor('bundle.zip')).toBe('codicon-file-zip');
    expect(fileIconFor('archive.tar.gz')).toBe('codicon-file-zip');
  });

  test('binary extensions get the binary glyph', () => {
    expect(fileIconFor('lib.dll')).toBe('codicon-file-binary');
    expect(fileIconFor('app.wasm')).toBe('codicon-file-binary');
  });

  test('known source extensions get the one generic code glyph, not a per-language icon', () => {
    expect(fileIconFor('src/main.ts')).toBe('codicon-file-code');
    expect(fileIconFor('server.go')).toBe('codicon-file-code');
    expect(fileIconFor('style.css')).toBe('codicon-file-code');
  });

  test('an unrecognised extension falls back to the fully generic file glyph', () => {
    expect(fileIconFor('data.xyz123')).toBe('codicon-file');
  });

  test('a path with no extension falls back to the generic file glyph', () => {
    expect(fileIconFor('Makefile')).toBe('codicon-file');
    expect(fileIconFor('src/LICENSE')).toBe('codicon-file');
  });

  test('a dotfile with no extension after the leading dot is not mistaken for an extension', () => {
    expect(fileIconFor('.gitignore')).toBe('codicon-file');
  });
});
