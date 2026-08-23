import type { SettingsSnapshot } from "@kira-version/ipc";
import { type ShallowRef, shallowRef } from "vue";
import type { BridgeClient } from "../bridge/client.ts";

/** The settings snapshot from `app.init`, kept current by `settings.changed` (P3 W9). */
export class SettingsState {
  readonly settings: ShallowRef<SettingsSnapshot>;

  readonly #unsubscribe: () => void;

  constructor(bridge: BridgeClient, initial: SettingsSnapshot) {
    this.settings = shallowRef(initial);
    this.#unsubscribe = bridge.on("settings.changed", (event) => {
      this.settings.value = event.settings;
    });
  }

  dispose(): void {
    this.#unsubscribe();
  }
}
