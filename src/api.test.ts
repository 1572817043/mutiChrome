import { beforeEach, describe, expect, test, vi } from "vitest";

const invokeMock = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock
}));

import { profileApi } from "./api";

describe("profileApi Browser Runtime", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    (
      window as Window & {
        __TAURI_INTERNALS__?: unknown;
      }
    ).__TAURI_INTERNALS__ = {};
  });

  test("navigateRuntimeTab 调用 Tauri command 并返回结构化结果", async () => {
    invokeMock.mockResolvedValue({
      profileId: "account-001",
      targetId: "page-1",
      url: "https://example.com/dashboard",
      navigatedAt: 1000
    });

    const result = await profileApi.navigateRuntimeTab(
      "/tmp/multichrome",
      "account-001",
      "https://example.com/dashboard"
    );

    expect(invokeMock).toHaveBeenCalledWith("navigate_runtime_tab", {
      rootPath: "/tmp/multichrome",
      profileId: "account-001",
      url: "https://example.com/dashboard"
    });
    expect(result).toEqual({
      profileId: "account-001",
      targetId: "page-1",
      url: "https://example.com/dashboard",
      navigatedAt: 1000
    });
  });

  test("getProfileEnvironmentSnapshot 调用只读环境快照 command", async () => {
    invokeMock.mockResolvedValue({
      profileId: "account-001",
      profileDir: "/tmp/multichrome/profiles/account-001",
      directoryStatus: "ready",
      managedProfileRoot: true,
      registered: true,
      browserPath: "/Applications/Google Chrome.app",
      browserAvailable: true,
      running: true,
      healthIssues: []
    });

    await profileApi.getProfileEnvironmentSnapshot(
      "/tmp/multichrome",
      "account-001",
      "/Applications/Google Chrome.app"
    );

    expect(invokeMock).toHaveBeenCalledWith("profile_environment_snapshot", {
      rootPath: "/tmp/multichrome",
      profileId: "account-001",
      browserPath: "/Applications/Google Chrome.app"
    });
  });

  test("非 Tauri 预览的未登记账号不标记为受管目录", async () => {
    delete (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;

    const snapshot = await profileApi.getProfileEnvironmentSnapshot(
      "/tmp/multichrome",
      "account-001"
    );

    expect(snapshot.registered).toBe(false);
    expect(snapshot.managedProfileRoot).toBe(false);
  });
});
