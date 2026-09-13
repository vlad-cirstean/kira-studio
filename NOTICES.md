# Third-Party Notices

This file lists third-party icon assets bundled with Kira Studio's UI, and any dependency whose
license terms call for a notice beyond the standard MIT/BSD/Apache-2.0 attribution `go.mod`/
`package.json` already carry.

## simple-icons

Kira Studio imports database/service engine marks (Postgres, MariaDB, MySQL, SQLite, MongoDB,
Redis, Apache Kafka, ClickHouse) from the [Simple Icons](https://simpleicons.org/) icon
set (`simple-icons` on npm), via `import { siX } from 'simple-icons'` and each icon's `path` and
`hex` fields.

Simple Icons' own code and icon data are dedicated to the public domain under CC0 1.0 Universal:

```
Creative Commons Legal Code

CC0 1.0 Universal
```

The full legal text is reproduced in `node_modules/simple-icons/LICENSE.md` and at
<https://creativecommons.org/publicdomain/zero/1.0/legalcode>; no attribution is legally required
under CC0, though it is credited here regardless.

One icon carries an additional, more specific license: Apache Kafka's mark is noted by Simple
Icons as licensed under Apache-2.0 (<https://spdx.org/licenses/Apache-2.0>).

The individual marks reproduced through Simple Icons (Postgres, MariaDB, MySQL, SQLite, MongoDB,
Redis, Apache Kafka, ClickHouse) remain trademarks of their respective owners. They are
used here solely to identify the corresponding database/service engine in the connection UI, not
to imply endorsement by, or affiliation with, those trademark holders.

Amazon SQS and Amazon S3 are not available in Simple Icons (Amazon does not publish per-service
icon marks under a redistributable license there); their icons in Kira Studio are original,
hand-drawn glyphs, not reproductions of Amazon's trademarks.

## seti-icons / seti-ui

Kira Version's file tree (`FileTree.vue`) renders per-language file icons from
[`seti-icons`](https://www.npmjs.com/package/seti-icons) (npm), via
`import { themeIcons } from 'seti-icons'`. `seti-icons` repackages the icon set and colour palette
from [jesseweed/seti-ui](https://github.com/jesseweed/seti-ui) — the same upstream VS Code's own
built-in Seti theme (`vs-seti`) derives from — as plain, tracked JSON/JS data, with no vendored
binary font.

Both `seti-icons` and `seti-ui` are licensed under the MIT License:

```
MIT License

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and
associated documentation files (the "Software"), to deal in the Software without restriction,
including without limitation the rights to use, copy, modify, merge, publish, distribute,
sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or
substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT
NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT
OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```

Copyright for `seti-icons` belongs to Elvis Wolcott; copyright for the underlying `seti-ui` icon
set and palette belongs to the Seti UI contributors (Jesse Weed and contributors).

## tree-sitter grammars and vendored tags.scm queries

Kira Studio's code intelligence layer (`internal/codeparse`) parses source files with ten upstream
tree-sitter grammar modules — Java, Python, JavaScript, TypeScript (and TSX), Go, Rust, HTML, CSS,
JSON (all `github.com/tree-sitter/tree-sitter-<language>`), and Svelte
(`github.com/tree-sitter-grammars/tree-sitter-svelte`) — via the official
`github.com/tree-sitter/go-tree-sitter` binding. All eleven modules are MIT-licensed:

```
MIT License

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and
associated documentation files (the "Software"), to deal in the Software without restriction,
including without limitation the rights to use, copy, modify, merge, publish, distribute,
sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or
substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT
NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT
OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```

Symbol extraction (`internal/codeparse/queries/*/tags.scm`) vendors each grammar's own upstream
`queries/tags.scm` verbatim — the same queries GitHub's own code navigation uses — for the six
languages where one exists (Java, Python, JavaScript, TypeScript, Go, Rust; TSX reuses TypeScript's
file). Each file's own upstream repository and pinned module version is also recorded in
`internal/codeparse/queries.go`'s `Provenance` table. Copyright for each grammar and its queries
belongs to the tree-sitter project and that grammar's own listed authors; see each grammar module's
own `LICENSE` file for the exact copyright line.
