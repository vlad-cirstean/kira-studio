import { describe, expect, test } from "bun:test";
import { FakeStorage } from "../../../core/src/ports/testFakes.ts";
import { RecentRepos } from "./recentRepos.ts";

describe("RecentRepos", () => {
  test("list is empty when nothing has been added", () => {
    const recentRepos = new RecentRepos(new FakeStorage());
    expect(recentRepos.list()).toEqual([]);
  });

  test("add prepends the path, deriving label from the basename", async () => {
    const recentRepos = new RecentRepos(new FakeStorage());
    await recentRepos.add("/home/user/kira-version-vscode");
    expect(recentRepos.list()).toEqual([
      { path: "/home/user/kira-version-vscode", label: "kira-version-vscode" },
    ]);
  });

  test("re-adding an existing path moves it to the front instead of duplicating it", async () => {
    const recentRepos = new RecentRepos(new FakeStorage());
    await recentRepos.add("/repo/a");
    await recentRepos.add("/repo/b");
    await recentRepos.add("/repo/a");

    expect(recentRepos.list().map((entry) => entry.path)).toEqual(["/repo/a", "/repo/b"]);
  });

  test("the list is capped at 10 entries, dropping the oldest", async () => {
    const recentRepos = new RecentRepos(new FakeStorage());
    for (let i = 0; i < 12; i++) {
      await recentRepos.add(`/repo/${i}`);
    }

    const paths = recentRepos.list().map((entry) => entry.path);
    expect(paths).toHaveLength(10);
    expect(paths[0]).toBe("/repo/11");
    expect(paths).not.toContain("/repo/0");
    expect(paths).not.toContain("/repo/1");
  });

  test("onChanged fires on add, and dispose unsubscribes", async () => {
    const recentRepos = new RecentRepos(new FakeStorage());
    let calls = 0;
    const subscription = recentRepos.onChanged(() => {
      calls++;
    });

    await recentRepos.add("/repo/a");
    expect(calls).toBe(1);

    subscription.dispose();
    await recentRepos.add("/repo/b");
    expect(calls).toBe(1);
  });

  test("a fresh RecentRepos reads what a previous instance persisted through the same storage", async () => {
    const storage = new FakeStorage();
    const first = new RecentRepos(storage);
    await first.add("/repo/a");

    const second = new RecentRepos(storage);
    expect(second.list().map((entry) => entry.path)).toEqual(["/repo/a"]);
  });
});
