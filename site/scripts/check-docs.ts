#!/usr/bin/env bun
/** P284: runs the docs style rules (docsRules.ts) over site/src/content/docs. */
import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { Glob } from 'bun';
import { checkDocument } from './docsRules';

const SITE = join(import.meta.dir, '..');
const ROOT = join(SITE, '..');
const CONTENT = join(SITE, 'src', 'content', 'docs');

const print = (line: string) => process.stderr.write(`${line}\n`);
let count = 0;
const files = [...new Glob('**/*.{md,mdx}').scanSync({ cwd: CONTENT })].sort();
for (const file of files) {
  const source = readFileSync(join(CONTENT, file), 'utf8');
  for (const v of checkDocument(source, file.endsWith('.mdx'), ROOT)) {
    print(`check-docs: ${relative(ROOT, join(CONTENT, file))}:${v.line}: ${v.rule} ${v.message}`);
    count += 1;
  }
}
print(`check-docs: ${files.length} files, ${count} violations`);
process.exit(count > 0 ? 1 : 0);
