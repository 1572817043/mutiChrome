import React from "react";
import { act, renderHook } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import type {
  BrowserRuntimeTabSnapshot,
  BrowserSessionSnapshot
} from "../api";
import type { ChromeProfile } from "../types";
import { useProfileRuntimeTabs } from "./useProfileRuntimeTabs";

const profile: ChromeProfile = {
  id: "profile-1",
  name: "工作账号",
  tags: [],
  notes: "",
  status: "active",
  accountPlatforms: [],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  lastOpenedAt: null
};

function createSession(
  overrides: Partial<BrowserSessionSnapshot> = {}
): BrowserSessionSnapshot {
  return {
    profileId: profile.id,
    status: "running",
    running: true,
    pid: 123,
    debugPort: 9222,
    cdpStatus: "available",
    runtimeError: null,
    windowCount: 0,
    windows: [],
    windowError: null,
    checkedAt: 1000,
    ...overrides
  };
}

function createTab(
  overrides: Partial<BrowserRuntimeTabSnapshot> = {}
): BrowserRuntimeTabSnapshot {
  return {
    targetId: "target-1",
    type: "page",
    url: "https://example.com",
    title: "Example",
    webSocketDebuggerUrl: null,
    checkedAt: 2000,
    ...overrides
  };
}

function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  let reject: (reason?: unknown) => void = () => {};
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

function renderRuntimeTabs(
  listRuntimeTabs: (rootPath: string, profileId: string) => Promise<BrowserRuntimeTabSnapshot[]>,
  overrides: Partial<Parameters<typeof useProfileRuntimeTabs>[0]> = {}
) {
  return renderHook(
    (props) => useProfileRuntimeTabs(props),
    {
      initialProps: {
        rootPath: "/root-a",
        selectedProfile: profile,
        selectedProfileCount: 1,
        session: createSession(),
        listRuntimeTabs,
        ...overrides
      }
    }
  );
}

describe("useProfileRuntimeTabs", () => {
  test("StrictMode 下可用 session 读取成功并更新 rows", async () => {
    const listRuntimeTabs = vi.fn().mockResolvedValue([createTab()]);
    const hook = renderHook(
      (props: Parameters<typeof useProfileRuntimeTabs>[0]) =>
        useProfileRuntimeTabs(props),
      {
        initialProps: {
          rootPath: "/root-a",
          selectedProfile: profile,
          selectedProfileCount: 1,
          session: createSession(),
          listRuntimeTabs
        },
        wrapper: ({ children }: { children: React.ReactNode }) => (
          <React.StrictMode>{children}</React.StrictMode>
        )
      }
    );

    await act(async () => {
      await hook.result.current.readTabs();
    });

    expect(hook.result.current.model.rows[0]?.targetId).toBe("target-1");
  });

  test("可用 session 调用 API，并从 loading 进入 succeeded", async () => {
    const tabs = [createTab()];
    const listRuntimeTabs = vi.fn().mockResolvedValue(tabs);
    const hook = renderRuntimeTabs(listRuntimeTabs);

    expect(hook.result.current.model).toMatchObject({
      canReadTabs: true,
      rows: [],
      errorMessage: null
    });

    let readPromise: Promise<void> = Promise.resolve();
    act(() => {
      readPromise = hook.result.current.readTabs();
    });
    expect(hook.result.current.loading).toBe(true);
    expect(hook.result.current.model).toMatchObject({
      canReadTabs: false,
      rows: [],
      errorMessage: null
    });
    expect(listRuntimeTabs).toHaveBeenCalledWith("/root-a", "profile-1");

    await act(async () => {
      await readPromise;
    });
    expect(hook.result.current.loading).toBe(false);
    expect(hook.result.current.model).toMatchObject({
      canReadTabs: true,
      rows: [
        {
          targetId: "target-1",
          title: "Example",
          url: "https://example.com",
          checkedAt: 2000
        }
      ],
      errorMessage: null
    });
  });

  test("canReadTabs 为 false 时不调用 API", async () => {
    const listRuntimeTabs = vi.fn().mockResolvedValue([]);
    const hook = renderRuntimeTabs(listRuntimeTabs, {
      session: createSession({ cdpStatus: "missing-port", debugPort: null })
    });

    await act(async () => {
      await hook.result.current.readTabs();
    });

    expect(listRuntimeTabs).not.toHaveBeenCalled();
    expect(hook.result.current.model.canReadTabs).toBe(false);
  });

  test("API 失败后显示 errorMessage，并允许再次读取成功", async () => {
    const listRuntimeTabs = vi
      .fn<
        (rootPath: string, profileId: string) => Promise<BrowserRuntimeTabSnapshot[]>
      >()
      .mockRejectedValueOnce(new Error("连接超时"))
      .mockResolvedValueOnce([createTab({ targetId: "target-2" })]);
    const hook = renderRuntimeTabs(listRuntimeTabs);

    await act(async () => {
      await hook.result.current.readTabs();
    });
    expect(hook.result.current.model).toMatchObject({
      canReadTabs: true,
      rows: [],
      errorMessage: "连接超时"
    });

    await act(async () => {
      await hook.result.current.readTabs();
    });
    expect(listRuntimeTabs).toHaveBeenCalledTimes(2);
    expect(hook.result.current.model.rows[0]?.targetId).toBe("target-2");
    expect(hook.result.current.model.errorMessage).toBeNull();
  });

  test("rootPath 或 selectedProfile 切换后旧请求结果不污染当前 rows", async () => {
    const oldRequest = deferred<BrowserRuntimeTabSnapshot[]>();
    const newRequest = deferred<BrowserRuntimeTabSnapshot[]>();
    const nextProfile = { ...profile, id: "profile-2", name: "个人账号" };
    const listRuntimeTabs = vi.fn((rootPath: string) =>
      rootPath === "/root-a" ? oldRequest.promise : newRequest.promise
    );
    const hook = renderRuntimeTabs(listRuntimeTabs);

    act(() => {
      void hook.result.current.readTabs();
    });
    hook.rerender({
      rootPath: "/root-b",
      selectedProfile: nextProfile,
      selectedProfileCount: 1,
      session: createSession({ profileId: nextProfile.id }),
      listRuntimeTabs
    });
    await act(async () => {
      oldRequest.resolve([createTab({ targetId: "stale" })]);
      await Promise.resolve();
    });
    expect(hook.result.current.model.rows).toEqual([]);

    let newReadPromise: Promise<void> = Promise.resolve();
    act(() => {
      newReadPromise = hook.result.current.readTabs();
    });
    newRequest.resolve([createTab({ targetId: "current" })]);
    await act(async () => {
      await newReadPromise;
    });
    expect(hook.result.current.model.rows[0]?.targetId).toBe("current");
  });

  test("selectedProfileCount 变化时 reset，旧请求结果不污染当前 rows", async () => {
    const request = deferred<BrowserRuntimeTabSnapshot[]>();
    const listRuntimeTabs = vi.fn().mockReturnValue(request.promise);
    const hook = renderRuntimeTabs(listRuntimeTabs);

    act(() => {
      void hook.result.current.readTabs();
    });
    hook.rerender({
      rootPath: "/root-a",
      selectedProfile: profile,
      selectedProfileCount: 2,
      session: createSession(),
      listRuntimeTabs
    });

    expect(hook.result.current.model).toMatchObject({
      canReadTabs: false,
      rows: [],
      errorMessage: null
    });
    await act(async () => {
      request.resolve([createTab({ targetId: "stale-count" })]);
      await Promise.resolve();
    });
    expect(hook.result.current.model.rows).toEqual([]);
  });

  test("session 关键字段变化时 reset，旧请求结果不污染当前 rows", async () => {
    const request = deferred<BrowserRuntimeTabSnapshot[]>();
    const listRuntimeTabs = vi.fn().mockReturnValue(request.promise);
    const hook = renderRuntimeTabs(listRuntimeTabs);

    act(() => {
      void hook.result.current.readTabs();
    });
    hook.rerender({
      rootPath: "/root-a",
      selectedProfile: profile,
      selectedProfileCount: 1,
      session: createSession({ cdpStatus: "missing-port", debugPort: null }),
      listRuntimeTabs
    });

    expect(hook.result.current.model).toMatchObject({
      canReadTabs: false,
      rows: [],
      errorMessage: null
    });
    await act(async () => {
      request.resolve([createTab({ targetId: "stale-session" })]);
      await Promise.resolve();
    });
    expect(hook.result.current.model.rows).toEqual([]);
  });

  test("再次读取进入 loading 时清空已有 rows 和 error", async () => {
    const retryRequest = deferred<BrowserRuntimeTabSnapshot[]>();
    const listRuntimeTabs = vi
      .fn<
        (rootPath: string, profileId: string) => Promise<BrowserRuntimeTabSnapshot[]>
      >()
      .mockRejectedValueOnce(new Error("首次读取失败"))
      .mockReturnValueOnce(retryRequest.promise);
    const hook = renderRuntimeTabs(listRuntimeTabs);

    await act(async () => {
      await hook.result.current.readTabs();
    });
    expect(hook.result.current.model.errorMessage).toBe("首次读取失败");

    let retryPromise: Promise<void> = Promise.resolve();
    act(() => {
      retryPromise = hook.result.current.readTabs();
    });
    expect(hook.result.current.model).toMatchObject({
      canReadTabs: false,
      rows: [],
      errorMessage: null
    });

    retryRequest.resolve([createTab({ targetId: "retry-success" })]);
    await act(async () => {
      await retryPromise;
    });
    expect(hook.result.current.model.rows[0]?.targetId).toBe("retry-success");
  });

  test("卸载后旧请求 resolve 不污染 state", async () => {
    const request = deferred<BrowserRuntimeTabSnapshot[]>();
    const listRuntimeTabs = vi.fn().mockReturnValue(request.promise);
    const hook = renderRuntimeTabs(listRuntimeTabs);

    act(() => {
      void hook.result.current.readTabs();
    });
    hook.unmount();
    await act(async () => {
      request.resolve([createTab()]);
      await Promise.resolve();
    });

    expect(listRuntimeTabs).toHaveBeenCalledTimes(1);
  });

  test("reset 清空 tabs 和 error 并恢复 idle", async () => {
    const listRuntimeTabs = vi.fn().mockRejectedValue(new Error("读取失败"));
    const hook = renderRuntimeTabs(listRuntimeTabs);

    await act(async () => {
      await hook.result.current.readTabs();
    });
    expect(hook.result.current.model.errorMessage).toBe("读取失败");

    act(() => {
      hook.result.current.reset();
    });
    expect(hook.result.current.model).toMatchObject({
      canReadTabs: true,
      rows: [],
      errorMessage: null,
      emptyMessage: null
    });
  });
});
