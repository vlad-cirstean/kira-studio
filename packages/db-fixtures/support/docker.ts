// The dev machine's Docker daemon is Colima, not Docker Desktop. Testcontainers needs three
// things:
//
//   colima start --cpu 4 --memory 6 --disk 40      # once; `colima status` to check
//   docker context use colima
//   # Testcontainers reads DOCKER_HOST; Colima's socket is not the default path:
//   export DOCKER_HOST="unix://$HOME/.colima/default/docker.sock"
//   # Ryuk (the reaper container) bind-mounts the socket at its *in-container* path, which
//   # must be the conventional one even though the host path differs:
//   export TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=/var/run/docker.sock
//
// This file does the first two automatically so a developer with a clean shell is not stuck.

import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const PROBE_TIMEOUT_MS = 5000;

export function resolveDockerHost(): void {
  if (process.env.DOCKER_HOST) return;
  try {
    // Synchronous on purpose: this runs once, at module load, before any container work
    // starts — an async version would need every caller to await it first.
    const host = execFileSync(
      'docker',
      ['context', 'inspect', '--format', '{{.Endpoints.docker.Host}}'],
      { encoding: 'utf8', timeout: PROBE_TIMEOUT_MS },
    ).trim();
    if (host) {
      process.env.DOCKER_HOST = host;
      if (host.includes('.colima') && !process.env.TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE) {
        process.env.TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE = '/var/run/docker.sock';
      }
    }
  } catch {
    // No `docker` CLI, or no context configured — isDockerAvailable() below will report this
    // with a legible message rather than leaving Testcontainers to fail cryptically later.
  }
}

resolveDockerHost();

export async function isDockerAvailable(): Promise<boolean> {
  try {
    await execFileAsync('docker', ['info'], { timeout: PROBE_TIMEOUT_MS });
    return true;
  } catch {
    return false;
  }
}

export const DOCKER_UNAVAILABLE_MESSAGE =
  'Docker daemon unreachable — start Colima with `colima start --cpu 4 --memory 6 --disk 40` ' +
  '(not Docker Desktop) and retry.';
