/**
 * G14 D1/D11 — the guard for F1/F3's class of defect. A `.vue` file's default export is a
 * *value* — the component object the template instantiates. `import type` erases it at compile
 * time, so Vue renders the tag as an unknown element instead of the real component, and nothing
 * else in this repo's toolchain can catch it: it typechecks (`vue-tsc` only cares that the type
 * position resolves), it lints clean (`biome check` classifies `useImportType` as a warning and
 * exits 0), it builds (the bundle is structurally fine — the missing component is missing only at
 * runtime, in the DOM), and `bun run format` actively *reintroduces* it (biome's own "safe fix"
 * turns a correct value import back into `import type` the moment a `.vue` component is
 * referenced only in a type position, e.g. `ref<InstanceType<typeof X>>`).
 *
 * This walks every `.vue` file under `packages/git-ui/src` and fails on any *default* type-only
 * import from another `.vue` file. Named type imports (`import type { FindBarHost } from
 * '…vue'`) are deliberately not matched — G14 F3 found one and it is legitimate, since a named
 * export can be a real type with no runtime value at all.
 */

import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const GIT_UI_SRC = join(import.meta.dir, '..', '..', '..', 'packages', 'git-ui', 'src');

// Matches `import type X from '…something.vue'` (a *default* type-only import of a component),
// but not `import type { X } from '…something.vue'` (a named type import, which is legitimate).
const BAD_DEFAULT_TYPE_IMPORT = /^import type\s+[A-Za-z_$][\w$]*\s+from\s+['"].*\.vue['"]/m;

function walkVueFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      out.push(...walkVueFiles(full));
    } else if (entry.endsWith('.vue')) {
      out.push(full);
    }
  }
  return out;
}

describe('no .vue file is imported as a default `import type` (G14 F1/F3)', () => {
  const files = walkVueFiles(GIT_UI_SRC);

  test('sanity: the walk found .vue files', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  test('no file matches the bad-import pattern', () => {
    const offenders: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      const lines = text.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (BAD_DEFAULT_TYPE_IMPORT.test(lines[i])) {
          offenders.push(`${file}:${i + 1}: ${lines[i].trim()}`);
        }
      }
    }
    if (offenders.length > 0) {
      throw new Error(
        `Found ${offenders.length} default \`import type\` of a .vue component. A .vue file's ` +
          'default export is a value — the component object the template instantiates — and ' +
          '`import type` erases it, so Vue renders the tag as an unknown element instead of the ' +
          'real component (G14 F1/F3). Use a plain import, with a `biome-ignore ' +
          'lint/style/useImportType` comment if the script only references the component in a ' +
          `type position (e.g. \`ref<InstanceType<typeof X>>\`):\n${offenders.join('\n')}`,
      );
    }
  });
});
