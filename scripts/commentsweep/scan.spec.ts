import { expect, test } from 'bun:test';
import { codeDiff, comments } from './scan';

const slice = (text: string, r: { start: number; end: number }) =>
  Buffer.from(text).subarray(r.start, r.end).toString();

test('regex and template literals holding // are not comments', () => {
  const text = 'const a = /\\/\\/ no/; const t = `// no /* no */`; // yes\n/* b */ {\n}\n';
  expect(comments('x.ts', text).map((r) => slice(text, r))).toEqual(['// yes', '/* b */']);
});

test('Vue script setup and template comments map to whole-file byte offsets', () => {
  const text =
    '<template>\n  <!-- é tpl -->\n</template>\n<script setup lang="ts">\n// é line\nconst a = 1; /* b */\n</script>\n<style>/* css */</style>\n';
  const got = comments('x.vue', text).map((r) => [r.kind, slice(text, r)]);
  expect(got).toEqual([
    ['template', '<!-- é tpl -->'],
    ['line', '// é line'],
    ['block', '/* b */'],
  ]);
});

test('code diff passes a comment-only change and fails a code change', () => {
  expect(codeDiff('x.ts', 'const a = 1; // old\n', 'const a = 1; // new words\n')).toBe('');
  expect(codeDiff('x.ts', 'const a = 1; // old\n', 'const b = 1; // old\n')).not.toBe('');
  const vue = (c: string, code = '1') =>
    `<template><!-- ${c} --><b/></template>\n<script setup lang="ts">const a = ${code} // ${c}\n</script>\n`;
  expect(codeDiff('x.vue', vue('old'), vue('new'))).toBe('');
  expect(codeDiff('x.vue', vue('old'), vue('old', '2'))).not.toBe('');
});
