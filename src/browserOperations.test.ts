import { describe, expect, test, vi } from "vitest";
import {
  browserLaunchFailed,
  browserLaunchSucceeded,
  summarizeBrowserLaunchQueue
} from "./browserSessionLaunch";
import {
  browserOperationStatusFromLaunchQueue,
  cancelBrowserOperation,
  createBrowserOperation,
  findActiveBrowserOperationProfileConflicts,
  finishBrowserOperation,
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
});
