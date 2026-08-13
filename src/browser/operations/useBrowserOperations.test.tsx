import { act, renderHook } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import type { WindowBounds } from "../../api";
import { profileApi } from "../../api";
import {
  browserLaunchFailed,
  browserLaunchSucceeded,
  summarizeBrowserLaunchQueue
} from "../../browserSessionLaunch";
import type { ChromeProfile } from "../../types";
import { useBrowserOperations } from "./useBrowserOperations";

function profile(id: string, name: string): ChromeProfile {
  return {
    id,
    name,
    tags: [],
    notes: "",
    status: "active",
    accountPlatforms: [],
    accentColor: "blue",
    createdAt: "2026-07-23T00:00:00.000Z",
    updatedAt: "2026-07-23T00:00:00.000Z",
    lastOpenedAt: null
  };
}

describe("useBrowserOperations", () => {
  test("管理窗口 operation 生命周期并保留最近记录顺序", () => {
    const { result } = renderHook(() =>
      useBrowserOperations({
        rootPath: "/tmp/multichrome",
        maxOperations: 20,
        commandTimeoutMs: 120000,
        onMessage: vi.fn()
      })
    );

    const accountOne = profile("account-001", "主号");
    const accountTwo = profile("account-002", "副号");

    act(() => {
      const operation = result.current.startWindowOperation("检查窗口", [
        accountOne,
        accountTwo
      ]);
      result.current.finishWindowOperation(operation, "succeeded", {
        inspectedCount: 2
      });
    });

    expect(result.current.browserOperations).toHaveLength(1);
    expect(result.current.browserOperations[0]).toMatchObject({
      id: "operation-0001",
      type: "window-action",
      status: "succeeded",
      sourceLabel: "检查窗口",
      profileIds: ["account-001", "account-002"],
      target: { kind: "window", action: "检查窗口" },
      summary: { inspectedCount: 2 }
    });
  });

  test("批量和项目 operation 使用启动队列摘要结束", () => {
    const { result } = renderHook(() =>
      useBrowserOperations({
        rootPath: "/tmp/multichrome",
        maxOperations: 20,
        commandTimeoutMs: 120000,
        onMessage: vi.fn()
      })
    );
    const accountOne = profile("account-001", "主号");
    const accountTwo = profile("account-002", "副号");

    act(() => {
      const bulkOperation = result.current.startBulkOpenUrlOperation(
        "批量打开",
        "https://galxe.com",
        [accountOne, accountTwo]
      );
      const bulkSummary = summarizeBrowserLaunchQueue(
        [
          browserLaunchSucceeded("account-001", "/tmp/account-001", 1000),
          browserLaunchFailed("account-002", new Error("Chrome 启动失败"), 1100)
        ],
        new Map([
          ["account-001", "主号"],
          ["account-002", "副号"]
        ]),
        2,
        false
      );
      result.current.finishLaunchQueueOperation(bulkOperation, bulkSummary);

      const projectOperation = result.current.startProjectOpenOperation(
        "项目 Galxe",
        {
          projectId: "project-001",
          projectName: "Galxe",
          projectUrlIds: ["url-001"]
        },
        [accountOne]
      );
      const projectSummary = summarizeBrowserLaunchQueue(
        [browserLaunchSucceeded("account-001", "/tmp/account-001", 1200)],
        new Map([["account-001", "主号"]]),
        1,
        false
      );
      result.current.finishLaunchQueueOperation(projectOperation, projectSummary);
    });

    expect(result.current.browserOperations.map((operation) => operation.type)).toEqual([
      "project-open",
      "bulk-open-url"
    ]);
    expect(result.current.browserOperations[0].status).toBe("succeeded");
    expect(result.current.browserOperations[1].status).toBe("failed");
  });

  test("同账号 active operation 冲突会提示并阻止新操作", () => {
    const onMessage = vi.fn();
    const { result } = renderHook(() =>
      useBrowserOperations({
        rootPath: "/tmp/multichrome",
        maxOperations: 20,
        commandTimeoutMs: 120000,
        onMessage
      })
    );
    const accountOne = profile("account-001", "主号");

    act(() => {
      result.current.startProfileOpenOperation("账号启动", accountOne);
    });

    expect(result.current.canStartBrowserOperationForProfiles([accountOne])).toBe(false);
    expect(onMessage).toHaveBeenCalledWith("主号 正在执行账号启动，请稍后再试");
  });

  test("根切换清理全部窗口 operation，同时保留非窗口 operation", () => {
    const { result } = renderHook(() =>
      useBrowserOperations({
        rootPath: "/tmp/multichrome",
        maxOperations: 20,
        commandTimeoutMs: 120000,
        onMessage: vi.fn()
      })
    );
    const accountOne = profile("account-001", "主号");

    act(() => {
      const windowOperation = result.current.startWindowOperation("检查窗口", [
        accountOne
      ]);
      result.current.startWindowOperation("前置窗口", [accountOne]);
      result.current.startWindowOperation("平铺窗口", [accountOne]);
      result.current.startWindowOperation("同步布局", [accountOne]);
      result.current.startBulkOpenUrlOperation("批量打开", "https://example.com", [
        accountOne
      ]);
      result.current.clearWindowActionOperations([
        "检查窗口",
        "前置窗口",
        "关闭运行账号",
        "重启运行账号",
        "平铺窗口",
        "预览同步",
        "同步布局"
      ]);
      result.current.finishWindowOperation(windowOperation, "succeeded", {
        inspectedCount: 1
      }, () => false);
    });

    expect(result.current.browserOperations).toEqual([
      expect.objectContaining({ sourceLabel: "批量打开", status: "running" })
    ]);
  });

  test("根切换移除账号启动 operation，但保留其它 operation", () => {
    const { result } = renderHook(() =>
      useBrowserOperations({
        rootPath: "/tmp/multichrome",
        maxOperations: 20,
        commandTimeoutMs: 120000,
        onMessage: vi.fn()
      })
    );
    const accountOne = profile("account-001", "主号");

    act(() => {
      result.current.startProfileOpenOperation("账号启动", accountOne);
      result.current.startBulkOpenUrlOperation("批量打开", "https://example.com", [
        accountOne
      ]);
      result.current.clearProfileOpenOperations();
    });

    expect(result.current.browserOperations).toEqual([
      expect.objectContaining({
        type: "bulk-open-url",
        sourceLabel: "批量打开",
        status: "running"
      })
    ]);
  });

  test("根切换只移除批量网址和项目打开 operation", () => {
    const { result } = renderHook(() =>
      useBrowserOperations({
        rootPath: "/tmp/multichrome",
        maxOperations: 20,
        commandTimeoutMs: 120000,
        onMessage: vi.fn()
      })
    );
    const accountOne = profile("account-001", "主号");

    act(() => {
      result.current.startBulkOpenUrlOperation("批量打开", "https://example.com", [
        accountOne
      ]);
      result.current.startProjectOpenOperation(
        "项目 Example",
        {
          projectId: "project-001",
          projectName: "Example",
          projectUrlIds: ["url-001"]
        },
        [accountOne]
      );
      result.current.startProfileOpenOperation("账号启动", accountOne);
      result.current.clearLaunchQueueOperations();
    });

    expect(result.current.browserOperations).toEqual([
      expect.objectContaining({
        type: "profile-open",
        sourceLabel: "账号启动",
        status: "running"
      })
    ]);
  });

  test("浏览器 API 命令使用 rootPath 和超时包装", async () => {
    vi.useFakeTimers();
    const listWindowsSpy = vi
      .spyOn(profileApi, "listProfileWindows")
      .mockImplementation(() => new Promise(() => undefined));
    const focusSpy = vi.spyOn(profileApi, "focusProfileWindow").mockResolvedValue();
    const setBoundsSpy = vi
      .spyOn(profileApi, "setProfileWindowBounds")
      .mockResolvedValue();

    try {
      const { result } = renderHook(() =>
        useBrowserOperations({
          rootPath: "/tmp/multichrome",
          maxOperations: 20,
          commandTimeoutMs: 1000,
          onMessage: vi.fn()
        })
      );
      const accountOne = profile("account-001", "主号");
      const bounds: WindowBounds = { x: 1, y: 2, width: 300, height: 200 };

      await expect(result.current.focusProfileWindowWithTimeout(accountOne)).resolves.toBe(
        undefined
      );
      await expect(
        result.current.setProfileWindowBoundsWithTimeout(
          accountOne,
          bounds,
          "平铺窗口"
        )
      ).resolves.toBe(undefined);

      const pending = result.current.listProfileWindowsWithTimeout(
        accountOne,
        "检查窗口"
      );
      const assertion = expect(pending).rejects.toThrow(
        "主号 检查窗口超时，请稍后再试"
      );
      await vi.advanceTimersByTimeAsync(1000);
      await assertion;

      expect(listWindowsSpy).toHaveBeenCalledWith("/tmp/multichrome", "account-001");
      expect(focusSpy).toHaveBeenCalledWith("/tmp/multichrome", "account-001");
      expect(setBoundsSpy).toHaveBeenCalledWith(
        "/tmp/multichrome",
        "account-001",
        bounds
      );
    } finally {
      vi.useRealTimers();
      listWindowsSpy.mockRestore();
      focusSpy.mockRestore();
      setBoundsSpy.mockRestore();
    }
  });
});
