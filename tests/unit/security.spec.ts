import { describe, expect, test } from 'bun:test';
import { rendererWebPreferences } from '../../src/main/security';

describe('src/main/security.ts — rendererWebPreferences (P46 D69/D73)', () => {
  test('1. returns exactly the renderer web preferences this app sets — no more, no less', () => {
    expect(rendererWebPreferences({ preload: '/preload.js', isDev: true })).toEqual({
      preload: '/preload.js',
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      devTools: true,
    });
  });

  test('2. devTools is true for a dev build and false for a packaged one (P46 D70)', () => {
    expect(rendererWebPreferences({ preload: '/preload.js', isDev: true }).devTools).toBe(true);
    expect(rendererWebPreferences({ preload: '/preload.js', isDev: false }).devTools).toBe(false);
  });
});
