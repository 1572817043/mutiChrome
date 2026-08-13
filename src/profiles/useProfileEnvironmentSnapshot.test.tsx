import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import type { ProfileEnvironmentSnapshot } from "../api";
import type { ChromeProfile } from "../types";
import { useProfileEnvironmentSnapshot } from "./useProfileEnvironmentSnapshot";

function profile(id = "account-001"): ChromeProfile {
  return {
    id,
    name: id,
    tags: [],
    notes: "",
    status: "active",
    accountPlatforms: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    lastOpenedAt: null
  };
}

function snapshot(profileId: string): ProfileEnvironmentSnapshot {
  return {
    profileId,
    profileDir: `/tmp/profiles/${profileId}`,
    directoryStatus: "ready",
    managedProfileRoot: true,
    registered: true,
    browserPath: "/Applications/Google Chrome.app",
    browserAvailable: true,
    running: false,
    checkedAt: 1000,
    healthIssues: []
  };
}

describe("useProfileEnvironmentSnapshot", () => {
  test("根目录或账号切换后丢弃旧概览结果", async () => {
    let resolveFirst!: (value: ProfileEnvironmentSnapshot) => void;
    const loadSnapshot = vi.fn(
      () => new Promise<ProfileEnvironmentSnapshot>((resolve) => (resolveFirst = resolve))
    );
    const hook = renderHook(
      ({ rootPath, selectedProfile }) =>
        useProfileEnvironmentSnapshot({ rootPath, selectedProfile, loadSnapshot }),
      { initialProps: { rootPath: "/root-a", selectedProfile: profile("account-001") } }
    );

    let request: Promise<boolean>;
    await act(async () => {
      request = hook.result.current.refresh();
      hook.rerender({ rootPath: "/root-b", selectedProfile: profile("account-002") });
      resolveFirst(snapshot("account-001"));
      await request;
    });

    await waitFor(() => expect(hook.result.current.snapshot).toBeNull());
  });

  test("浏览器路径切换后丢弃旧概览结果", async () => {
    let resolveFirst!: (value: ProfileEnvironmentSnapshot) => void;
    const loadSnapshot = vi.fn(
      () => new Promise<ProfileEnvironmentSnapshot>((resolve) => (resolveFirst = resolve))
    );
    const hook = renderHook(
      ({ browserPath }) =>
        useProfileEnvironmentSnapshot({
          rootPath: "/root-a",
          selectedProfile: profile(),
          browserPath,
          loadSnapshot
        }),
      { initialProps: { browserPath: "/Applications/Chrome A.app" } }
    );

    let request: Promise<boolean>;
    await act(async () => {
      request = hook.result.current.refresh();
      hook.rerender({ browserPath: "/Applications/Chrome B.app" });
      resolveFirst(snapshot("account-001"));
      await request;
    });

    await waitFor(() => expect(hook.result.current.snapshot).toBeNull());
  });

  test("读取失败时返回 false 并暴露可渲染错误", async () => {
    const hook = renderHook(() =>
      useProfileEnvironmentSnapshot({
        rootPath: "/root-a",
        selectedProfile: profile(),
        loadSnapshot: vi.fn().mockRejectedValue(new Error("读取失败"))
      })
    );

    await act(async () => {
      await expect(hook.result.current.refresh()).resolves.toBe(false);
    });

    expect(hook.result.current.error).toBe("读取失败");
    expect(hook.result.current.loading).toBe(false);
  });

  test("卸载后丢弃未完成请求的结果", async () => {
    let resolveFirst!: (value: ProfileEnvironmentSnapshot) => void;
    const hook = renderHook(() =>
      useProfileEnvironmentSnapshot({
        rootPath: "/root-a",
        selectedProfile: profile(),
        loadSnapshot: vi.fn(
          () => new Promise<ProfileEnvironmentSnapshot>((resolve) => (resolveFirst = resolve))
        )
      })
    );

    let request: Promise<boolean>;
    await act(async () => {
      request = hook.result.current.refresh();
      hook.unmount();
      resolveFirst(snapshot("account-001"));
      await expect(request).resolves.toBe(false);
    });
  });
});
