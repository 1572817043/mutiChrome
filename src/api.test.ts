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
});
