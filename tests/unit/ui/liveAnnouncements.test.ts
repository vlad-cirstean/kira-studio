import { describe, expect, test } from "bun:test";
import {
  composeLoadMoreAnnouncement,
  composeRefreshAnnouncement,
  formatCount,
} from "../../../packages/ui/src/state/liveAnnouncements.ts";

describe("formatCount", () => {
  test("groups thousands", () => {
    expect(formatCount(122400)).toBe("122,400");
  });
});

describe("composeLoadMoreAnnouncement", () => {
  test("the plan's own worked example", () => {
    expect(composeLoadMoreAnnouncement(5000, 122400, false)).toBe(
      "5,000 more loaded, 122,400 remaining",
    );
  });

  test("exhausted reads as 'history fully loaded', not '0 remaining'", () => {
    expect(composeLoadMoreAnnouncement(400, 0, true)).toBe("400 more loaded, history fully loaded");
  });
});

describe("composeRefreshAnnouncement", () => {
  test("pluralizes 'commits' for anything but exactly one", () => {
    expect(composeRefreshAnnouncement(20000)).toBe("Refreshed — 20,000 commits loaded");
    expect(composeRefreshAnnouncement(0)).toBe("Refreshed — 0 commits loaded");
  });

  test("singular for exactly one commit", () => {
    expect(composeRefreshAnnouncement(1)).toBe("Refreshed — 1 commit loaded");
  });
});
