import { describe, expect, test } from "vitest";
import type { ChromeWindowInfo } from "./api";
import {
  buildGridWindowLayoutPlan,
  buildPrimaryWindowRegistry,
  maxTileableWindowCount,
  tileBoundsForCount,
  windowMatchesBounds
} from "./browserWindows";

function chromeWindow(
  overrides: Partial<ChromeWindowInfo> = {}
): ChromeWindowInfo {
  return {
    index: 1,
    title: "Chrome",
    x: 0,
    y: 0,
    width: 600,
    height: 800,
    ...overrides
  };
}

describe("browserWindows", () => {
  test("窗口注册表为账号记录首个窗口、多窗口和不可读原因", () => {
    const registry = buildPrimaryWindowRegistry([
      {
        profileId: "account-001",
        profileName: "主号",
        windows: [chromeWindow({ title: "主窗口" }), chromeWindow({ index: 2 })]
      },
      {
        profileId: "account-002",
        profileName: "抽奖号",
        windows: []
      },
      {
        profileId: "account-003",
        profileName: "任务号",
        windows: [],
        windowError: "辅助功能权限不足"
      }
    ]);

    expect(registry).toEqual([
      {
        profileId: "account-001",
        profileName: "主号",
        status: "ready",
        windowCount: 2,
        primaryWindow: chromeWindow({ title: "主窗口" }),
        hasMultipleWindows: true,
        minimized: false,
        windowError: null
      },
      {
        profileId: "account-002",
        profileName: "抽奖号",
        status: "missing",
        windowCount: 0,
        primaryWindow: null,
        hasMultipleWindows: false,
        minimized: false,
        windowError: null
      },
      {
        profileId: "account-003",
        profileName: "任务号",
        status: "error",
        windowCount: 0,
        primaryWindow: null,
        hasMultipleWindows: false,
        minimized: false,
        windowError: "辅助功能权限不足"
      }
    ]);
  });

  test("网格布局计划只给可用首窗分配位置并保留跳过原因", () => {
    const registry = buildPrimaryWindowRegistry([
      {
        profileId: "account-001",
        profileName: "主号",
        windows: [chromeWindow(), chromeWindow({ index: 2 })]
      },
      {
        profileId: "account-002",
        profileName: "抽奖号",
        windows: []
      },
      {
        profileId: "account-003",
        profileName: "任务号",
        windows: [chromeWindow()]
      }
    ]);

    const plan = buildGridWindowLayoutPlan(registry, {
      x: 10,
      y: 20,
      width: 1200,
      height: 800
    });

    expect(plan).toEqual({
      preset: "grid",
      requestedCount: 3,
      tileableCount: 2,
      capacity: 9,
      capacityExceeded: false,
      placements: [
        {
          profileId: "account-001",
          profileName: "主号",
          bounds: { x: 10, y: 20, width: 600, height: 800 }
        },
        {
          profileId: "account-003",
          profileName: "任务号",
          bounds: { x: 610, y: 20, width: 600, height: 800 }
        }
      ],
      skipped: [
        {
          profileId: "account-002",
          profileName: "抽奖号",
          reason: "missing-window"
        }
      ],
      multiWindowProfileCount: 1
    });
  });

  test("网格容量超出时不生成移动计划", () => {
    const registry = buildPrimaryWindowRegistry(
      Array.from({ length: 3 }, (_, index) => ({
        profileId: `account-00${index + 1}`,
        profileName: `账号 ${index + 1}`,
        windows: [chromeWindow()]
      }))
    );

    const plan = buildGridWindowLayoutPlan(
      registry,
      { x: 0, y: 0, width: 640, height: 240 },
      { minWindowWidth: 320, minWindowHeight: 240 }
    );

    expect(plan.capacity).toBe(2);
    expect(plan.capacityExceeded).toBe(true);
    expect(plan.placements).toEqual([]);
  });

  test("窗口边界工具保留既有平铺算法和容差判断", () => {
    expect(maxTileableWindowCount(1200, 800)).toBe(9);
    expect(tileBoundsForCount(2, 1200, 800, 10, 20)).toEqual([
      { x: 10, y: 20, width: 600, height: 800 },
      { x: 610, y: 20, width: 600, height: 800 }
    ]);
    expect(
      windowMatchesBounds(chromeWindow({ x: 11, y: 19, width: 601, height: 799 }), {
        x: 10,
        y: 20,
        width: 600,
        height: 800
      })
    ).toBe(true);
  });
});
