# P248 plan: paste credentials into DB connections

SPEC row P248. User ask: DB credentials are temporary and rotate often. Paste a blob like
`user: foo  pass: bar` into the connection form; fields get parsed and filled. Cover many common
shapes, not only those two words.

User scope cut (own words, relayed by coordinator): no URL/URI/JDBC support ("URLs are fragile";
they belong in the existing Connection URI field), no JSON, no YAML, no URL-encoding/decoding. Keep:
labelled key/value pairs with varied separators, key aliases, `.env`/env-var lines, plain DSN-style
`Key=value;` strings, CLI flags, passwords with separators/spaces via label-based rules.

Base: `v2.0` at `4660139f7` or later. Studio only: Kira Space has no DB connections (no
`connectionsCreate`/`ConnectionDialog` caller under `apps/kira-space`). Frontend only: no Go, no
bridge method, no wire or schema change.

Discovery: `codegraph_explore` over `parseConnectionUri`/`canRoundTripToFields`/`formatConnectionUri`
(`packages/shared/domain/uri.ts`), `ConnectionDialog` (`draft`, `revealed`, `onPasswordInput`,
`setMode`, `onSave`, `TAB_FOR_FIELD`), `useConnectionDialogStore` (`openEditDialog`, `saveDialog`),
`useConnectionsStore` (`patchConnectionFields`, `setConnectionReadOnly`), `connectionFieldsSchema`/
`connectionInputSchema`/`AWS_STYLE_KINDS`/`FILE_KINDS`/`DEFAULT_PORT`, Go `connections.Service.Update`/
`secretWrites`/`destinationUnchangedFor`, `injectURIPassword`, `bridge.ConnectionsService`,
`connectionMenu` (`project/menus.ts`), kafka/redis adapters, flow coverage gate.

## 1. Facts the design rests on

- Fields per kind (`ConnectionDialog.vue:767-892`). Network kinds (postgres, mariadb, mysql,
  clickhouse, mongodb, redis, kafka): host, port, database, username, password. AWS kinds (sqs, s3):
  `database` holds region, `username` holds AWS profile; no password field. File kind (sqlite):
  `database` holds the absolute path; no credentials.
- Fields-mode password is three-state on update (`service.go:329-344`): `null` keeps the stored
  secret, `""` clears, any other value replaces. `openEditDialog` starts the draft with
  `password: null`.
- URI mode stores the URI encrypted; the renderer never sees it unless revealed (P181). Out of
  scope here per user cut.
- `options.authSource` is read by mongo fields mode (`mongo/client.go:133`).
- Kafka takes one seed broker (`kafka/client.go:111`, `SeedBrokers(host:port)`); SASL/PLAIN needs
  both username and password.
- `Service.Update` reconnects a live connection only when the destination denylist changes, not on a
  password-only change.
- `patchConnectionFields` hardcodes `password: null`, so it cannot carry a new password.
- No existing parser handles free-form labelled text. `parseConnectionUri` is URI-only and stays
  untouched (out of scope).

## 2. Decisions (planner defaults)

- D1 Parser runs in the renderer only. The pasted blob never crosses the bridge. Only resulting
  fields go to Go, through the existing `connectionsUpdate`/`connectionsCreate` secret path.
- D2 Hand-rolled label scanner. Requirement no library meets: tolerant labelled scan of free text
  where the value boundary depends on a recognised next label (protects passwords containing `:`,
  `=`, `;`, spaces). `dotenv` declined: its main entry imports `fs`/`path`/`os` (no browser build
  without polyfills), and the scanner covers `KEY=value` lines anyway. `@tediousjs/connection-string`
  declined: user limited DSN to plain `Key=value;`, which the scanner covers; brace/escape quoting
  out of scope.
- D3 CLI flags supported. Tokenize with `shell-quote` (MIT, zero dependencies, check license at
  package level; pin exact version at least two weeks old, repo style like `"zod": "4.6.5"`) in
  `apps/kira-studio/frontend/package.json`. Its `parse()` handles quotes and escapes; flag mapping
  table is ours. Env-var operators it returns as objects (`{op: ...}`) end the CLI token run.
- D4 DSN-style `Key=value;` strings supported only as plain key/value: `;` is a pair delimiter only
  when followed by a recognised label. No `{}` quoting, no `""` escape rules.
- D5 No percent-decoding anywhere. A value is literal text.
- D6 Paste entry points: (a) connection dialog, General tab, fields mode, non-file kinds, create and
  edit; (b) new connection-menu item "Update credentials…" for a saved fields-mode connection of a
  network kind, which writes only username and password and keeps everything else. Hidden for URI
  mode, sqlite, sqs, s3.
- D7 AWS kinds in the dialog: region and profile recognised. Access key id, secret key and session
  token are recognised but reported as not storable ("Use a named AWS profile"), never applied.
- D8 Review before apply. Parse result shows each recognised field, password masked with a local
  reveal toggle, a "guessed" badge on heuristic matches, a picker when one field has several
  candidates. Nothing reaches the draft or the DB until the user presses Apply.
- D9 Live connection after "Update credentials": reconnect so the new secret is used now. If the
  username changed, `Service.Update` already reconnects (denylist); the store reconnects only for a
  password-only change on a `connected` connection, same pattern as `setConnectionReadOnly`. The
  dialog footer says "Reconnects the live connection" when it applies.
- D10 Reveal of the pasted password needs no `localauth` gate: the user just supplied it. The stored
  secret is never fetched by this feature.
- D11 Input cap 8 KiB. Longer input: "Too long to be credentials", no parse.
- D12 Unlabelled fallback: when no labelled user or password is found, exactly two non-empty
  whitespace-free lines (or two tokens on one line) map to username then password, both flagged
  guessed. One token maps to password, flagged guessed. Anything else yields nothing.
- D13 `#` starts a comment only at line start (after optional whitespace). An inline ` #` stays part
  of an unquoted value, since passwords may contain `#`.

## 3. Parser: `apps/kira-studio/frontend/src/project/credentialPaste/parse.ts`

Pure, DOM-free, total (never throws). Export:

```ts
export type PasteField = 'host' | 'port' | 'database' | 'username' | 'password'
  | 'region' | 'profile' | 'authSource';
export interface PasteCandidate { value: string; guessed: boolean; label: string }
export interface PasteNote { label: string; reason: string } // never carries a value
export interface PasteResult {
  fields: Partial<Record<PasteField, PasteCandidate[]>>; // document order
  notes: PasteNote[];
  tooLong: boolean;
}
export function parseCredentialPaste(text: string, kind: ConnectionKind): PasteResult;
```

`label` is the key as written (e.g. `PGPASSWORD`, `-u`), shown in the review so the user sees why.
Notes name recognised-but-unusable labels only. Unrecognised lines are counted ("3 lines not
recognised"), never echoed: they may hold secrets.

### 3.1 Normalize

Strip BOM. CRLF and CR to LF. NBSP and other Unicode spaces to space. Drop lines that are a comment
(`#` or `//` at line start). Strip a leading `export ` and `set ` (shell/cmd) per line.

### 3.2 Key aliases (case-insensitive)

A label is `[prefix][word]` where word parts may join with `_`, `-`, `.`, or one space
(`User Id`, `user name`, `service name`). Prefixes, optional: `PG`, `POSTGRES_`, `POSTGRESQL_`,
`MYSQL_`, `MARIADB_`, `MONGO_`, `MONGODB_`, `REDIS_`, `KAFKA_`, `CLICKHOUSE_`, `DB_`, `DATABASE_`,
`SPRING_DATASOURCE_`, `SASL_`, `sasl.`, `AWS_`. Words:

- username: user, username, user id, userid, uid, login, role, account, principal, sasl.username
- password: pass, password, passwd, pwd, secret, token, pass phrase, sasl.password
- host: host, hostname, server, address, addr, endpoint, data source, bootstrap.servers, brokers,
  bootstrap servers, broker
- port: port
- database: database, db, dbname, db name, initial catalog, catalog, schema, service, service name,
  service_name, sid
- region: region, default region (AWS kinds only)
- profile: profile (AWS kinds only)
- authSource: authsource, auth source, authenticationdatabase, auth db (mongodb only)
- AWS secrets (note only): access key id, secret access key, session token

Bare `PGUSER`, `PGPASSWORD`, `PGHOST`, `PGPORT`, `PGDATABASE` match through prefix `PG` plus word.
`MYSQL_PWD`, `REDISCLI_AUTH`, `MYSQL_ROOT_PASSWORD` listed explicitly. A key that matches no alias is
not a label.

### 3.3 Separators and values

After a label: optional whitespace, then one separator from `:=`, `=>`, `->`, `:`, `=`, tab, or
whitespace alone. Whitespace alone counts only when the label starts a line or follows a pair
delimiter (stops `my password is` prose from matching mid-sentence).

Value:
1. Opens with `"`, `'` or backtick: runs to the matching close quote. Backslash escapes `\"` and
   `\\` inside double quotes only. Unterminated quote: rest of line, flagged guessed.
2. Otherwise: runs to end of line, cut earlier only at the next recognised label on the same line
   preceded by a pair delimiter (`;`, `,`, or 2+ spaces, tab) or by a single space when that label
   is followed by an explicit separator (`user: foo pass: bar`). Trailing `;`/`,` before end of line
   dropped; surrounding whitespace trimmed.
3. Empty value: ignored, no candidate.

Consequence, tested: `password: a;b:c=d e` keeps `a;b:c=d e` (no label follows a delimiter).
`password=x; user=y` splits. Known limit: a password literally containing ` user: ` splits; review
shows it, user can fix by hand.

Kafka JAAS line works through the same rules:
`...PlainLoginModule required username="u" password="p";`.

### 3.4 CLI flags

Line qualifies when its first non-env-assignment word is a known client (`psql`, `mysql`,
`mariadb`, `mysqlsh`, `mongosh`, `mongo`, `redis-cli`, `clickhouse-client`, `clickhouse`,
`kafka-console-consumer`, `kcat`, `pg_dump`, `mysqldump`) or the line starts with `-`. Leading
`NAME=value` assignments are handled by 3.2/3.3 first. Tokenize with `shell-quote` `parse`.
Flag table keyed by client, default table for a bare `-` line:

- psql/pg_dump: `-U`/`--username` user, `-h`/`--host`, `-p`/`--port`, `-d`/`--dbname`; first bare
  positional dbname, second user; `-W` ignored (prompt).
- mysql/mariadb/mysqldump/mysqlsh: `-u`/`--user`, `-p<value>` attached or `--password=<value>`
  password (detached `-p` alone prompts: ignored), `-h`, `-P`/`--port`, `-D`/`--database`; bare
  positional database.
- mongosh/mongo: `-u`/`--username`, `-p`/`--password`, `--host`, `--port`,
  `--authenticationDatabase` authSource.
- redis-cli: `-h`, `-p` port, `-a`/`--pass` password, `--user` user, `-n` database.
- clickhouse-client: `--host`/`-h`, `--port`, `--user`/`-u`, `--password`, `--database`/`-d`.
- kcat: `-b` host:port; `-X sasl.username=..`/`-X sasl.password=..` via 3.3.
- Unknown client or bare `-` line: `-u`/`--user` user, `-h` host, `-P`/`--port` port, `-d` database,
  `--password=` password; `-p<value>`: numeric means port, else password, flagged guessed.

### 3.5 Post-processing

- Host value `name:port` or `[v6]:port` with numeric port: split; port added as candidate with the
  same label. Comma list, Kafka only (brokers): first entry used, note "extra brokers ignored (one seed broker
  supported)".
- Port: integer 1-65535 or dropped with note.
- Per-kind filter: drop fields the kind cannot hold (Kafka: database; AWS: host/port/database/
  username/password become notes; non-mongo: authSource; non-AWS: region/profile). Redis database
  must be an integer, else note. Postgres `schema` label: note "no schema field", not mapped.
  `service`/`sid` map to database, flagged guessed.
- Duplicate equal values collapse into one candidate.
- D12 fallback runs last.

## 4. UI

### 4.1 `CredentialPastePanel.vue` (new, `apps/kira-studio/frontend/src/project/credentialPaste/`)

`<script setup lang="ts">`, Tailwind only, shadcn-vue primitives from `@theme/components/ui`
(`textarea`, `button`, `badge`, `native-select`, `label`, `alert`), `TooltipIconButton` for reveal.
Props: `kind`, `allowed: readonly PasteField[]`. Emits `apply(Partial<Record<PasteField, string>>)`
and `cancel`.

- Textarea: `autocomplete="off"`, `spellcheck="false"`, `autocapitalize="off"`,
  `data-1p-ignore`, `data-lpignore="true"`, masked by default with
  `[-webkit-text-security:disc]` plus a "Show text" toggle. Autofocus on open. Placeholder lists
  shapes: `user: … password: …`, `PGPASSWORD=…`, `mysql -u … -p…`.
- Parse on input via VueUse `useDebounceFn` (150 ms) and immediately on `paste`.
- Review list, one row per field in `allowed` with candidates: label, value (password masked,
  reveal toggle), `guessed` Badge, NativeSelect when more than one candidate (default first).
  Fields outside `allowed` that were recognised: one muted line "Also found: host, port. Use
  Edit… to change them." Notes as muted lines. `tooLong`: Alert.
- Apply enabled when at least one allowed field has a candidate. Apply emits chosen values, then
  clears. Cancel clears.
- Clearing: textarea ref, parse result and reveal toggles reset on apply, cancel and
  `onBeforeUnmount`. Nothing goes to Pinia, localStorage, opLog or `console`. JS strings are
  immutable: clearing drops references, it cannot zero memory (stated in docs).
- testids: `paste-credentials-input`, `paste-credentials-row-<field>`,
  `paste-credentials-pick-<field>`, `paste-credentials-apply`, `paste-credentials-cancel`,
  `paste-credentials-also-found`, `paste-credentials-notes`.

### 4.2 Connection dialog (`ConnectionDialog.vue`)

General tab, fields mode, kind not in `FILE_KINDS`: "Paste credentials…" button
(`data-testid="connection-paste-credentials"`, codicon `clippy`) beside the Mode toggle. Opens the
panel in a shadcn `Popover` anchored to the button (no nested dialog). `allowed`: AWS kinds
`['region','profile']`; mongodb adds `authSource`; others
`['host','port','database','username','password']`.

Apply writes into `draft`: host, port (number), database, username; password through
`onPasswordInput` (sets `revealed`, so edit mode treats it as typed); region into `database`,
profile into `username` for AWS kinds; authSource into `draft.options.authSource`. Clears related
`fieldErrors`. Then closes the popover. Save stays the existing path.

### 4.3 "Update credentials…" (saved connection)

- `project/menus.ts` `connectionMenu`: item `update-credentials`, label "Update credentials…", icon
  `key`, right after `edit`. Present only when `record.mode === 'fields'` and kind not in
  `FILE_KINDS`/`AWS_STYLE_KINDS`. No shortcut.
- New store `project/state/credentialsDialog.ts`: `useCredentialsDialogStore` (`open`,
  `connectionId`, `openFor(id)`, `close()`). One concern, no secret in it.
- New `project/CredentialsUpdateDialog.vue`: shadcn `Dialog`, title "Update credentials — <name>",
  embeds the panel with `allowed: ['username','password']`, footer note when live. Mounted in
  `workbench/panels/ProjectPanel.vue` next to `<FiltersDialog />` (`v-if` on store `open`), not
  `App.vue` (P246 overlap, section 6).
- Apply calls new `useConnectionsStore().updateConnectionCredentials(id, { username?, password? })`:
  record fields spread as `patchConnectionFields` does, username replaced only when supplied,
  password set when supplied else `null` (kept). Calls `control.connectionsUpdate`, splices the
  record, then D9 reconnect rule. Errors surface in the dialog's Alert; dialog stays open, panel
  state kept until Cancel. Success closes and clears.
- `patchConnectionFields` stays unchanged (its `password: null` is right for its callers).

## 5. Tests (CLAUDE.md bar)

- Unit, qualifies (multi-rule parser): `apps/kira-studio/tests/unit/credential-paste.spec.ts`,
  `bun:test`, one table of `{ name, kind, input, expect }` rows plus a few focused cases. Rows at
  least: `user: foo  pass: bar`; `username=foo\npassword=bar`; `login -> foo`, tab separator,
  whitespace-only separator at line start; quoted values with `;`, `:`, `=`, spaces, escaped quote;
  unterminated quote; password containing `;b:c=d e #x`; inline `password=x; user=y`; `.env` block
  with `export` and comments; `PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE`; `DB_USER`/`DB_PASSWORD`;
  `MYSQL_PWD`; DSN `Server=h;Port=5433;User Id=u;Password=p;Database=d`; DSN password containing
  `;` without a following label; `Data Source=h;Initial Catalog=d`; psql flags with
  positional db; `mysql -u u -pSecret -h h -P 3307 db`; `mysql -p` detached ignored; `redis-cli -a`;
  `mongosh --authenticationDatabase admin`; kcat `-X sasl.*`; JAAS line; brokers comma list; host
  `h:5433` split; IPv6 bracket; port out of range; redis non-numeric db; AWS env block (region,
  profile kept, keys noted, never valued); unlabelled two lines; single token; prose without labels
  yields nothing; 8 KiB cap; duplicates collapse; conflicting user candidates order. No test asserts
  only what a short function body restates.
- UI (Playwright, existing fixture bridge): `apps/kira-studio/tests/ui/connection-paste-credentials.spec.ts`.
  Create postgres: paste, review shows masked password and guessed badge where expected, pick
  between two candidates, Apply fills fields, Save sends them. Cancel leaves the draft untouched and
  the textarea empty on reopen. Edit fields-mode connection: paste applies password, Save sends new
  password. Tree menu: item hidden for URI mode, sqlite, sqs; shown for fields-mode postgres;
  Update credentials sends `connectionsUpdate` with only username/password changed and every other
  field equal to the record; live connection reconnects (fixture records disconnect/connect).
  Collect `page.on('console')` for the whole spec and assert the pasted password never appears.
- Visual: refresh the affected `tests/visual/connection-dialog.spec.ts` baselines (new button).
- e2e-real, one scenario in `tests/e2e-real/postgres-real.spec.ts`: saved connection with a stale
  password fails to connect; Update credentials with `PGUSER=..\nPGPASSWORD=..` paste; connect
  succeeds.
- Go: no Go change, no flow test. `apps/kira-studio/internal/flows/coverage/exempt.txt` stays
  empty (no new bound method).

Run once near phase end: `bun run test:unit`, `bun run test:ui:studio` (spec plus visual project for
the dialog), the one e2e-real spec. Typecheck/lint/knip per commit.

## 6. File ownership and overlap

P248 owns:
- new `apps/kira-studio/frontend/src/project/credentialPaste/parse.ts`,
  `.../credentialPaste/CredentialPastePanel.vue`, `apps/kira-studio/frontend/src/project/CredentialsUpdateDialog.vue`,
  `apps/kira-studio/frontend/src/project/state/credentialsDialog.ts`
- `apps/kira-studio/frontend/src/project/ConnectionDialog.vue`, `project/menus.ts`,
  `state/connections.ts`, `workbench/panels/ProjectPanel.vue`
- `apps/kira-studio/frontend/package.json`, `bun.lock` (shell-quote; plus `@types/shell-quote` dev
  dependency if the package ships no types)
- tests listed in section 5; `docs/ARCHITECTURE.md` (one short paragraph in the connections
  section)

Against siblings:
- P243 Part 2 (VS Code extension removal): edits root `package.json` scripts and `bun.lock`. Shared
  file: `bun.lock` only. Resolve by rerunning `bun install` on rebase, never hand-merge.
- P246 (popup routing): Studio prompts go through `useConfirmDialogStore` and its host. P248 adds no
  confirm prompt (the review panel is the confirmation) and does not touch `App.vue` or the confirm
  host. Possible touch: `ConnectionDialog.vue` if P246 rewrites its existing `confirmDialog` call at
  line 560; small hunk, rebase.
- P247 (workflow branching): Space ADE workflows; no shared file.
- `docs/ARCHITECTURE.md`: append-only paragraph; rebase conflicts trivial.

Order: table order, after P247. One sequential Sonnet implementer; no stream split.

## 7. Commits (suggested)

1. `feat(connections): credential paste parser` (parse.ts, unit spec, shell-quote dep)
2. `feat(connections): paste credentials in connection dialog` (panel, dialog hook-up)
3. `feat(connections): update credentials on a saved connection` (store, dialog, menu, ProjectPanel)
4. `test(connections): paste credentials UI, visual baseline, postgres e2e-real`
5. `docs: credential paste`

## 8. Docs

`docs/ARCHITECTURE.md`, connections section: paste is parsed in the renderer only, the blob never
crosses the bridge or reaches logs or stores, URIs stay in the URI field, Update credentials writes
username/password only and reconnects a live connection. No Known open item.

## 9. Verification checklist (orchestrator)

- `rg -n "parseCredentialPaste" apps/kira-studio/frontend/src` shows real callers in the panel.
- `rg -n "from 'shell-quote'" apps/kira-studio/frontend/src` has a real import in parse.ts; license
  MIT confirmed in `node_modules/shell-quote/package.json`.
- No URL/URI/JDBC/JSON/YAML/percent-decode handling in `credentialPaste/` (`rg -n "new URL|decodeURI|JSON.parse|yaml" .../credentialPaste` empty).
- No `console.` in `credentialPaste/` or `CredentialsUpdateDialog.vue`; no bridge call takes the raw
  blob.
- Menu item gating matches D6; `ProjectPanel.vue` mounts the dialog; `App.vue` untouched.
- Unit table has at least the rows listed in section 5; UI spec console assertion present.
- `exempt.txt` empty; coverage gate green; hooks green on normal commits.

## 10. Risks

- Label scan false positives in prose: mitigated by the line-start rule for whitespace-only
  separators and by the review step.
- `-webkit-text-security` is non-standard; WKWebView and Chromium both honour it. Elsewhere the
  textarea shows plain text; acceptable since the review masks the password.
- `shell-quote` `parse` expands `$VAR` against an env object: pass an env function returning the
  literal `$NAME` so nothing is substituted.
