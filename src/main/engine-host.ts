import { join } from 'node:path';
import { type MessagePortMain, type UtilityProcess, utilityProcess } from 'electron';
import { log } from './log';

export interface EngineHost {
  status(): { alive: boolean; pid: number | null };
  attachRendererPort(port: MessagePortMain, generation: number): void;
  stop(): void;
}

export function startEngine(): EngineHost {
  let alive = true;

  const child: UtilityProcess = utilityProcess.fork(join(__dirname, 'engine.js'), [], {
    serviceName: 'kira-engine',
    stdio: 'pipe',
    execArgv: ['--max-old-space-size=512'],
  });

  child.stdout?.on('data', (chunk: Buffer) => log('info', 'engine', chunk.toString().trimEnd()));
  child.stderr?.on('data', (chunk: Buffer) => log('error', 'engine', chunk.toString().trimEnd()));
  child.on('exit', (code) => {
    alive = false;
    log('warn', 'engine-host', `engine exited with code ${code}`);
  });

  return {
    status: () => ({ alive, pid: alive ? (child.pid ?? null) : null }),
    attachRendererPort(port, generation) {
      child.postMessage({ kind: 'attach-port', generation }, [port]);
    },
    stop() {
      if (alive) child.kill();
    },
  };
}
