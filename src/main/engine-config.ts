import { ENGINE_OP } from '../shared/protocol/engine-ops';
import type { EngineHost } from './engine-host';
import { log } from './log';
import type { KiraDb } from './storage/db';
import { getAllSettings } from './storage/repos/settings';

/**
 * Pushes engine-relevant settings (today: the L2 cache byte budget) into the engine process.
 * Called once from main/index.ts after startEngine(), and again from ipc/settings.ts after a
 * patch that changes cache.l2BudgetMb. Failures are logged, never thrown — a settings save
 * must not fail because the engine is mid-restart.
 */
export async function pushEngineConfig(engineHost: EngineHost, db: KiraDb): Promise<void> {
  try {
    const settings = await getAllSettings(db);
    await engineHost.call(ENGINE_OP.configureCache, {
      l2BudgetBytes: settings.cache.l2BudgetMb * 1024 * 1024,
    });
  } catch (err) {
    log(
      'warn',
      'engine-config',
      `failed to push cache config to engine: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
