import { describe, expect, test } from "bun:test";
import {
  InMemoryViewStateStore,
  parsePersistedViewState,
} from "../../../packages/ui/src/state/viewState.ts";

/**
 * W9's "Done when": a `version: 2` persisted state is discarded. `parsePersistedViewState`
 * discards whole, never partially — this exercises that directly and through the harness's
 * `ViewStateStore`, since every concrete store defers to it.
 */

describe("parsePersistedViewState", () => {
  test("accepts a well-formed version-1 state", () => {
    const state = { version: 1 as const, repoId: "r1", loadedRows: 42, detailOpen: true };
    expect(parsePersistedViewState(state)).toEqual(state);
  });

  test("accepts a null repoId", () => {
    const state = { version: 1 as const, repoId: null, loadedRows: 0, detailOpen: false };
    expect(parsePersistedViewState(state)).toEqual(state);
  });

  test("discards a future version whole, not partially", () => {
    const state = { version: 2, repoId: "r1", loadedRows: 42, detailOpen: true };
    expect(parsePersistedViewState(state)).toBeNull();
  });

  test("discards non-object and null raw values", () => {
    expect(parsePersistedViewState(null)).toBeNull();
    expect(parsePersistedViewState(undefined)).toBeNull();
    expect(parsePersistedViewState("v1")).toBeNull();
    expect(parsePersistedViewState(42)).toBeNull();
  });

  test("discards a shape missing a required field", () => {
    expect(parsePersistedViewState({ version: 1, repoId: "r1", loadedRows: 42 })).toBeNull();
  });
});

describe("InMemoryViewStateStore", () => {
  test("read() returns null before any write", () => {
    const store = new InMemoryViewStateStore();
    expect(store.read()).toBeNull();
  });

  test("round-trips a state written through write()", () => {
    const store = new InMemoryViewStateStore();
    const state = { version: 1 as const, repoId: "r1", loadedRows: 7, detailOpen: false };
    store.write(state);
    expect(store.read()).toEqual(state);
  });

  test("discards a version-2 state injected via setRaw", () => {
    const store = new InMemoryViewStateStore();
    store.setRaw({ version: 2, repoId: "r1", loadedRows: 7, detailOpen: false });
    expect(store.read()).toBeNull();
  });
});
