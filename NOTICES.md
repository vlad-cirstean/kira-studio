# Third-Party Notices

This file lists third-party icon assets bundled with Kira Studio's UI.

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

## JetBrains Mono

Kira Studio bundles [JetBrains Mono](https://www.jetbrains.com/lp/mono/) as the primary monospace
typeface (`--kira-font-family` in `apps/kira-studio/frontend/src/theme/tokens.css`), instead of relying on a
system-installed monospace font. Four static WOFF2 styles — Regular, Bold, Italic, Bold Italic,
version 2.304 — are vendored under `apps/kira-studio/frontend/src/assets/fonts/jetbrains-mono/` and declared via
`@font-face` in `apps/kira-studio/frontend/src/theme/fonts.css`; only the weights/styles the app's CSS actually
uses are included, not the full 8-weight family.

JetBrains Mono is licensed under the SIL Open Font License, Version 1.1. The full license text
ships alongside the font files at
`apps/kira-studio/frontend/src/assets/fonts/jetbrains-mono/LICENSE-OFL.txt` and is also available at
<https://scripts.sil.org/OFL>.

## DejaVu Sans Mono

Kira Studio bundles [DejaVu Sans Mono](https://dejavu-fonts.github.io/) as the fallback monospace
typeface, listed after JetBrains Mono in `--kira-font-family` for its broader Unicode/glyph
coverage. Four static WOFF2 styles — Regular, Bold, Oblique, Bold Oblique, version 2.37 — are
vendored under `apps/kira-studio/frontend/src/assets/fonts/dejavu-sans-mono/` (converted from the upstream TTF
release with `fonttools`, since DejaVu does not publish WOFF2 directly) and declared via
`@font-face` in `apps/kira-studio/frontend/src/theme/fonts.css`.

DejaVu fonts are derived from Bitstream Vera and distributed under a permissive
Bitstream/Vera-style license (public-domain DejaVu changes over a Bitstream Vera base, with no
copyleft or attribution requirement beyond retaining the license text with copies of the font).
The full license text ships alongside the font files at
`apps/kira-studio/frontend/src/assets/fonts/dejavu-sans-mono/LICENSE` and is also available at
<https://dejavu-fonts.github.io/License.html>.
