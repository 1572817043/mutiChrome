import { describe, expect, test } from "vitest";
import type { ChromeProfile } from "../../types";
import { focusWindowsForProfilesInOrder } from "./windowFocusController";

function profile(id: string, name: string): ChromeProfile {
  return {
    id,
    name,
    tags: [],
    notes: "",
    status: "active",
    accountPlatforms: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    lastOpenedAt: null
  };
}

describe("focusWindowsForProfilesInOrder", () => {
  test("全部成功时按顺序调用并返回 focusedCount", async () => {
    const profiles = [profile("account-001", "主号"), profile("account-002", "小号")];
    const focusCalls: string[] = [];

    await expect(
      focusWindowsForProfilesInOrder(profiles, {
        focusWindow: async (currentProfile) => {
          focusCalls.push(currentProfile.id);
        }
      })
    ).resolves.toEqual({
      focusedCount: 2,
      failedCount: 0,
      firstFailedError: null
    });
    expect(focusCalls).toEqual(["account-001", "account-002"]);
  });

  test("中间失败后继续后续 profile，并正确统计 failedCount", async () => {
    const profiles = [
      profile("account-001", "主号"),
      profile("account-002", "失败号"),
      profile("account-003", "后续号")
    ];
    const middleError = new Error("中间账号前置失败");
    const focusCalls: string[] = [];

    await expect(
      focusWindowsForProfilesInOrder(profiles, {
        focusWindow: async (currentProfile) => {
          focusCalls.push(currentProfile.id);
          if (currentProfile.id === "account-002") {
            throw middleError;
          }
        }
      })
    ).resolves.toEqual({
      focusedCount: 2,
      failedCount: 1,
      firstFailedError: middleError
    });
    expect(focusCalls).toEqual(["account-001", "account-002", "account-003"]);
  });

  test("多次失败时 firstFailedError 保留第一个原始错误", async () => {
    const profiles = [profile("account-001", "失败一"), profile("account-002", "失败二")];
    const firstError = new Error("第一个失败");
    const secondError = new Error("第二个失败");

    await expect(
      focusWindowsForProfilesInOrder(profiles, {
        focusWindow: async (currentProfile) => {
          throw currentProfile.id === "account-001" ? firstError : secondError;
        }
      })
    ).resolves.toEqual({
      focusedCount: 0,
      failedCount: 2,
      firstFailedError: firstError
    });
  });

  test("空数组返回零计数和 null 错误", async () => {
    const focusWindow = async (_profile: ChromeProfile) => {};

    await expect(
      focusWindowsForProfilesInOrder([], { focusWindow })
    ).resolves.toEqual({
      focusedCount: 0,
      failedCount: 0,
      firstFailedError: null
    });
  });
});
