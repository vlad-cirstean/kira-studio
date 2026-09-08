import { describe, expect, test } from 'bun:test';
import { fileIconFor } from './fileTreeModel.ts';

describe('fileIconFor — G21 D9 real per-extension/per-filename table', () => {
  test('exact filenames get their own glyph, precedence over the extension table', () => {
    // The item's own example: package.json is a package manifest, not "a json file" — the exact-
    // filename match must win over the json extension's own codicon-json.
    expect(fileIconFor('package.json')).toBe('codicon-package');
    expect(fileIconFor('bun.lock')).toBe('codicon-package');
    expect(fileIconFor('package-lock.json')).toBe('codicon-package');
    expect(fileIconFor('go.sum')).toBe('codicon-package');
    expect(fileIconFor('Cargo.lock')).toBe('codicon-package');
    expect(fileIconFor('LICENSE')).toBe('codicon-law');
    expect(fileIconFor('src/LICENSE')).toBe('codicon-law'); // matched on basename, any directory
    expect(fileIconFor('LICENCE')).toBe('codicon-law');
    expect(fileIconFor('COPYING')).toBe('codicon-law');
    expect(fileIconFor('Dockerfile')).toBe('codicon-vm');
    expect(fileIconFor('docker-compose.yml')).toBe('codicon-vm');
    expect(fileIconFor('Makefile')).toBe('codicon-tools');
    expect(fileIconFor('CMakeLists.txt')).toBe('codicon-tools');
    expect(fileIconFor('.gitignore')).toBe('codicon-source-control');
    expect(fileIconFor('.gitattributes')).toBe('codicon-source-control');
    expect(fileIconFor('.gitmodules')).toBe('codicon-source-control');
    expect(fileIconFor('.editorconfig')).toBe('codicon-gear');
    expect(fileIconFor('.npmrc')).toBe('codicon-gear');
    expect(fileIconFor('tsconfig.json')).toBe('codicon-gear');
    expect(fileIconFor('biome.json')).toBe('codicon-gear');
    expect(fileIconFor('.env')).toBe('codicon-gear');
  });

  test('a .github/workflows/ file gets the github-action glyph, ahead of its own extension', () => {
    expect(fileIconFor('.github/workflows/ci.yml')).toBe('codicon-github-action');
    // Not the same file anywhere else — the path-shape rule is anchored, not a bare substring
    // search for "workflows" anywhere in the path.
    expect(fileIconFor('docs/workflows/ci.yml')).not.toBe('codicon-github-action');
  });

  test('a *.test.* or *.spec.* file gets the beaker glyph, ahead of its own extension', () => {
    expect(fileIconFor('src/App.test.ts')).toBe('codicon-beaker');
    expect(fileIconFor('src/App.spec.tsx')).toBe('codicon-beaker');
    expect(fileIconFor('src/App.test.js')).toBe('codicon-beaker');
  });

  test('json gets the named json glyph', () => {
    expect(fileIconFor('src/data.json')).toBe('codicon-json');
    expect(fileIconFor('src/data.jsonc')).toBe('codicon-json');
  });

  test('markdown gets the named markdown glyph', () => {
    expect(fileIconFor('docs/README.md')).toBe('codicon-markdown');
    expect(fileIconFor('CHANGES.markdown')).toBe('codicon-markdown');
    expect(fileIconFor('docs/page.mdx')).toBe('codicon-markdown');
  });

  test('ruby extensions get the ruby glyph', () => {
    expect(fileIconFor('app/model.rb')).toBe('codicon-ruby');
    expect(fileIconFor('views/index.erb')).toBe('codicon-ruby');
    expect(fileIconFor('mygem.gemspec')).toBe('codicon-ruby');
  });

  test('database extensions get the database glyph', () => {
    expect(fileIconFor('schema.sql')).toBe('codicon-database');
    expect(fileIconFor('local.db')).toBe('codicon-database');
    expect(fileIconFor('cache.sqlite')).toBe('codicon-database');
  });

  test('config-shaped extensions get the gear glyph, same as the exact-filename config entries', () => {
    expect(fileIconFor('.github/ci.yml')).toBe('codicon-gear');
    expect(fileIconFor('values.yaml')).toBe('codicon-gear');
    expect(fileIconFor('pyproject.toml')).toBe('codicon-gear');
    expect(fileIconFor('app.ini')).toBe('codicon-gear');
    expect(fileIconFor('nginx.conf')).toBe('codicon-gear');
    expect(fileIconFor('webpack.cfg')).toBe('codicon-gear');
    expect(fileIconFor('settings.env')).toBe('codicon-gear');
  });

  test('shell extensions get the terminal-bash glyph', () => {
    expect(fileIconFor('build.sh')).toBe('codicon-terminal-bash');
    expect(fileIconFor('install.bash')).toBe('codicon-terminal-bash');
    expect(fileIconFor('profile.zsh')).toBe('codicon-terminal-bash');
  });

  test('ps1 gets the powershell glyph, bat/cmd get the cmd glyph', () => {
    expect(fileIconFor('deploy.ps1')).toBe('codicon-terminal-powershell');
    expect(fileIconFor('run.bat')).toBe('codicon-terminal-cmd');
    expect(fileIconFor('run.cmd')).toBe('codicon-terminal-cmd');
  });

  test('ipynb gets the notebook glyph', () => {
    expect(fileIconFor('analysis.ipynb')).toBe('codicon-notebook');
  });

  test('key/cert extensions get the key glyph', () => {
    expect(fileIconFor('server.pem')).toBe('codicon-key');
    expect(fileIconFor('private.key')).toBe('codicon-key');
    expect(fileIconFor('server.crt')).toBe('codicon-key');
  });

  test('plain-text extensions get the file-text glyph', () => {
    expect(fileIconFor('notes.txt')).toBe('codicon-file-text');
    expect(fileIconFor('CHANGES.rst')).toBe('codicon-file-text');
    expect(fileIconFor('guide.adoc')).toBe('codicon-file-text');
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

  test('genuine source extensions get the one generic code glyph, not a per-language icon', () => {
    // F9's own stated ceiling: codicons have no per-language file-icon vocabulary, so every one
    // of these — deliberately still distinct languages — lands on the identical glyph.
    expect(fileIconFor('src/main.ts')).toBe('codicon-file-code');
    expect(fileIconFor('server.go')).toBe('codicon-file-code');
    expect(fileIconFor('style.css')).toBe('codicon-file-code');
    expect(fileIconFor('Main.java')).toBe('codicon-file-code');
    expect(fileIconFor('lib.rs')).toBe('codicon-file-code');
    expect(fileIconFor('App.vue')).toBe('codicon-file-code');
  });

  test('an unrecognised extension falls back to the fully generic file glyph', () => {
    expect(fileIconFor('data.xyz123')).toBe('codicon-file');
  });

  test('a path with no extension and no exact-filename/path-shape match falls back to the generic file glyph', () => {
    expect(fileIconFor('README')).toBe('codicon-file');
  });

  test('a dotfile with no extension after the leading dot, and no exact-filename match, falls back to the generic file glyph', () => {
    expect(fileIconFor('.env.local')).toBe('codicon-file'); // not an exact match, not a known extension
  });
});
