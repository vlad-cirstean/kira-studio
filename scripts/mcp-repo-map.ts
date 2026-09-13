#!/usr/bin/env bun
/**
 * The dev launch path for the repo-map MCP server (docs/v1.5/plans/C3-mcp-repo-map-server.md §3.1):
 * `bun run mcp:repo-map` builds `cmd/kira-repo-map`, then execs it — one independent, long-running
 * instance per invocation over MCP's Streamable HTTP transport, unmanaged by any Kira Studio
 * setting (§0 D1/D7; the embedded instance the app itself owns is a separate code path,
 * internal/bridge/repomap.go). This wrapper holds no protocol knowledge and no logic worth testing
 * beyond "build, then spawn, then forward" — the server itself prints its own ready-to-copy
 * registration command on a successful bind (§3.1's own correction: stdout is a normal log stream
 * under HTTP, not reserved for JSON-RPC framing the way it was under the stdio design this plan
 * started from and abandoned).
 *
 * Always builds, never conditionally: a staleness heuristic over Go sources is a second build
 * system, and Go's own build cache makes a no-op build sub-second. The first build after a fresh
 * clone is genuinely slow (codeparse is cgo over ~34 MB of generated C, C1 §1.3) — run
 * `bun run mcp:repo-map:build` once ahead of time if that matters (docs/DEV_ENVIRONMENT.md).
 */
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '..');
const BIN = join(ROOT, 'apps', 'kira-studio', 'bin', 'kira-repo-map');

async function pipeToStderr(stream: ReadableStream<Uint8Array> | null): Promise<void> {
  if (!stream) return;
  for await (const chunk of stream) {
    process.stderr.write(chunk);
  }
}

/** Builds the binary, routing the build's own stdout and stderr both to this process's stderr —
 *  build noise stays out of the way of the server's own startup banner (its listening URL and
 *  registration command), printed to stdout once the build hands off to it below. */
async function build(): Promise<void> {
  const proc = Bun.spawn(['go', 'build', '-o', BIN, './apps/kira-studio/cmd/kira-repo-map'], {
    cwd: ROOT,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  await Promise.all([pipeToStderr(proc.stdout), pipeToStderr(proc.stderr)]);
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    console.error(`mcp-repo-map: go build exited ${exitCode}`);
    process.exit(exitCode);
  }
}

/** Args after the script's own name forward straight through to the binary (`bun run mcp:repo-map
 *  -- --repo /some/worktree`) — `bun run` strips the `--` separator itself, but a defensive check
 *  costs nothing if that ever changes. */
function forwardedArgs(): string[] {
  const args = process.argv.slice(2);
  return args[0] === '--' ? args.slice(1) : args;
}

async function main(): Promise<void> {
  await build();

  const child = Bun.spawn([BIN, ...forwardedArgs()], {
    cwd: ROOT,
    stdio: ['inherit', 'inherit', 'inherit'],
  });

  process.on('SIGINT', () => child.kill('SIGINT'));
  process.on('SIGTERM', () => child.kill('SIGTERM'));

  const exitCode = await child.exited;
  process.exit(exitCode);
}

if (import.meta.main) {
  await main();
}
