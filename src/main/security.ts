import type { WebPreferences } from 'electron';

export function rendererWebPreferences(opts: { preload: string; isDev: boolean }): WebPreferences {
  return {
    preload: opts.preload,
    contextIsolation: true,
    sandbox: true,
    nodeIntegration: false,
  };
}
