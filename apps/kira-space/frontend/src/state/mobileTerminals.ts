import type { MobileTerminalHold } from '@shared/domain/mobile';
import { hydrateThenSubscribe } from '@workbench/state/hydrateThenSubscribe';
import { loadTerminalRenderer } from '@workbench/terminal/terminalRendererLoader';
import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { control } from '../bridge/control';

// P212 Part 2: which phone controls which agent terminal. Desktop-only; the phone never sees it.
export const useMobileTerminalsStore = defineStore('mobileTerminals', () => {
  const holds = ref<MobileTerminalHold[]>([]);
  const byTerminal = computed(() => new Map(holds.value.map((h) => [h.terminalId, h])));
  let off: (() => void) | null = null;

  async function hydrateMobileTerminals(): Promise<void> {
    off?.();
    off = await hydrateThenSubscribe({
      snapshot: () => control.mobileTerminalHolds(),
      subscribe: (cb) => control.onMobileTerminals(cb),
      apply: (list) => {
        holds.value = list;
      },
    });
  }

  function holdOf(terminalId: string): MobileTerminalHold | undefined {
    return byTerminal.value.get(terminalId);
  }

  function countFor(deviceId: string): number {
    return holds.value.filter((h) => h.deviceId === deviceId).length;
  }

  // The window's own size goes along so the PTY returns to what this xterm shows; 0,0 keeps the
  // size the window last reported.
  async function reclaim(terminalId: string): Promise<void> {
    const dims = await loadTerminalRenderer()
      .then((r) => r.fitTerminal(terminalId))
      .catch(() => null);
    await control.mobileReclaimTerminal(terminalId, dims?.cols ?? 0, dims?.rows ?? 0);
  }

  return { holds, hydrateMobileTerminals, holdOf, countFor, reclaim };
});
