import { describe, expect, test, vi } from "vitest";
import {
  browserLaunchFailed,
  browserLaunchSucceeded,
  summarizeBrowserLaunchQueue
} from "./browserSessionLaunch";
import {
  buildInspectWindowOperationSummary,
  buildSyncLayoutWindowOperationSummary,
  buildTileWindowOperationSummary,
  browserOperationStatusFromLaunchQueue,
  cancelBrowserOperation,
  createBrowserOperation,
  findActiveBrowserOperationProfileConflicts,
  formatWindowOperationSummary,
  finishBrowserOperation,
  isWindowOperationSummary,
  startBrowserOperation,
  trimBrowserOperations,
  withBrowserOperationTimeout
} from "./browserOperations";

describe("browserOperations", () => {
  test("创建批量打开 operation 时记录队列目标和初始状态", () => {
    const operation = createBrowserOperation(
      {
        id: "op-001",
        type: "bulk-open-url",
        sourceLabel: "批量打开",
        profileIds: ["account-001", "account-002"],
        target: { kind: "url", url: "https://galxe.com" }
      },
      1000
    );

    expect(operation).toEqual({
      id: "op-001",
      type: "bulk-open-url",
      status: "queued",
      sourceLabel: "批量打开",
      profileIds: ["account-001", "account-002"],
      target: { kind: "url", url: "https://galxe.com" },
      createdAt: 1000,
      startedAt: null,
      finishedAt: null,
      summary: null,
      cancelReason: null
    });
  });

  test("operation 只能从 queued 进入 running", () => {
    const operation = createBrowserOperation(
      {
        id: "op-001",
        type: "bulk-open-url",
        sourceLabel: "批量打开",
        profileIds: ["account-001"],
        target: { kind: "url", url: "chrome://newtab/" }
      },
      1000
    );

    const running = startBrowserOperation(operation, 1200);

    expect(running.status).toBe("running");
    expect(running.startedAt).toBe(1200);
    expect(() => startBrowserOperation(running, 1300)).toThrow(
      "只能启动 queued operation"
    );
  });

  test("启动队列摘要决定 operation 完成状态但不复制结果模型", () => {
    const operation = startBrowserOperation(
      createBrowserOperation(
        {
          id: "op-001",
          type: "bulk-open-url",
          sourceLabel: "批量打开",
          profileIds: ["account-001", "account-002"],
          target: { kind: "url", url: "https://galxe.com" }
        },
        1000
      ),
      1100
    );
    const summary = summarizeBrowserLaunchQueue(
      [
        browserLaunchSucceeded("account-001", "/tmp/account-001", 1200),
        browserLaunchFailed("account-002", new Error("Chrome 启动失败"), 1300)
      ],
      new Map([
        ["account-001", "主号"],
        ["account-002", "抽奖号"]
      ]),
      2,
      false
    );

    const finished = finishBrowserOperation(
      operation,
      browserOperationStatusFromLaunchQueue(summary),
      summary,
      1400
    );

    expect(finished.status).toBe("failed");
    expect(finished.finishedAt).toBe(1400);
    expect(finished.summary).toMatchObject({
      queuedCount: 2,
      successCount: 1,
      failureCount: 1
    });
  });

  test("停止中的启动队列会结束为 cancelled operation", () => {
    const operation = startBrowserOperation(
      createBrowserOperation(
        {
          id: "op-001",
          type: "bulk-open-url",
          sourceLabel: "批量打开",
          profileIds: ["account-001", "account-002"],
          target: { kind: "url", url: "https://galxe.com" }
        },
        1000
      ),
      1100
    );
    const summary = summarizeBrowserLaunchQueue(
      [browserLaunchSucceeded("account-001", "/tmp/account-001", 1200)],
      new Map([["account-001", "主号"]]),
      2,
      true
    );

    const cancelled = finishBrowserOperation(
      operation,
      browserOperationStatusFromLaunchQueue(summary),
      summary,
      1300
    );

    expect(cancelled.status).toBe("cancelled");
    expect(cancelled.summary).toMatchObject({
      stopped: true,
      successCount: 1,
      queuedCount: 2
    });
  });

  test("取消 operation 会保留取消原因并拒绝再次完成", () => {
    const operation = createBrowserOperation(
      {
        id: "op-001",
        type: "bulk-open-url",
        sourceLabel: "批量打开",
        profileIds: ["account-001"],
        target: { kind: "url", url: "https://galxe.com" }
      },
      1000
    );

    const cancelled = cancelBrowserOperation(operation, "用户停止", 1200);

    expect(cancelled.status).toBe("cancelled");
    expect(cancelled.cancelReason).toBe("用户停止");
    expect(cancelled.finishedAt).toBe(1200);
    expect(() =>
      finishBrowserOperation(cancelled, "succeeded", { ok: true }, 1300)
    ).toThrow("只能结束 running operation");
  });

  test("查找同账号当前 operation 冲突时只匹配 queued 和 running", () => {
    const runningBulk = startBrowserOperation(
      createBrowserOperation(
        {
          id: "op-running",
          type: "bulk-open-url",
          sourceLabel: "批量打开",
          profileIds: ["account-001", "account-002"],
          target: { kind: "url", url: "https://galxe.com" }
        },
        1000
      ),
      1100
    );
    const queuedWindow = createBrowserOperation(
      {
        id: "op-queued",
        type: "window-action",
        sourceLabel: "平铺窗口",
        profileIds: ["account-003"],
        target: { kind: "window", action: "平铺窗口" }
      },
      1200
    );
    const finishedProject = finishBrowserOperation(
      startBrowserOperation(
        createBrowserOperation(
          {
            id: "op-finished",
            type: "project-open",
            sourceLabel: "项目 Galxe",
            profileIds: ["account-004"],
            target: {
              kind: "project",
              projectId: "project-001",
              projectName: "Galxe",
              projectUrlIds: ["url-001"]
            }
          },
          1300
        ),
        1400
      ),
      "succeeded",
      { ok: true },
      1500
    );

    const conflicts = findActiveBrowserOperationProfileConflicts(
      [finishedProject, queuedWindow, runningBulk],
      ["account-001", "account-003", "account-004"]
    );

    expect(conflicts).toEqual([
      {
        operation: queuedWindow,
        profileIds: ["account-003"]
      },
      {
        operation: runningBulk,
        profileIds: ["account-001"]
      }
    ]);
  });

  test("裁剪 operation 列表时不会丢弃仍在执行的 operation", () => {
    const runningOperation = startBrowserOperation(
      createBrowserOperation(
        {
          id: "op-running-old",
          type: "bulk-open-url",
          sourceLabel: "批量打开",
          profileIds: ["account-001"],
          target: { kind: "url", url: "https://galxe.com" }
        },
        1000
      ),
      1100
    );
    const finishedOperations = Array.from({ length: 4 }, (_, index) =>
      finishBrowserOperation(
        startBrowserOperation(
          createBrowserOperation(
            {
              id: `op-finished-${index}`,
              type: "window-action",
              sourceLabel: "检查窗口",
              profileIds: [`account-00${index + 2}`],
              target: { kind: "window", action: "检查窗口" }
            },
            2000 + index
          ),
          2100 + index
        ),
        "succeeded",
        { ok: true },
        2200 + index
      )
    );

    const trimmed = trimBrowserOperations([...finishedOperations, runningOperation], 3);

    expect(trimmed.map((operation) => operation.id)).toEqual([
      "op-finished-0",
      "op-finished-1",
      "op-running-old"
    ]);
  });

  test("浏览器命令超时时会拒绝并释放调用方等待", async () => {
    vi.useFakeTimers();
    try {
      const command = withBrowserOperationTimeout(
        new Promise<string>(() => undefined),
        1000,
        "浏览器命令超时"
      );
      const assertion = expect(command).rejects.toThrow("浏览器命令超时");

      await vi.advanceTimersByTimeAsync(1000);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  test("浏览器命令按时完成时会清理超时计时器", async () => {
    vi.useFakeTimers();
    try {
      const clearTimeoutSpy = vi.spyOn(globalThis, "clearTimeout");
      const command = withBrowserOperationTimeout(
        Promise.resolve("ok"),
        1000,
        "浏览器命令超时"
      );

      await expect(command).resolves.toBe("ok");
      expect(clearTimeoutSpy).toHaveBeenCalled();
      clearTimeoutSpy.mockRestore();
    } finally {
      vi.useRealTimers();
    }
  });

  test("构建检查窗口成功 summary", () => {
    const summary = buildInspectWindowOperationSummary({
      profileCount: 2,
      inspectedCount: 2
    });

    expect(summary).toEqual({
      summaryType: "window-operation",
      action: "inspect",
      profileCount: 2,
      succeededCount: 2,
      skippedCount: 0,
      failedCount: 0,
      focusFailedCount: 0
    });
    expect(isWindowOperationSummary(summary)).toBe(true);
    expect(formatWindowOperationSummary(summary)).toBe("已检查 2 / 2");
  });

  test("构建检查窗口失败 summary", () => {
    const summary = buildInspectWindowOperationSummary({
      profileCount: 2,
      inspectedCount: 0,
      failedCount: 2,
      reason: "inspect-failed"
    });

    expect(summary).toMatchObject({
      summaryType: "window-operation",
      action: "inspect",
      profileCount: 2,
      succeededCount: 0,
      skippedCount: 0,
      failedCount: 2,
      reason: "inspect-failed"
    });
    expect(formatWindowOperationSummary(summary)).toBe("窗口检查失败");
  });

  test("构建平铺窗口容量超限 summary", () => {
    const summary = buildTileWindowOperationSummary({
      profileCount: 10,
      tileableCount: 10,
      capacity: 9,
      capacityExceeded: true
    });

    expect(summary).toMatchObject({
      summaryType: "window-operation",
      action: "tile",
      profileCount: 10,
      succeededCount: 0,
      skippedCount: 10,
      failedCount: 0,
      focusFailedCount: 0,
      capacity: 9,
      capacityExceeded: true
    });
    expect(formatWindowOperationSummary(summary)).toBe(
      "可平铺 10 个，屏幕容量 9 个，已超限"
    );
  });

  test("构建平铺窗口容量超限时会把无窗口账号计入 skippedCount", () => {
    const summary = buildTileWindowOperationSummary({
      profileCount: 10,
      tileableCount: 9,
      noWindowCount: 1,
      capacity: 8,
      capacityExceeded: true
    });

    expect(summary).toMatchObject({
      summaryType: "window-operation",
      action: "tile",
      profileCount: 10,
      succeededCount: 0,
      skippedCount: 10,
      failedCount: 0,
      noWindowCount: 1,
      tileableCount: 9,
      capacity: 8,
      capacityExceeded: true
    });
    expect(formatWindowOperationSummary(summary)).toBe(
      "可平铺 9 个，屏幕容量 8 个，已超限"
    );
  });

  test("构建平铺窗口部分成功、无窗口和多窗口 summary", () => {
    const summary = buildTileWindowOperationSummary({
      profileCount: 3,
      tileableCount: 2,
      tiledCount: 1,
      noWindowCount: 1,
      multiWindowProfileCount: 1
    });

    expect(summary).toMatchObject({
      summaryType: "window-operation",
      action: "tile",
      profileCount: 3,
      succeededCount: 1,
      skippedCount: 1,
      failedCount: 0,
      focusFailedCount: 0,
      noWindowCount: 1,
      multiWindowProfileCount: 1
    });
    expect(formatWindowOperationSummary(summary)).toBe(
      "已平铺 1 / 3，无窗口 1 个，多窗口 1 个"
    );
  });

  test("构建平铺窗口未生效 summary", () => {
    const summary = buildTileWindowOperationSummary({
      profileCount: 1,
      tileableCount: 1,
      unchangedCount: 1
    });

    expect(summary).toMatchObject({
      summaryType: "window-operation",
      action: "tile",
      profileCount: 1,
      succeededCount: 0,
      skippedCount: 0,
      failedCount: 0,
      unchangedCount: 1
    });
    expect(formatWindowOperationSummary(summary)).toBe(
      "已平铺 0 / 1，未生效 1 个"
    );
  });

  test("构建同步布局 source 失败 summary", () => {
    const summary = buildSyncLayoutWindowOperationSummary({
      profileCount: 2,
      sourceProfileId: "account-001",
      reason: "minimized-source-window"
    });

    expect(summary).toMatchObject({
      summaryType: "window-operation",
      action: "sync-layout",
      profileCount: 2,
      sourceProfileId: "account-001",
      succeededCount: 0,
      skippedCount: 0,
      failedCount: 0,
      focusFailedCount: 0,
      reason: "minimized-source-window"
    });
    expect(formatWindowOperationSummary(summary)).toBe("主账号窗口已最小化");
  });

  test("构建同步布局兜底失败 summary", () => {
    const summary = buildSyncLayoutWindowOperationSummary({
      profileCount: 2,
      sourceProfileId: "account-001",
      reason: "sync-layout-error"
    });

    expect(summary).toMatchObject({
      summaryType: "window-operation",
      action: "sync-layout",
      profileCount: 2,
      sourceProfileId: "account-001",
      succeededCount: 0,
      skippedCount: 0,
      failedCount: 0,
      focusFailedCount: 0,
      reason: "sync-layout-error"
    });
    expect(formatWindowOperationSummary(summary)).toBe("同步布局失败");
  });

  test("构建同步布局部分成功、最小化、未生效和前置失败 summary", () => {
    const summary = buildSyncLayoutWindowOperationSummary({
      profileCount: 4,
      sourceProfileId: "account-001",
      syncedCount: 1,
      minimizedCount: 1,
      unchangedCount: 1,
      focusFailedCount: 1
    });

    expect(summary).toMatchObject({
      summaryType: "window-operation",
      action: "sync-layout",
      profileCount: 4,
      succeededCount: 1,
      skippedCount: 1,
      failedCount: 0,
      focusFailedCount: 1,
      minimizedCount: 1,
      unchangedCount: 1
    });
    expect(formatWindowOperationSummary(summary)).toBe(
      "已同步 1 / 4，最小化 1 个，未生效 1 个，未能前置 1 个"
    );
  });

  test("窗口 summary builder 会聚合 skippedCount", () => {
    const summary = buildSyncLayoutWindowOperationSummary({
      profileCount: 5,
      sourceProfileId: "account-001",
      syncedCount: 1,
      noWindowCount: 1,
      minimizedCount: 2,
      failedCount: 1
    });

    expect(summary.skippedCount).toBe(3);
    expect(formatWindowOperationSummary(summary)).toBe(
      "已同步 1 / 5，失败 1 个，无窗口 1 个，最小化 2 个"
    );
  });

  test("窗口 summary 类型守卫会拒绝未知 action", () => {
    expect(
      isWindowOperationSummary({
        summaryType: "window-operation",
        action: "tile-windows",
        profileCount: 1,
        succeededCount: 1,
        skippedCount: 0,
        failedCount: 0,
        focusFailedCount: 0
      })
    ).toBe(false);
  });

  test("窗口 summary 类型守卫会拒绝错误类型的可选字段", () => {
    expect(
      isWindowOperationSummary({
        summaryType: "window-operation",
        action: "tile",
        profileCount: 1,
        succeededCount: 1,
        skippedCount: 0,
        failedCount: 0,
        focusFailedCount: 0,
        sourceProfileId: 123,
        capacity: "8",
        capacityExceeded: "true"
      })
    ).toBe(false);
  });
});
