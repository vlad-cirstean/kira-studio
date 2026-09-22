import type { languages } from 'monaco-editor/editor/editor.api.js';

// P60a §4.2: a direct transliteration of `editor/languages.ts`'s `redisToken`/`RedisTokenState` —
// the first token of each `;`-separated statement colours as `keyword`; everything after it, up to
// the next `;`, is plain. `@rest` is `atCommand: false`; popping back to `root` on `;` restores
// `atCommand: true` exactly as `redisToken`'s own `state.atCommand = true` branch does.
export const redisMonarchLanguage: languages.IMonarchLanguage = {
  tokenizer: {
    root: [
      [/;/, 'delimiter'],
      [/'(?:[^'\\]|\\.)*'?/, 'string'],
      [/"(?:[^"\\]|\\.)*"?/, 'string'],
      [/\d+(?:\.\d+)?/, 'number'],
      [/[^\s'";]+/, { token: 'keyword', next: '@rest' }],
      [/\s+/, ''],
    ],
    rest: [
      [/;/, { token: 'delimiter', next: '@pop' }],
      [/'(?:[^'\\]|\\.)*'?/, 'string'],
      [/"(?:[^"\\]|\\.)*"?/, 'string'],
      [/\d+(?:\.\d+)?/, 'number'],
      [/[^\s'";]+/, ''],
      [/\s+/, ''],
    ],
  },
};
