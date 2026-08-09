import { describe, expect, test } from "vitest";
import type { ChromeWindowInfo } from "./api";
import {
  buildWindowLayoutSyncPlan,
  buildGridWindowLayoutPlan,
  buildWindowLayoutPlan,
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

  test("双列布局按从左到右、从上到下排列并保留工作区原点", () => {
    const registry = buildPrimaryWindowRegistry(
      Array.from({ length: 4 }, (_, index) => ({
        profileId: `account-00${index + 1}`,
        profileName: `账号 ${index + 1}`,
        windows: [chromeWindow()]
      }))
    );

    const plan = buildWindowLayoutPlan(
      registry,
      { x: 10, y: 20, width: 800, height: 600 },
      { preset: "two-columns", minWindowWidth: 320, minWindowHeight: 240 }
    );

    expect(plan.capacityExceeded).toBe(false);
    expect(plan.placements.map(({ bounds }) => bounds)).toEqual([
      { x: 10, y: 20, width: 400, height: 300 },
      { x: 410, y: 20, width: 400, height: 300 },
      { x: 10, y: 320, width: 400, height: 300 },
      { x: 410, y: 320, width: 400, height: 300 }
    ]);
  });

  test("双列布局在最小尺寸容量不足时不生成移动计划", () => {
    const registry = buildPrimaryWindowRegistry(
      Array.from({ length: 3 }, (_, index) => ({
        profileId: `account-00${index + 1}`,
        profileName: `账号 ${index + 1}`,
        windows: [chromeWindow()]
      }))
    );

    const plan = buildWindowLayoutPlan(
      registry,
      { x: 10, y: 20, width: 640, height: 240 },
      { preset: "two-columns", minWindowWidth: 320, minWindowHeight: 240 }
    );

    expect(plan.capacity).toBe(2);
    expect(plan.capacityExceeded).toBe(true);
    expect(plan.placements).toEqual([]);
  });

  test("左主右辅布局保留原点并在右侧竖向排列", () => {
    const registry = buildPrimaryWindowRegistry(
      Array.from({ length: 3 }, (_, index) => ({
        profileId: `account-00${index + 1}`,
        profileName: `账号 ${index + 1}`,
        windows: [chromeWindow()]
      }))
    );

    const plan = buildWindowLayoutPlan(
      registry,
      { x: 30, y: 40, width: 1000, height: 800 },
      { preset: "left-main", minWindowWidth: 320, minWindowHeight: 240 }
    );

    expect(plan.capacityExceeded).toBe(false);
    expect(plan.placements.map(({ bounds }) => bounds)).toEqual([
      { x: 30, y: 40, width: 600, height: 800 },
      { x: 630, y: 40, width: 400, height: 400 },
      { x: 630, y: 440, width: 400, height: 400 }
    ]);
  });

  test("左主右辅布局在主区或辅区低于最小尺寸时报告容量不足", () => {
    const registry = buildPrimaryWindowRegistry(
      Array.from({ length: 2 }, (_, index) => ({
        profileId: `account-00${index + 1}`,
        profileName: `账号 ${index + 1}`,
        windows: [chromeWindow()]
      }))
    );

    const plan = buildWindowLayoutPlan(
      registry,
      { x: 30, y: 40, width: 600, height: 800 },
      { preset: "left-main", minWindowWidth: 320, minWindowHeight: 240 }
    );

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

  test("同步布局计划使用主账号首窗边界并排除主账号 placement", () => {
    const registry = buildPrimaryWindowRegistry([
      {
        profileId: "account-001",
        profileName: "主号",
        windows: [
          chromeWindow({
            title: "主窗口",
            x: 80,
            y: 120,
            width: 960,
            height: 720
          })
        ]
      },
      {
        profileId: "account-002",
        profileName: "抽奖号",
        windows: [chromeWindow({ title: "目标窗口" })]
      }
    ]);

    const plan = buildWindowLayoutSyncPlan(registry, "account-001");

    expect(plan).toEqual({
      sourceProfileId: "account-001",
      sourceProfileName: "主号",
      sourceStatus: "ready",
      sourceBounds: { x: 80, y: 120, width: 960, height: 720 },
      sourceWindowError: null,
      placements: [
        {
          profileId: "account-002",
          profileName: "抽奖号",
          bounds: { x: 80, y: 120, width: 960, height: 720 }
        }
      ],
      skipped: [],
      noWindowCount: 0,
      minimizedCount: 0,
      failedCount: 0
    });
  });

  test("同步布局计划只统计目标账号的缺失、最小化和读取失败", () => {
    const registry = buildPrimaryWindowRegistry([
      {
        profileId: "account-001",
        profileName: "主号",
        windows: [chromeWindow({ minimized: true })]
      },
      {
        profileId: "account-002",
        profileName: "无窗口号",
        windows: []
      },
      {
        profileId: "account-003",
        profileName: "最小化号",
        windows: [chromeWindow({ minimized: true })]
      },
      {
        profileId: "account-004",
        profileName: "权限失败号",
        windows: [],
        windowError: "辅助功能权限不足"
      }
    ]);

    const plan = buildWindowLayoutSyncPlan(registry, "account-001");

    expect(plan).toMatchObject({
      sourceProfileId: "account-001",
      sourceProfileName: "主号",
      sourceStatus: "minimized-window",
      sourceBounds: null,
      sourceWindowError: null,
      placements: [],
      skipped: [
        {
          profileId: "account-002",
          profileName: "无窗口号",
          reason: "missing-window"
        },
        {
          profileId: "account-003",
          profileName: "最小化号",
          reason: "minimized-window"
        },
        {
          profileId: "account-004",
          profileName: "权限失败号",
          reason: "window-error"
        }
      ],
      noWindowCount: 1,
      minimizedCount: 1,
      failedCount: 1
    });
  });

  test("同步布局计划保留主账号窗口读取失败信息", () => {
    const registry = buildPrimaryWindowRegistry([
      {
        profileId: "account-001",
        profileName: "主号",
        windows: [],
        windowError: "读取主窗口失败"
      },
      {
        profileId: "account-002",
        profileName: "抽奖号",
        windows: [chromeWindow()]
      }
    ]);

    const plan = buildWindowLayoutSyncPlan(registry, "account-001");

    expect(plan).toMatchObject({
      sourceProfileId: "account-001",
      sourceProfileName: "主号",
      sourceStatus: "window-error",
      sourceBounds: null,
      sourceWindowError: "读取主窗口失败",
      placements: [],
      skipped: [],
      noWindowCount: 0,
      minimizedCount: 0,
      failedCount: 0
    });
  });
});
