import {
  createKeyValuePageBuilder,
  type KeyValuePage,
  type Page,
  type PagePosition,
} from '@shared/protocol/page';
import type { OpCtx } from '../adapter';
import { AdapterError } from '../errors';
import type { DbConnectionSet } from './client';
import { mapError } from './errors';

// §8.14: "for non-SQL engines the console takes that engine's native command form" — real Redis
// CLI syntax is flat whitespace-separated tokens with optional single/double quoting (backslash
// escapes inside quotes), not a JSON DSL like Mongo's shell (P9's D11).
function tokenize(line: string): string[] {
  const tokens: string[] = [];
  const n = line.length;
  let i = 0;
  while (i < n) {
    while (i < n && /\s/.test(line[i])) i++;
    if (i >= n) break;
    const quote = line[i];
    if (quote === '"' || quote === "'") {
      i++;
      let out = '';
      while (i < n && line[i] !== quote) {
        if (line[i] === '\\' && i + 1 < n) {
          out += line[i + 1];
          i += 2;
        } else {
          out += line[i];
          i++;
        }
      }
      if (i >= n) throw new AdapterError('E_QUERY', 'unterminated quoted string');
      i++; // closing quote
      tokens.push(out);
    } else {
      let out = '';
      while (i < n && !/\s/.test(line[i])) {
        out += line[i];
        i++;
      }
      tokens.push(out);
    }
  }
  return tokens;
}

function formatReplyItem(value: unknown): string {
  if (value === null || value === undefined) return '(nil)';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Buffer.isBuffer(value)) return value.toString('utf8');
  return JSON.stringify(value);
}

// Any RESP reply is formatted generically (P9's D11) — no per-command result shape, unlike
// Mongo's console, which needs one because each shell method returns a different document shape.
function resultToPage(command: string, reply: unknown): KeyValuePage {
  const builder = createKeyValuePageBuilder({
    redisType: 'string',
    ttlMs: null,
    memoryBytes: null,
  });
  let pageSize: number;
  if (Array.isArray(reply)) {
    reply.forEach((item, i) => {
      builder.push(String(i), formatReplyItem(item));
    });
    pageSize = reply.length;
  } else {
    builder.push(command.toUpperCase(), formatReplyItem(reply));
    pageSize = 1;
  }
  const position: PagePosition = {
    offset: 0,
    pageSize,
    hasMore: false,
    nextToken: null,
    prevToken: null,
    strategy: 'offset',
  };
  return builder.finish(position);
}

// One op-log row for the whole batch (P5.5 D9's precedent, mirrored from mysql-family/console.ts and
// mongo/console.ts).
export async function execute(
  set: DbConnectionSet,
  dbIndex: number,
  ctx: OpCtx,
  statements: string[],
): Promise<Page[]> {
  const lines = statements.map((s) => s.trim()).filter((s) => s !== '');
  if (lines.length === 0) throw new AdapterError('E_QUERY', 'no statements to execute');
  ctx.setCommand(lines.join('\n'));

  const conn = await set.get(dbIndex);
  const pages: Page[] = [];
  for (const line of lines) {
    if (ctx.signal.aborted) throw new AdapterError('E_CANCELLED', 'operation was cancelled');
    const [command, ...args] = tokenize(line);
    if (!command) continue;
    try {
      const reply = await conn.call(command, ...args);
      pages.push(resultToPage(command, reply));
    } catch (err) {
      throw mapError(err);
    }
  }
  if (pages.length === 0) throw new AdapterError('E_QUERY', 'no statements to execute');
  return pages;
}
