import type { languages } from 'monaco-editor/editor/editor.api.js';

// P60a §4.2: a direct transliteration of `editor/languages.ts`'s `mongoToken`/`MongoTokenState` —
// the `afterDot` flag (an identifier right after `.` colours as a property, not a bare variable)
// becomes the `@property` sub-state below, popped back to `root` on the very next token exactly as
// `mongoToken` resets `state.afterDot = false` on every branch but the dot itself.
export const mongoMonarchLanguage: languages.IMonarchLanguage = {
  tokenizer: {
    root: [
      [/\/\/.*$/, 'comment'],
      [/'(?:[^'\\]|\\.)*'?/, 'string'],
      [/"(?:[^"\\]|\\.)*"?/, 'string'],
      [/\d+(?:\.\d+)?/, 'number'],
      [/\$[A-Za-z_]\w*/, 'operator'],
      [/\./, { token: 'delimiter', next: '@property' }],
      [/[[\](){}]/, 'delimiter.bracket'],
      [/[,:]/, 'delimiter'],
      [/db\b/, 'keyword'],
      [/[A-Za-z_]\w*/, 'variable'],
      [/\s+/, ''],
    ],
    property: [
      [/[A-Za-z_]\w*/, { token: 'variable.name', next: '@pop' }],
      [/\s+/, ''],
      ['', '', '@pop'],
    ],
  },
};
