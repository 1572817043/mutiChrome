import { describe, expect, test } from "vitest";
import {
  createStartingBrowserSession,
  mergeBrowserSessionSnapshots,
  runningProfileIdsFromSessions
} from "./browserSessions";
import type { BrowserSessionSnapshot } from "./api";

describe("browserSessions", () => {
  test("保留 fresh starting 会话但不把它算作运行账号", () => {
    const current = {
      "account-001": createStartingBrowserSession("account-001", 1000)
    };
    const merged = mergeBrowserSessionSnapshots(
      current,
      [browserSessionSnapshot("account-001", false, 2000)],
      2000
    );

    expect(merged["account-001"].status).toBe("starting");
    expect(runningProfileIdsFromSessions(merged)).toEqual([]);
  });

  test("running 快照会立即覆盖 starting 会话", () => {
    const current = {
      "account-001": createStartingBrowserSession("account-001", 1000)
    };
    const merged = mergeBrowserSessionSnapshots(
      current,
      [browserSessionSnapshot("account-001", true, 2000)],
      2000
    );

    expect(merged["account-001"].status).toBe("running");
    expect(runningProfileIdsFromSessions(merged)).toEqual(["account-001"]);
  });
});

function browserSessionSnapshot(
  profileId: string,
  running: boolean,
  checkedAt: number
): BrowserSessionSnapshot {
  return {
    profileId,
    status: running ? "running" : "stopped",
    running,
    pid: running ? 1201 : null,
    windowCount: running ? null : 0,
    windows: [],
    windowError: null,
    checkedAt
  };
}
