// Assembles every *.dc.html artboard from parts/ so the whole set shares one
// stylesheet, one icon set and one shell. Re-run after editing anything in parts/.
import { readFileSync, writeFileSync } from 'node:fs';
const P = (f) => readFileSync(new URL(`./parts/${f}`, import.meta.url), 'utf8');

const head = P('_head.html'), style = P('_style.css'), icons = P('_icons.html'), tail = P('_tail.html');
const sbHead = P('_sb_head.html'), sbTail = P('_sb_tail.html');
const trees = { sql: P('_sb_sql.html'), mongo: P('_sb_mongo.html'), redis: P('_sb_redis.html'), stream: P('_sb_stream.html'), nocolor: P('_sb_nocolor.html') };
const statusbar = P('_statusbar.html'), opsShell = P('_ops.html');
const gridRows = P('_gridrows.html'), kinds = P('_kinds.html'), kindCss = P('_kindcss.html'), dlgCss = P('_dlgcss.html');

const row = (state, kind, text, badge, t, extra = '') =>
  `          <div class="p-row${extra}"><span class="icon-box"><span class="state ${state}"></span></span><span class="op-kind"${kind === 'error' ? ' style="color:var(--error)"' : ''}>${kind}</span><span class="op-q${kind === 'error' ? ' err' : ''}">${text}</span>${badge}<span class="op-t">${t}</span></div>`;
const b = (t) => `<span class="p-badge">${t}</span>`;

const OPS = {
  sql: [
    row('live', 'query', "SELECT * FROM public.orders WHERE status = 'paid' ORDER BY placed_at DESC LIMIT 200", b('200 rows'), '412 ms'),
    row('live', 'count', "SELECT count(*) FROM public.orders WHERE status = 'paid'", b('9 412'), '88 ms', ' is-hover'),
    row('live', 'schema', 'Read public — 12 tables, 3 views, 5 functions, 7 sequences', b('from cache'), '6 ms'),
    row('err', 'error', 'relation "public.reviews" does not exist — dropped since this tree was cached', '<span class="p-btn is-hover"><span class="icon-box"><svg class="icon"><use href="#i-refresh"/></svg></span>Reload tree</span>', '14 ms'),
    row('live', 'connect', 'prod-analytics — postgres 16.3, TLS, pool 1/8', b('tls'), '1.2 s'),
  ],
  mongo: [
    row('live', 'find', "app.sessions.find({ status: 'active', region: 'eu' }).limit(50)", b('50 docs'), '96 ms'),
    row('live', 'count', 'app.sessions.estimatedDocumentCount()', b('≈ 40 000'), '4 ms'),
    row('busy', 'update', 'app.sessions.updateOne({ _id: ObjectId("65f2a10c4b1f") }, { $set: … })', '<span class="p-chip warn">in flight</span>', '—', ' is-hover'),
    row('live', 'schema', 'Read app — 8 collections, 14 indexes', b('from cache'), '11 ms'),
    row('live', 'connect', 'staging-mongo — mongodb 7.0.9, replica set rs0', b('tls'), '840 ms'),
  ],
  redis: [
    row('live', 'scan', 'HSCAN session:a44c MATCH * COUNT 200', b('14 fields'), '3 ms'),
    row('live', 'meta', 'TYPE / TTL / MEMORY USAGE session:a44c', b('hash · 2.1 KB'), '2 ms'),
    row('err', 'error', 'NOAUTH Authentication required — the password changed on the server', '<span class="p-btn is-hover"><span class="icon-box"><svg class="icon"><use href="#i-edit"/></svg></span>Edit connection</span>', '1 ms', ' is-hover'),
    row('live', 'scan', 'SCAN 0 MATCH session:* COUNT 500', b('912 keys'), '18 ms'),
    row('live', 'connect', 'local-redis — redis 7.2.4, db 0 of 16', b('no tls'), '12 ms'),
  ],
  stream: [
    row('live', 'poll', 'order.shipped — 6 partitions, from latest, max 50', b('12 msgs'), '240 ms'),
    row('live', 'meta', 'Describe topic order.shipped — 6 partitions, rf 3', b('lag 12'), '31 ms'),
    row('busy', 'poll', 'order.shipped — waiting for messages', '<span class="p-chip warn">visibility 30 s</span>', '—', ' is-hover'),
    row('live', 'schema', 'List topics — 17 topics, 4 consumer groups', b('from cache'), '9 ms'),
    row('live', 'connect', 'events-kafka — kafka 3.7.0, SASL/SCRAM, 3 brokers', b('sasl'), '660 ms'),
  ],
  console: [
    row('busy', 'query', 'statement 2 — SELECT date_trunc(\'day\', placed_at) AS day, currency, sum(total) …', '<span class="p-chip warn">running</span>', '1.8 s', ' is-hover'),
    row('live', 'query', 'statement 1 — SET search_path TO public', b('ok'), '2 ms'),
    row('err', 'error', 'column "revenu" does not exist — did you mean "revenue"? (line 4)', '<span class="p-btn is-hover"><span class="icon-box"><svg class="icon"><use href="#i-arrow-r"/></svg></span>Go to line 4</span>', '7 ms'),
    row('live', 'count', 'SELECT count(*) FROM public.orders', b('9 412'), '88 ms'),
    row('live', 'connect', 'warehouse — postgres 16.3, TLS, pool 2/8', b('tls'), '1.2 s'),
  ],
  ddl: [
    row('live', 'schema', 'Generate DDL for public.orders from pg_catalog', b('9 cols'), '6 ms'),
    row('live', 'schema', 'Read indexes and constraints for public.orders', b('2 + 4'), '4 ms', ' is-hover'),
    row('live', 'query', "SELECT * FROM public.orders WHERE status = 'paid' LIMIT 200", b('200 rows'), '412 ms'),
    row('live', 'connect', 'prod-analytics — postgres 16.3, TLS, pool 1/8', b('tls'), '1.2 s'),
  ],
  idle: [
    row('live', 'connect', 'prod-analytics — postgres 16.3, TLS, pool 0/8', b('tls'), '1.2 s'),
    row('live', 'schema', 'Read analytics — 1 schema, 12 tables, 3 views', b('from cache'), '6 ms', ' is-hover'),
    row('live', 'meta', 'Cache warmed — 612 nodes, 18.4 MB on disk', b('sqlite'), '22 ms'),
  ],
};

const sbLeft = {
  // LAW 14 — the left readout answers "where is the caret" and nothing else.
  // Every fact a toolbar already carries — row counts, pending edits, durations,
  // read-only, TTL — was removed from here rather than repeated: the editor
  // status line was deleted for exactly that reason and this row must not
  // become the next place the same numbers accumulate.
  grid: '<span class="p-status"><span class="mono xs muted">status · text · row 3, col 4</span></span>',
  cell: '<span class="p-status"><span class="mono xs muted">preferences · row 3 · ln 4, col 18</span></span>',
  doc: '<span class="p-status"><span class="mono xs muted">65f2a10c4b1f · doc 2 of 50 · ln 6</span></span>',
  kv: '<span class="p-status"><span class="mono xs muted">session:a44c · field 3 of 14 · region</span></span>',
  stream: '<span class="p-status"><span class="mono xs muted">order.shipped · part 2 · offset 48 210</span></span>',
  console: '<span class="p-status"><span class="mono xs muted">ln 8, col 34 · statement 2</span></span>',
  ddl: '<span class="p-status"><span class="mono xs muted">public.orders · ln 14, col 1</span></span>',
  none: '<span class="p-status"><span class="mono xs muted">no selection</span></span>',
};

const screens = [
  { name: 'System' },
  { name: 'Main', tree: 'sql', sel: true, ops: 'sql', sb: 'grid' },
  { name: 'CellEditor', tree: 'sql', sel: false, ops: null, sb: 'cell' },
  { name: 'Documents', tree: 'mongo', ops: 'mongo', sb: 'doc' },
  { name: 'KeyValue', tree: 'redis', ops: 'redis', sb: 'kv' },
  { name: 'Stream', tree: 'stream', ops: 'stream', sb: 'stream' },
  { name: 'Console', tree: 'nocolor', ops: 'console', sb: 'console' },
  { name: 'Ddl', tree: 'sql', sel: false, ops: 'ddl', sb: 'ddl' },
  { name: 'Empty', tree: 'sql', sel: false, ops: 'idle', sb: 'none' },
  { name: 'FirstRun', tree: null, ops: null, sb: 'none' },
  { name: 'NewConnection' },
  { name: 'ConnectionDialog' },
  { name: 'SettingsDialog' },
  { name: 'FiltersDialog' },
  { name: 'Toolbars' },
  { name: 'Menus' },
];

for (const s of screens) {
  let body = P(`bodies/${s.name}.html`);
  const tree = s.tree ? trees[s.tree].replace('__SEL_ORDERS__', s.sel ? 'is-selected' : '') : '';
  body = body
    .replace('{{SIDEBAR}}', s.tree ? sbHead + tree + sbTail : '')
    .replace('{{OPS}}', s.ops ? opsShell.replace('__OPS_ROWS__', '\n' + OPS[s.ops].join('\n') + '\n        ') : '')
    .replace('{{STATUSBAR}}', s.sb ? statusbar.replace('__SB_LEFT__', sbLeft[s.sb]) : '')
    .replace('{{GRID_ROWS}}', gridRows.trimEnd())
    .replace('{{KINDS}}', kinds)
    .replace('{{KINDCSS}}', kindCss.trimEnd())
    .replace('{{DLGCSS}}', dlgCss.trimEnd());
  if (body.includes('{{')) throw new Error(`${s.name}: unresolved placeholder ${body.match(/\{\{\w+\}\}/)}`);
  writeFileSync(new URL(`./${s.name}.dc.html`, import.meta.url), head + style + icons + '\n' + body + '\n' + tail);
  console.log(`  ${s.name}.dc.html`);
}
