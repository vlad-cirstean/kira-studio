import { describe, expect, test } from "bun:test";
import { FakeStorage } from "../../../core/src/ports/testFakes.ts";
import { RecentRepos } from "../main/recentRepos.ts";
import { ElectronWorkspaceRoots } from "./workspaceRoots.ts";

describe("ElectronWorkspaceRoots", () => {
  test("list delegates to the underlying RecentRepos", async () => {
    const recentRepos = new RecentRepos(new FakeStorage());
    await recentRepos.add("/repo/a");
    const roots = new ElectronWorkspaceRoots(recentRepos);

    expect(await roots.list()).toEqual([{ path: "/repo/a", label: "a" }]);
  });

  test("onChanged delegates to the underlying RecentRepos, dispose included", async () => {
    const recentRepos = new RecentRepos(new FakeStorage());
    const roots = new ElectronWorkspaceRoots(recentRepos);

    let calls = 0;
    const subscription = roots.onChanged(() => {
      calls++;
    });

    await recentRepos.add("/repo/a");
    expect(calls).toBe(1);

    subscription.dispose();
    await recentRepos.add("/repo/b");
    expect(calls).toBe(1);
  });
});
