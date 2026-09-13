// C5 §9.4: the extension-to-language map, shared by the tree row icon (RepoTreeRow.vue's own
// small five-bucket lookup is a different, coarser purpose — a glance icon, not a Monaco language
// id) and RepoFileView.vue's model creation — one file, one vocabulary, so the two can never
// disagree about what a given path colors as. Deliberately does NOT import codeindex's own Go-side
// extension table (§9.4's own reasoning: parse coverage and coloring coverage are different sets
// for different purposes; pretending otherwise would drag one to the other's shape).
//
// Registered Monarch contributions (monacoEntry.ts's own import list) plus the two named
// exceptions D9 states: JSON colors via the JavaScript grammar (Monaco ships no JSON basic-
// language; the JS Monarch definition is a superset that colors strings/numbers/punctuation
// correctly), and `.vue`/`.svelte` color via the HTML grammar (no Monaco grammar exists for
// either — a `<script>` block therefore colors as HTML text, not TypeScript; the alternative is a
// hand-written SFC Monarch, which CLAUDE.md's library-first rule declines). Anything else falls
// back to 'plaintext'.
const EXTENSION_LANGUAGE: Readonly<Record<string, string>> = {
  ts: 'typescript',
  tsx: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  vue: 'html',
  svelte: 'html',
  json: 'json',
  jsonc: 'json',
  java: 'java',
  py: 'python',
  go: 'go',
  rs: 'rust',
  html: 'html',
  htm: 'html',
  css: 'css',
  scss: 'scss',
  less: 'less',
  md: 'markdown',
  markdown: 'markdown',
  yaml: 'yaml',
  yml: 'yaml',
  xml: 'xml',
  sh: 'shell',
  bash: 'shell',
  zsh: 'shell',
  sql: 'sql',
  ini: 'ini',
  cfg: 'ini',
  toml: 'ini',
  graphql: 'graphql',
  gql: 'graphql',
  proto: 'protobuf',
};

// Dockerfile has no extension — matched by basename, mirroring internal/codeworkspace/files.go's
// own languageFor.
const BASENAME_LANGUAGE: Readonly<Record<string, string>> = {
  dockerfile: 'dockerfile',
};

/** The Monaco language id for `path` — the extension only, never sniffed. */
export function monacoLanguageFor(path: string): string {
  const slash = path.lastIndexOf('/');
  const name = (slash < 0 ? path : path.slice(slash + 1)).toLowerCase();
  const byName = BASENAME_LANGUAGE[name];
  if (byName) return byName;
  const dot = name.lastIndexOf('.');
  if (dot < 0) return 'plaintext';
  const ext = name.slice(dot + 1);
  return EXTENSION_LANGUAGE[ext] ?? 'plaintext';
}
