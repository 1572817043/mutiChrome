import { describe, expect, test } from "vitest";
import type { ChromeWindowInfo, WindowBounds } from "../../api";
import type { WindowSyncPlan } from "../../browserWindows";
import {
  buildWindowSyncPreviewDetails,
  createEmptyWindowSyncControllerResult,
  executeWindowSyncPlan
} from "./windowSyncController";

function chromeWindow(overrides: Partial<ChromeWindowInfo> = {}): ChromeWindowInfo {
  return {
    index: 1,
    title: "Chrome",
    x: 80,
    y: 120,
    width: 960,
    height: 720,
    ...overrides
  };
}

function syncPlan(overrides: Partial<WindowSyncPlan> = {}): WindowSyncPlan {
  return {
    sourceProfileId: "account-001",
    sourceProfileName: "主号",
    sourceStatus: "ready",
    sourceBounds: { x: 80, y: 120, width: 960, height: 720 },
    sourceWindowError: null,
    placements: [
      {
        profileId: "account-002",
        profileName: "目标号",
        bounds: { x: 80, y: 120, width: 960, height: 720 }
      }
    ],
    skipped: [],
    noWindowCount: 0,
    minimizedCount: 0,
    failedCount: 0,
    ...overrides
  };
}

describe("executeWindowSyncPlan", () => {
  test("设置并读回匹配时计入 synced 并返回账号 ID", async () => {
    const setBounds = async (_profileId: string, _bounds: WindowBounds) => {};
    const readWindows = async (_profileId: string) => [chromeWindow()];

    await expect(
      executeWindowSyncPlan(syncPlan(), { setBounds, readWindows })
    ).resolves.toMatchObject({
      syncedCount: 1,
      unchangedCount: 0,
      failedCount: 0,
      firstFailedError: null,
      syncedProfileIds: ["account-002"],
      entries: [
        {
          profileId: "account-002",
          profileName: "目标号",
          status: "synced",
          error: null
        }
      ]
    });
  });

  test.each([
    ["读回无窗口", async () => []],
    ["读回边界不匹配", async () => [chromeWindow({ x: 0, y: 0 })]]
  ])("%s 时计入 unchanged 而不是 failed", async (_label, readWindows) => {
    const setBounds = async (_profileId: string, _bounds: WindowBounds) => {};

    await expect(
      executeWindowSyncPlan(syncPlan(), { setBounds, readWindows })
    ).resolves.toMatchObject({
      syncedCount: 0,
      unchangedCount: 1,
      failedCount: 0,
      syncedProfileIds: [],
      entries: [
        {
          profileId: "account-002",
          status: "unchanged",
          error: null
        }
      ]
    });
  });

  test.each([
    ["设置", async () => { throw new Error("设置失败"); }, async () => [chromeWindow()]],
    ["确认", async () => {}, async () => { throw new Error("确认失败"); }]
  ])("%s抛错时计入 failed 并记录 firstFailedError", async (_label, setBounds, readWindows) => {
    await expect(
      executeWindowSyncPlan(syncPlan(), { setBounds, readWindows })
    ).resolves.toMatchObject({
      syncedCount: 0,
      unchangedCount: 0,
      failedCount: 1,
      firstFailedError: expect.any(Error),
      syncedProfileIds: [],
      entries: [
        {
          profileId: "account-002",
          status: "failed",
          error: expect.any(Error)
        }
      ]
    });
  });

  test("placement 目标 profile 缺失时计入 failed 而不是 unchanged", async () => {
    const missingProfileError = new Error("同步目标 profile 不存在: account-002");

    await expect(
      executeWindowSyncPlan(syncPlan(), {
        setBounds: async (profileId) => {
          if (profileId === "account-002") {
            throw missingProfileError;
          }
        },
        readWindows: async () => []
      })
    ).resolves.toMatchObject({
      syncedCount: 0,
      unchangedCount: 0,
      failedCount: 1,
      firstFailedError: missingProfileError,
      entries: [{ status: "failed", error: missingProfileError }]
    });
  });

  test("计划失败和执行失败会相加并保留已有首个错误", async () => {
    const plan = syncPlan({ failedCount: 2 });
    const firstFailedError = new Error("目标读取失败");
    const executionError = new Error("同步设置失败");

    await expect(
      executeWindowSyncPlan(
        plan,
        {
          setBounds: async () => {
            throw executionError;
          },
          readWindows: async () => []
        },
        { firstFailedError }
      )
    ).resolves.toMatchObject({
      unchangedCount: 0,
      failedCount: 3,
      firstFailedError,
      syncedProfileIds: [],
      entries: [{ status: "failed", error: executionError }]
    });
  });

  test("preview details 保留 source、placements 和 skipped", () => {
    const plan = syncPlan({
      sourceStatus: "ready",
      skipped: [
        {
          profileId: "account-003",
          profileName: "最小化号",
          reason: "minimized-window"
        }
      ],
      minimizedCount: 1
    });

    expect(buildWindowSyncPreviewDetails(plan)).toEqual({
      mode: "preview",
      plan
    });
  });

  test("empty result 保留 source plan 的跳过计数并使用 result 结构", () => {
    const plan = syncPlan({ noWindowCount: 1, minimizedCount: 2 });

    expect(createEmptyWindowSyncControllerResult(plan)).toEqual({
      syncedCount: 0,
      unchangedCount: 0,
      failedCount: 0,
      firstFailedError: null,
      syncedProfileIds: [],
      noWindowCount: 1,
      minimizedCount: 2,
      entries: []
    });
  });
});
