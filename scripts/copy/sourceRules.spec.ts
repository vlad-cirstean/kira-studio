import { describe, expect, test } from 'bun:test';
import { applyAllowlist, failingFiles, parseAllowlist } from './allowlist';
import { type MessageShape, type SourceRule, scanSource } from './sourceRules';

const messages = new Map<string, MessageShape>([
  ['a.greet.label', { placeholders: new Set(['name']), plural: false }],
  ['a.files.label', { placeholders: new Set(['count']), plural: true }],
  ['a.plain.label', { placeholders: new Set(), plural: false }],
]);

function rules(file: string, source: string): SourceRule[] {
  return scanSource(file, source, { messages }).map((h) => h.rule);
}

/** Literal `${`, built apart so lint does not mistake the fixtures for broken templates. */
const D = '$';

const vue = (template: string, script = '') =>
  `<script setup lang="ts">\nimport { t } from '@theme/i18n';\n${script}\n</script>\n<template>\n${template}\n</template>\n`;

describe('U64 template text', () => {
  test('flags literal text, not interpolation, symbols or catalog calls', () => {
    expect(rules('a.vue', vue('<button>Save</button>'))).toEqual(['U64']);
    expect(rules('a.vue', vue("<button>{{ t('a.plain.label') }}</button>"))).toEqual([]);
    expect(rules('a.vue', vue('<span>×</span><span>·</span>'))).toEqual([]);
    expect(rules('a.vue', vue('<span>{{ n }}</span>'))).toEqual([]);
  });
  test('code and kbd are exempt only inside a CatalogText slot', () => {
    const slot =
      '<CatalogText k="x"><template #path><code>src/a.ts</code></template></CatalogText>';
    expect(rules('a.vue', vue(slot))).toEqual([]);
    expect(rules('a.vue', vue('<code>src/a.ts</code>'))).toEqual(['U64']);
    expect(
      rules(
        'a.vue',
        vue('<CatalogText k="x"><template #path><b>word</b></template></CatalogText>'),
      ),
    ).toEqual(['U64']);
  });
  test('reports the file line', () => {
    const [hit] = scanSource('a.vue', vue('<div>\n  <i>Hi</i>\n</div>'), { messages });
    expect(hit?.line).toBe(7);
  });
});

describe('U65 static text attributes', () => {
  test('flags the text attribute set and suffixes', () => {
    expect(rules('a.vue', vue('<Foo title="Open" />'))).toEqual(['U65']);
    expect(rules('a.vue', vue('<Foo aria-label="Close" placeholder="Search" />'))).toEqual([
      'U65',
      'U65',
    ]);
    expect(rules('a.vue', vue('<Foo empty-text="Nothing" />'))).toEqual(['U65']);
    expect(
      rules('a.vue', vue('<Foo data-label="x" data-testid="save-button" variant="ghost" />')),
    ).toEqual([]);
    expect(rules('a.vue', vue('<Foo title="" />'))).toEqual([]);
  });
});

describe('U66 template expression literals', () => {
  test('flags literals with a space or a capital', () => {
    expect(rules('a.vue', vue('<b>{{ ok ? "Done" :\n "Not yet" }}</b>'))).toEqual(['U66', 'U66']);
    expect(rules('a.vue', vue('<Foo :aria-label="open ? \'Close menu\' : label" />'))).toEqual([
      'U66',
    ]);
    expect(rules('a.vue', vue(`<b>{{ \`${D}{n} items\` }}</b>`))).toEqual(['U66']);
  });
  test('passes keys, comparisons, separators and non-text bindings', () => {
    expect(rules('a.vue', vue("<b>{{ t('a.plain.label') }}</b>"))).toEqual([]);
    expect(rules('a.vue', vue("<b>{{ kind === 'Mixed Case' ? a : b }}</b>"))).toEqual([]);
    expect(rules('a.vue', vue("<b>{{ list.join(', ') }}</b>"))).toEqual([]);
    expect(rules('a.vue', vue("<b>{{ map['Some Key'] }}</b>"))).toEqual([]);
    expect(rules('a.vue', vue("<b>{{ { 'Odd Key': 1 } }}</b>"))).toEqual([]);
    expect(rules('a.vue', vue("<Foo :variant=\"x ? 'Big Thing' : 'b'\" />"))).toEqual([]);
    expect(rules('a.vue', vue("<Foo :class=\"x ? 'a b' : 'c'\" />"))).toEqual([]);
    expect(rules('a.vue', vue('<Foo :label="t(\'a.plain.label\')" :title="id" />'))).toEqual([]);
  });
});

describe('U67 text properties and sinks in TypeScript', () => {
  test('flags text-property literals', () => {
    expect(rules('a.ts', "export const m = { label: 'Delete connection' };")).toEqual(['U67']);
    expect(rules('a.ts', "export const m = { title: 'Open', other: 'Free Text' };")).toEqual([
      'U67',
    ]);
    expect(rules('a.ts', `export const m = { tooltip: ok ? \`Copy ${D}{n}\` : "Copy" };`)).toEqual([
      'U67',
    ]);
    expect(rules('a.vue', vue('', "const rows = [{ message: 'Could not load' }];"))).toEqual([
      'U67',
    ]);
  });
  test('passes enum tokens, keys and catalog values', () => {
    expect(rules('a.ts', "export const m = { label: 'idle', kind: 'Some Kind' };")).toEqual([]);
    expect(rules('a.ts', "export const f = () => ({ label: t('a.plain.label') });")).toEqual([]);
    expect(rules('a.ts', "export const f = () => ({ label: t('a.plain.label') });")).toEqual([]);
    expect(rules('a.ts', "type T = { label: 'A b' };")).toEqual([]);
  });
  test('flags sink arguments and new Error with a capital', () => {
    expect(rules('a.ts', "announce('Saved the file');")).toEqual(['U67']);
    expect(rules('a.ts', "reportAsyncError(err, 'Couldn’t save');")).toEqual(['U67']);
    expect(rules('a.ts', "throw new Error('Something broke');")).toEqual(['U67']);
    expect(rules('a.ts', "throw new Error('fn: bad input');")).toEqual([]);
    expect(rules('a.ts', "export const f = () => announce(t('a.plain.label'));")).toEqual([]);
    expect(rules('a.ts', "confirm({ message: 'Delete it?', confirmLabel: 'Delete' });")).toEqual([
      'U67',
      'U67',
    ]);
  });
  test('flags state assignment of sentences only', () => {
    expect(rules('a.ts', "status.value = 'Waiting for input';")).toEqual(['U67']);
    expect(rules('a.ts', "state.note = 'Loading data';")).toEqual(['U67']);
    expect(rules('a.ts', "status.value = 'idle';")).toEqual([]);
    expect(rules('a.ts', "status.value = 'Idle';")).toEqual([]);
  });
});

describe('U68 vue-i18n outside the runtime', () => {
  test('flags every entry point', () => {
    expect(rules('a.ts', "import { useI18n } from 'vue-i18n';\nuseI18n();")).toEqual([
      'U68',
      'U68',
    ]);
    expect(rules('a.ts', "i18n.global.t('x');")).toEqual(['U68']);
    expect(rules('a.vue', vue('<b>{{ $t("x") }}</b>'))).toEqual(['U68']);
    expect(rules('a.vue', vue('<i18n-t keypath="x" />'))).toEqual(['U68']);
    expect(rules('a.vue', vue('<Translation keypath="x" />'))).toEqual(['U68']);
  });
});

describe('U69 composition', () => {
  test('flags concatenation, mixed template literals, plural and copyAnnounced words', () => {
    expect(rules('a.ts', "export const f = () => t('a.plain.label') + ' now';")).toEqual(['U69']);
    expect(rules('a.ts', `export const f = () => \`${D}{t('a.plain.label')} and more\`;`)).toEqual([
      'U69',
    ]);
    expect(rules('a.ts', 'export const f = () => plural(n, "file");')).toEqual(['U69']);
    expect(rules('a.ts', "copyAnnounced(text, 'name');")).toEqual(['U69']);
    expect(
      rules('a.ts', "export const f = () => copyAnnounced(text, t('a.plain.label'));"),
    ).toEqual([]);
    expect(rules('a.ts', `export const f = () => \`${D}{t('a.plain.label')}\`;`)).toEqual([]);
  });
});

describe('U70 module scope', () => {
  test('flags t() outside any function in modules and plain script blocks', () => {
    expect(rules('a.ts', "export const label = t('a.plain.label');")).toEqual(['U70']);
    expect(rules('a.ts', "export const f = () => t('a.plain.label');")).toEqual([]);
    expect(rules('a.ts', "export class C { m() { return t('a.plain.label'); } }")).toEqual([]);
    expect(
      rules(
        'a.vue',
        '<script lang="ts">\nexport const x = t(\'a.plain.label\');\n</script>\n<template><i /></template>',
      ),
    ).toEqual(['U70']);
  });
  test('script setup top level runs per instance and passes', () => {
    expect(rules('a.vue', vue('<i />', "const label = t('a.plain.label');"))).toEqual([]);
  });
});

describe('U71 call-site params', () => {
  test('matching params pass', () => {
    expect(
      rules('a.ts', "export const f = (name: string) => t('a.greet.label', { name });"),
    ).toEqual([]);
    expect(
      rules('a.ts', "export const f = (n: number) => t('a.files.label', { count: n });"),
    ).toEqual([]);
    expect(rules('a.ts', "export const f = () => t('a.plain.label');")).toEqual([]);
  });
  test('missing, extra and absent params fail', () => {
    expect(rules('a.ts', "export const f = () => t('a.greet.label');")).toEqual(['U71']);
    expect(
      rules('a.ts', "export const f = (n: string) => t('a.greet.label', { who: n });"),
    ).toEqual(['U71']);
    expect(rules('a.ts', "export const f = () => t('a.plain.label', { name: 'x' });")).toEqual([
      'U71',
    ]);
  });
  test('plural message needs count', () => {
    expect(rules('a.ts', "export const f = () => t('a.files.label', { n: 1 });")).toEqual(['U71']);
    expect(rules('a.ts', "export const f = () => t('a.files.label');")).toEqual(['U71']);
  });
  test('spread, dynamic keys and unknown keys are skipped', () => {
    expect(rules('a.ts', "export const f = (p: object) => t('a.greet.label', { ...p });")).toEqual(
      [],
    );
    expect(rules('a.ts', 'export const f = (k: never) => t(k, { x: 1 });')).toEqual([]);
    expect(rules('a.ts', "export const f = () => t('x.unknown.label', { x: 1 });")).toEqual([]);
  });
  test('works in template expressions', () => {
    expect(rules('a.vue', vue("<b>{{ t('a.greet.label') }}</b>"))).toEqual(['U71']);
    expect(rules('a.vue', vue("<b>{{ t('a.greet.label', { name }) }}</b>"))).toEqual([]);
  });
});

describe('allowlist', () => {
  const hits = [
    { file: 'a.vue', line: 1, rule: 'U64' as const, message: '' },
    { file: 'a.vue', line: 2, rule: 'U67' as const, message: '' },
    { file: 'b.ts', line: 1, rule: 'U66' as const, message: '' },
  ];
  test('parses both forms, comments and blanks', () => {
    const { entries, errors } = parseAllowlist(
      '# header\n\na.vue\npermanent U66 b.ts # font names\n',
      'x.txt',
    );
    expect(errors).toEqual([]);
    expect(entries.map((e) => e.kind)).toEqual(['file', 'permanent']);
  });
  test('rejects a permanent line without reason, bad rule, extra words and duplicates', () => {
    const { errors } = parseAllowlist(
      'permanent U66 b.ts\npermanent U99 b.ts # x\na.vue b.ts\nc.ts\nc.ts\n',
      'x.txt',
    );
    expect(errors).toHaveLength(4);
  });
  test('whole-file entry exempts every rule of the file', () => {
    const { entries } = parseAllowlist('a.vue\n', 'x.txt');
    const out = applyAllowlist(hits, entries);
    expect(out.remaining.map((h) => h.file)).toEqual(['b.ts']);
    expect(out.errors).toEqual([]);
  });
  test('permanent entry exempts one rule only', () => {
    const { entries } = parseAllowlist('permanent U64 a.vue # engine text\n', 'x.txt');
    expect(applyAllowlist(hits, entries).remaining.map((h) => h.rule)).toEqual(['U67', 'U66']);
  });
  test('an entry with no hit left is stale', () => {
    const { entries } = parseAllowlist('gone.vue\npermanent U69 a.vue # x\n', 'x.txt');
    expect(applyAllowlist(hits, entries).errors).toHaveLength(2);
  });
  test('failingFiles ignores whole-file entries', () => {
    const { entries } = parseAllowlist('a.vue\npermanent U66 b.ts # x\n', 'x.txt');
    expect(failingFiles(hits, entries)).toEqual(['a.vue']);
  });
});
