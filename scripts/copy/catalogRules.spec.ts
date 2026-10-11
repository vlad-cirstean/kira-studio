import { describe, expect, test } from 'bun:test';
import {
  checkCatalog,
  flattenCatalog,
  isCovered,
  nearForm,
  roleOf,
  ruleC1,
  ruleC2,
  ruleC3C4,
  ruleC5,
  ruleC6,
  ruleC7,
  ruleC8,
  ruleC9,
  ruleC10,
} from './catalogRules';

const msgs = (v: { rule: string; message: string }[]) => v.map((x) => x.rule);

describe('C1 message syntax', () => {
  test('accepts placeholders, plural and the literal @ form', () => {
    expect(ruleC1('a.b.label', 'Open {name}')).toEqual([]);
    expect(ruleC1('a.b.label', "mail{'@'}host")).toEqual([]);
    expect(ruleC1('a.b.label', '{count} item | {count} items')).toEqual([]);
  });
  test('rejects a stray @ and unbalanced braces', () => {
    expect(msgs(ruleC1('a.b.label', 'a@b'))).toContain('C1');
    expect(msgs(ruleC1('a.b.label', 'open {name'))).toContain('C1');
    expect(msgs(ruleC1('a.b.label', 'open name}'))).toContain('C1');
    expect(msgs(ruleC1('a.b.label', 'open {{name}}'))).toContain('C1');
  });
});

describe('C2 key shape and role', () => {
  test('role resolves from leaf or prefix override', () => {
    expect(roleOf('studio.x.y.label')).toBe('label');
    expect(roleOf('common.state.loading')).toBe('loading');
    expect(roleOf('common.state.noMatches')).toBe('status');
    expect(roleOf('format.relative.justNow')).toBe('format');
    expect(roleOf('studio.x.y.thing')).toBeUndefined();
  });
  test('depth, camelCase and role', () => {
    expect(ruleC2('studio.x.label')).toEqual([]);
    expect(ruleC2('studio.label')).toHaveLength(1);
    expect(ruleC2('studio.a.b.c.d.e.label')).toHaveLength(1);
    expect(ruleC2('studio.Bad_seg.label').length).toBeGreaterThan(0);
    expect(ruleC2('studio.x.thing')).toHaveLength(1);
  });
  test('non-string leaves are reported', () => {
    const { violations } = flattenCatalog({ a: { b: { label: 3 } } });
    expect(msgs(violations)).toEqual(['C2']);
  });
});

describe('C3/C4 duplicates', () => {
  const cat = (o: Record<string, string>) => new Map(Object.entries(o));
  test('identical text is C3, near text is C4', () => {
    const v = ruleC3C4(
      cat({ 'a.x.label': 'Cancel', 'a.y.label': 'Cancel', 'a.z.label': 'cancel.' }),
      [],
    );
    expect(msgs(v).sort()).toEqual(['C3', 'C4']);
  });
  test('normalisation erases case, trailing punctuation, quotes and placeholder names', () => {
    expect(nearForm('Delete “{name}”?')).toBe(nearForm('delete "{branch}"?'));
    expect(nearForm('Loading...')).toBe(nearForm('Loading…'));
    expect(nearForm('Copy path')).not.toBe(nearForm('Copy name'));
  });
  test('exemption covers a group only when it matches every key', () => {
    const ex = [{ keys: ['a.x.label', 'a.y.*'], reason: 'r' }];
    expect(isCovered(['a.x.label', 'a.y.label'], ex)).toBe(true);
    expect(isCovered(['a.x.label', 'a.z.label'], ex)).toBe(false);
    const c = cat({ 'a.x.label': 'Open', 'a.y.label': 'Open' });
    expect(ruleC3C4(c, ex)).toEqual([]);
    expect(ruleC3C4(cat({ 'a.x.label': 'Open', 'a.z.label': 'Open' }), ex)).toHaveLength(1);
  });
  test('backend text never duplicates against frontend text', () => {
    const c = cat({ 'backend.menu.edit.label': 'Edit', 'common.action.edit.label': 'Edit' });
    expect(ruleC3C4(c, [])).toEqual([]);
    const d = cat({ 'backend.menu.a.label': 'Edit', 'backend.menu.b.label': 'Edit' });
    expect(ruleC3C4(d, [])).toHaveLength(1);
  });
});

describe('C5 banned forms', () => {
  test.each([
    ['Loading...', 1],
    ["Can't open", 1],
    ['Delete row(s)', 1],
    ['Save & close', 1],
    ['Pick a file', 1],
    ['Try again', 1],
    ['Open repo', 1],
    ['Choose a directory', 1],
    ['Session Id', 1],
    ['Checkout a branch', 1],
    ['Could not load', 1],
  ])('%s', (value, n) => {
    expect(ruleC5('a.b.label', value).length).toBeGreaterThanOrEqual(n);
  });
  test('allowed forms', () => {
    expect(ruleC5('a.b.label', 'Open the working directory')).toEqual([]);
    expect(ruleC5('a.b.label', 'Open {id}')).toEqual([]);
    expect(ruleC5('a.b.label', "mail{'@'}host")).toEqual([]);
    expect(ruleC5('a.b.label', 'Session ID')).toEqual([]);
    expect(ruleC5('a.b.example', "SELECT 'a' ...")).toEqual([]);
  });
  test('checks every plural branch', () => {
    expect(ruleC5('a.b.label', '{count} repo | {count} repos')).not.toEqual([]);
  });
});

describe('C6 case', () => {
  test('sentence case', () => {
    expect(ruleC6('a.b.label', 'Delete connection')).toEqual([]);
    expect(ruleC6('a.b.label', 'Delete Connection')).toHaveLength(1);
    expect(ruleC6('a.b.label', 'delete connection')).toHaveLength(1);
  });
  test('proper nouns and acronyms stay capitalised', () => {
    expect(ruleC6('a.b.label', 'Open in Claude Code')).toEqual([]);
    expect(ruleC6('a.b.label', 'Export as JSON')).toEqual([]);
    expect(ruleC6('a.b.label', 'Connect to PostgreSQL')).toEqual([]);
    expect(ruleC6('a.b.label', 'Connect to Postgres')).toHaveLength(1);
    expect(ruleC6('a.b.label', 'Run in macOS')).toEqual([]);
    expect(ruleC6('a.b.body', 'The Kira Studio window')).toEqual([]);
    expect(ruleC6('a.b.body', 'Docker’s socket')).toEqual([]);
  });
  test('listed lowercase words may open a value', () => {
    expect(ruleC6('a.b.label', 'curl command')).toEqual([]);
    expect(ruleC6('a.b.label', 'macOS only')).toEqual([]);
  });
  test('new sentence, clause and placeholder starts', () => {
    expect(ruleC6('a.b.body', 'Done. Next step follows.')).toEqual([]);
    expect(ruleC6('a.b.body', 'Can’t check out: Local changes in the way.')).toEqual([]);
    expect(ruleC6('a.b.body', 'Wait — Then retry.')).toEqual([]);
    expect(ruleC6('a.b.body', '{name} is ready.')).toEqual([]);
    expect(ruleC6('a.b.body', 'Saved “{name}” to Disk.')).toHaveLength(1);
    expect(ruleC6('a.b.label', 'Settings… Now')).toEqual([]);
  });
  test('plural branches each start a sentence', () => {
    expect(ruleC6('a.b.label', '{count} file | {count} files')).toEqual([]);
    expect(ruleC6('a.b.label', 'One file | many Files')).toHaveLength(2);
  });
  test('native menu is title case', () => {
    expect(ruleC6('backend.menu.a.label', 'Toggle Project Panel')).toEqual([]);
    expect(ruleC6('backend.menu.a.label', 'Command Palette…')).toEqual([]);
    expect(ruleC6('backend.menu.a.label', 'Quit the app')).toHaveLength(1);
    expect(ruleC6('backend.menu.a.label', 'Toggle project panel')).toHaveLength(2);
    expect(ruleC6('backend.menu.a.label', 'Quit {appName}')).toEqual([]);
  });
  test('example and format are exempt', () => {
    expect(ruleC6('a.b.example', 'select * From x')).toEqual([]);
    expect(ruleC6('format.relative.justNow', 'just now')).toEqual([]);
  });
});

describe('C7 punctuation by role', () => {
  test('labels carry no period or question mark', () => {
    expect(ruleC7('a.b.label', 'Delete')).toEqual([]);
    expect(ruleC7('a.b.label', 'Rename…')).toEqual([]);
    expect(ruleC7('a.b.tooltip', 'Copy path.')).toHaveLength(1);
    expect(ruleC7('a.b.label', 'Really?')).toHaveLength(1);
  });
  test('sentences end with a period; errors may end with {error}', () => {
    expect(ruleC7('a.b.body', 'Nothing changes.')).toEqual([]);
    expect(ruleC7('a.b.body', 'Nothing changes')).toHaveLength(1);
    expect(ruleC7('a.b.hint', 'Pick one')).toHaveLength(1);
    expect(ruleC7('a.b.error', 'Couldn’t load: {error}')).toEqual([]);
    expect(ruleC7('a.b.body', 'Couldn’t load: {error}')).toHaveLength(1);
    expect(ruleC7('a.b.error', 'Couldn’t load')).toHaveLength(1);
  });
  test('confirm titles end with ?', () => {
    expect(ruleC7('a.deleteConfirm.title', 'Delete connection?')).toEqual([]);
    expect(ruleC7('a.deleteConfirm.title', 'Delete connection')).toHaveLength(1);
    expect(ruleC7('a.deleteConfirm.confirm', 'Delete')).toEqual([]);
    expect(ruleC7('a.panel.title', 'Delete connection?')).toHaveLength(1);
  });
  test('loading ends with …, placeholder does not', () => {
    expect(ruleC7('a.b.loading', 'Loading…')).toEqual([]);
    expect(ruleC7('a.b.loading', 'Loading')).toHaveLength(1);
    expect(ruleC7('common.state.loading', 'Loading…')).toEqual([]);
    expect(ruleC7('a.b.placeholder', 'Search branches')).toEqual([]);
    expect(ruleC7('a.b.placeholder', 'Search branches…')).toHaveLength(1);
  });
  test('each plural branch is checked', () => {
    expect(ruleC7('a.b.body', 'One file. | {count} files.')).toEqual([]);
    expect(ruleC7('a.b.body', 'One file. | {count} files')).toHaveLength(1);
  });
  test('example and format are exempt', () => {
    expect(ruleC7('a.b.example', 'x.')).toEqual([]);
    expect(ruleC7('format.duration.ms', '{value} ms.')).toEqual([]);
  });
});

describe('C8 plural and backend shape', () => {
  test('plural needs 2 or 3 branches and {count}', () => {
    expect(ruleC8('a.b.label', 'one file | {count} files')).toEqual([]);
    expect(ruleC8('a.b.label', 'no | one | {count} files')).toEqual([]);
    expect(ruleC8('a.b.label', 'a | b | c | {count}')).toHaveLength(1);
    expect(ruleC8('a.b.label', 'one file | many files')).toHaveLength(1);
    expect(ruleC8('a.b.label', 'one | ')).not.toEqual([]);
  });
  test('backend allows named placeholders only', () => {
    expect(ruleC8('backend.menu.a.label', 'Quit {appName}')).toEqual([]);
    expect(ruleC8('backend.menu.a.label', 'a | b')).not.toEqual([]);
    expect(ruleC8('backend.menu.a.label', '@:common.x')).not.toEqual([]);
    expect(ruleC8('backend.menu.a.label', '{0}')).not.toEqual([]);
  });
});

describe('C9 placeholders and markup', () => {
  test('camelCase names, no tags', () => {
    expect(ruleC9('a.b.label', 'Open {fileName}')).toEqual([]);
    expect(ruleC9('a.b.label', 'Open {FileName}')).toHaveLength(1);
    expect(ruleC9('a.b.label', 'Open {0}')).toHaveLength(1);
    expect(ruleC9('a.b.body', 'Press <b>x</b>.')).toHaveLength(1);
    expect(ruleC9('a.b.example', '<div>')).toEqual([]);
  });
});

describe('C10 unused keys', () => {
  test('literal and template-prefix usage', () => {
    const cat = new Map([
      ['a.b.label', 'x'],
      ['a.kind.run.label', 'y'],
      ['a.c.label', 'z'],
    ]);
    const v = ruleC10(cat, { literals: new Set(['a.b.label']), prefixes: ['a.kind.'] });
    expect(v.map((x) => x.key)).toEqual(['a.c.label']);
  });
});

describe('whole-catalog run', () => {
  test('aggregates rules', () => {
    const v = checkCatalog({ a: { b: { label: 'Delete Item...' }, c: { label: '' } } });
    const rules = new Set(msgs(v));
    for (const r of ['C5', 'C6', 'C11']) expect(rules.has(r)).toBe(true);
  });
  test('clean catalog is clean', () => {
    expect(checkCatalog({ a: { b: { label: 'Cancel', tooltip: 'Copy path' } } })).toEqual([]);
  });
});
