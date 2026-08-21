import { execFile } from 'node:child_process';
import { homedir } from 'node:os';
import { promisify } from 'node:util';

// Colima setup (verbatim, P1 Step 11a):
//
//   colima start --cpu 4 --memory 6 --disk 40      # once; `colima status` to check
//   docker context use colima
//   # Testcontainers reads DOCKER_HOST; Colima's socket is not the default path:
//   export DOCKER_HOST="unix://$HOME/.colima/default/docker.sock"
//   # Ryuk (the reaper container) bind-mounts the socket at its *in-container* path,
//   # which must be the conventional one even though the host path differs:
//   export TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=/var/run/docker.sock
//
// This module does that automatically so a developer with a clean shell is not stuck.

const execFileAsync = promisify(execFile);

export async function resolveDockerHost(): Promise<void> {
  if (process.env.DOCKER_HOST) return;
  try {
    const { stdout } = await execFileAsync('docker', [
      'context',
      'inspect',
      '--format',
      '{{.Endpoints.docker.Host}}',
    ]);
    const host = stdout.trim();
    if (!host) return;
    process.env.DOCKER_HOST = host;
    if (host.includes('.colima') || host.includes(homedir())) {
      process.env.TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE ??= '/var/run/docker.sock';
    }
  } catch {
    // docker CLI unavailable — leave the env unset and let isDockerAvailable report it.
  }
}

export async function isDockerAvailable(): Promise<boolean> {
  await resolveDockerHost();
  try {
    await execFileAsync('docker', ['info'], { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

export function colimaHint(): string {
  return (
    'Docker daemon unreachable — run `colima start --cpu 4 --memory 6 --disk 40` and ' +
    '`docker context use colima`.'
  );
}
