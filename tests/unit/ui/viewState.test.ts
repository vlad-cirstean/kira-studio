import { describe, expect, test } from "bun:test";
import {
  InMemoryViewStateStore,
  parsePersistedViewState,
  type PersistedViewState,
} from "../../../packages/ui/src/state/viewState.ts";

/**
 * P4 W5's own "Done when": a v1 persisted state is discarded and a v2 one round-trips every
 * field. `parsePersistedViewState` discards whole, never partially — this exercises that
 * directly and through the harness's `ViewStateStore`, since every concrete store defers to it.
 */

function fullState(overrides: Partial<PersistedViewState> = {}): PersistedViewState {
  return {
    version: 2,
    repoId: "r1",
    loadedRows: 42,
    detailOpen: true,
    scrollRow: 17,
    selectedSha: "abc123",
    columnWidths: { author: 150, date: 130, sha: 90 },
    dateFormat: "absolute",
    detailWidth: 420,
    ...overrides,
  };
}

describe("parsePersistedViewState", () => {
  test("accepts a well-formed version-2 state and round-trips every field", () => {
    const state = fullState();
    expect(parsePersistedViewState(state)).toEqual(state);
  });

  test("accepts null repoId and selectedSha", () => {
    const state = fullState({ repoId: null, selectedSha: null });
    expect(parsePersistedViewState(state)).toEqual(state);
  });

  test("accepts either dateFormat value", () => {
    expect(parsePersistedViewState(fullState({ dateFormat: "relative" }))?.dateFormat).toBe(
      "relative",
    );
    expect(parsePersistedViewState(fullState({ dateFormat: "absolute" }))?.dateFormat).toBe(
      "absolute",
    );
  });

  test("discards a v1 (P3-shaped) state whole, never partially", () => {
    const v1 = { version: 1, repoId: "r1", loadedRows: 42, detailOpen: true };
    expect(parsePersistedViewState(v1)).toBeNull();
  });

  test("discards a future version whole, not partially", () => {
    const state = { ...fullState(), version: 3 };
    expect(parsePersistedViewState(state)).toBeNull();
  });

  test("discards non-object and null raw values", () => {
    expect(parsePersistedViewState(null)).toBeNull();
    expect(parsePersistedViewState(undefined)).toBeNull();
    expect(parsePersistedViewState("v2")).toBeNull();
    expect(parsePersistedViewState(42)).toBeNull();
  });

  test("discards a shape missing a top-level required field", () => {
    const { detailWidth: _detailWidth, ...withoutDetailWidth } = fullState();
    expect(parsePersistedViewState(withoutDetailWidth)).toBeNull();
  });

  test("discards a shape with a malformed columnWidths", () => {
    expect(
      parsePersistedViewState({ ...fullState(), columnWidths: { author: 150, date: 130 } }),
    ).toBeNull();
    expect(parsePersistedViewState({ ...fullState(), columnWidths: null })).toBeNull();
  });

  test("discards an invalid dateFormat value", () => {
    expect(parsePersistedViewState({ ...fullState(), dateFormat: "iso" })).toBeNull();
  });
});

describe("InMemoryViewStateStore", () => {
  test("read() returns null before any write", () => {
    const store = new InMemoryViewStateStore();
    expect(store.read()).toBeNull();
  });

  test("round-trips a state written through write()", () => {
    const store = new InMemoryViewStateStore();
    const state = fullState({ loadedRows: 7, detailOpen: false });
    store.write(state);
    expect(store.read()).toEqual(state);
  });

  test("discards a v1-shaped state injected via setRaw", () => {
    const store = new InMemoryViewStateStore();
    store.setRaw({ version: 1, repoId: "r1", loadedRows: 7, detailOpen: false });
    expect(store.read()).toBeNull();
  });
});
