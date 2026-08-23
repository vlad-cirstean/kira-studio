import { CommitStore } from "@kira-version/core";
import type { StreamChunkOf } from "@kira-version/ipc";
import { markRaw, type ShallowRef, shallowRef } from "vue";
import type { BridgeClient } from "../bridge/client.ts";

export type ChunkSource = StreamChunkOf<"graph.stream">["source"];

/**
 * The UI-side half of §5.4's cache/rehydration story (P3 W9). `store` is the client's own
 * `CommitStore`, fed one `graph.stream` chunk at a time via `appendPacked` — which is also
 * where the ordering guarantee lives: `CommitStore.appendPacked` throws if a chunk does not
 * start exactly at the store's current row count, so an out-of-order or duplicated chunk is a
 * loud bug rather than silently corrupted state. This file adds no ordering check of its own;
 * the store's is the only one, and re-implementing it here would just be a second place to
 * get it wrong.
 *
 * `store` is `markRaw`'d and never becomes reactive (§5.3) — only the four scalars below are.
 */
export class GraphViewState {
  readonly store: CommitStore;
  readonly loadedRows: ShallowRef<number> = shallowRef(0);
  readonly remaining: ShallowRef<number> = shallowRef(0);
  readonly exhausted: ShallowRef<boolean> = shallowRef(false);
  readonly lastChunkSource: ShallowRef<ChunkSource | undefined> = shallowRef(undefined);

  readonly #bridge: BridgeClient;
  #abortController: AbortController | undefined;

  constructor(bridge: BridgeClient) {
    this.#bridge = bridge;
    this.store = markRaw(new CommitStore());
  }

  /**
   * Opens `graph.stream` for `repoId`. `resumeThroughRow` defaults to this store's own current
   * row count, which is exactly what a post-remount rehydration needs: a freshly constructed
   * `GraphViewState` (the only kind that exists right after a VS Code webview is recreated,
   * §2.1) starts at 0, so the default asks the host to replay every row it still has cached
   * from row 0 — the single round trip that is "rehydrates without re-running git" from the
   * UI's side (§5.4). The same default also makes a same-session reconnect (the store already
   * holds N rows) resume from N instead of re-fetching them.
   *
   * Supersedes any still-open stream on this instance, matching W2's own
   * supersede-on-reopen rule for the transport underneath.
   */
  async openStream(
    repoId: string,
    resumeThroughRow: number = this.loadedRows.value,
  ): Promise<void> {
    this.#abortController?.abort();
    const controller = new AbortController();
    this.#abortController = controller;
    await this.#bridge.stream(
      "graph.stream",
      { repoId, resumeThroughRow },
      (chunk) => this.#applyChunk(chunk),
      controller.signal,
    );
  }

  /** Clears every loaded row. Call before opening a stream for a newly *selected* repo — never
   *  needed for a fresh mount or remount, whose store already starts empty. */
  reset(): void {
    this.store.clear();
    this.loadedRows.value = 0;
    this.remaining.value = 0;
    this.exhausted.value = false;
    this.lastChunkSource.value = undefined;
  }

  #applyChunk(chunk: StreamChunkOf<"graph.stream">): void {
    this.store.appendPacked(chunk.commits);
    this.loadedRows.value = this.store.rowCount;
    this.remaining.value = chunk.remaining;
    this.exhausted.value = chunk.exhausted;
    this.lastChunkSource.value = chunk.source;
  }

  dispose(): void {
    this.#abortController?.abort();
  }
}
