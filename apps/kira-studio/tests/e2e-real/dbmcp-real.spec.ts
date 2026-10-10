import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openMainWindow } from '@workbench/testing/e2eReal';
import { expect, test } from './fixtures';

// A real MCP client over HTTP against the real server: a write to an exposed connection parks on
// the approval dialog in the UI, approving it releases the tool call, the row lands in the file.

interface Rpc {
  result?: { content?: { type: string; text: string }[]; isError?: boolean };
  error?: { message: string };
}

async function post(
  url: string,
  token: string,
  session: string | null,
  body: object,
): Promise<{ rpc: Rpc | null; session: string | null }> {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      authorization: `Bearer ${token}`,
      ...(session ? { 'mcp-session-id': session } : {}),
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  const data = text.split('\n').find((l) => l.startsWith('data:'));
  const raw = data ? data.slice(5).trim() : text.trim();
  return { rpc: raw ? (JSON.parse(raw) as Rpc) : null, session: res.headers.get('mcp-session-id') };
}

test('a write tool call waits for UI approval, then lands', async ({ kira, kiraHome }) => {
  const { DatabaseSync } = await import('node:sqlite');
  const dir = mkdtempSync(join(tmpdir(), 'kira-mcp-'));
  mkdirSync(dir, { recursive: true });
  const dbPath = join(dir, 'notes.db');
  const seed = new DatabaseSync(dbPath);
  seed.exec(
    "create table notes (id integer primary key, body text); insert into notes (body) values ('one')",
  );
  seed.close();

  try {
    const conn = await kira.call<{ id: string }>('ConnectionsService', 'Create', {
      name: 'notes db',
      kind: 'sqlite',
      color: 'teal',
      mode: 'fields',
      readOnly: false,
      host: null,
      port: null,
      database: dbPath,
      username: null,
      uri: null,
      options: {},
      preconnect: null,
      preconnectSidecar: false,
      autoExplain: false,
      throttlePerSec: 0,
      mcpEnabled: true,
      mcpDescription: 'scratch',
      mcpReadMode: 'allow',
      mcpWriteMode: 'prompt',
      mcpDdlMode: 'deny',
      mcpAutoExplain: true,
      password: null,
    });

    const page = kira.window;
    await openMainWindow(kira);
    await page.click('[data-testid="open-settings"]');
    await page.click('[data-testid="settings-section-Database MCP"]');
    await page.locator('[data-testid="settings-db-mcp-enabled"]').click();
    await expect(page.locator('[data-testid="db-mcp-command"]')).toBeVisible({ timeout: 15_000 });

    const status = await kira.call<{ command: string; running: boolean }>('DbMcpService', 'Status');
    expect(status.running).toBe(true);
    const url = /"url":"([^"]+)"/.exec(status.command)?.[1];
    if (!url) throw new Error(`no url in ${status.command}`);
    const token = readFileSync(join(kiraHome, 'mcp-db-header.token'), 'utf8').trim();

    const init = await post(url, token, null, {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'e2e', version: '1' },
      },
    });
    await post(url, token, init.session, { jsonrpc: '2.0', method: 'notifications/initialized' });

    const call = post(url, token, init.session, {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: {
        name: 'run_query',
        arguments: { connectionId: conn.id, sql: "insert into notes (body) values ('two')" },
      },
    });
    const dialog = page.locator('[data-testid="db-mcp-approval-dialog"]');
    await expect(dialog).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('[data-testid="db-mcp-approval-statement"]')).toContainText(
      'insert into notes',
    );
    await page.click('[data-testid="db-mcp-approval-approve"]');
    const { rpc } = await call;
    expect(rpc?.error).toBeUndefined();
    expect(rpc?.result?.isError).not.toBe(true);

    const check = new DatabaseSync(dbPath);
    const n = check.prepare('select count(*) as n from notes').get() as { n: number };
    check.close();
    expect(n.n).toBe(2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
