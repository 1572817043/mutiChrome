import { describe, expect, test } from "vitest";
import type { ChromeWindowInfo } from "../../api";
import type { ChromeProfile } from "../../types";
import { readWindowRegistryForProfiles } from "./windowRegistryController";

function deferred<T>() {
  let resolve: (value: T | PromiseLike<T>) => void = () => {};
  let reject: (reason?: unknown) => void = () => {};
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

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

function windowInfo(overrides: Partial<ChromeWindowInfo> = {}): ChromeWindowInfo {
  return {
    index: 1,
    title: "Chrome",
    x: 80,
    y: 120,
    width: 960,
    height: 720,
    ...overrides
  };
}

describe("readWindowRegistryForProfiles", () => {
  test("全部成功时按顺序读取并保留每个 profile 的 windows", async () => {
    const profiles = [profile("account-001", "主号"), profile("account-002", "小号")];
    const windowsById = new Map([
      [profiles[0].id, [windowInfo()]],
      [profiles[1].id, [windowInfo({ index: 2, x: 240 })]]
    ]);
    const readCalls: string[] = [];

    await expect(
      readWindowRegistryForProfiles(profiles, {
        readWindows: async (currentProfile) => {
          readCalls.push(currentProfile.id);
          return windowsById.get(currentProfile.id) ?? [];
        }
      })
    ).resolves.toMatchObject({
      entries: [
        { profileId: "account-001", profileName: "主号", windowCount: 1 },
        { profileId: "account-002", profileName: "小号", windowCount: 1 }
      ],
      inspectedWindows: [
        { profile: profiles[0], windows: windowsById.get(profiles[0].id) },
        { profile: profiles[1], windows: windowsById.get(profiles[1].id) }
      ]
    });
    expect(readCalls).toEqual(["account-001", "account-002"]);
  });

  test("中间 profile 抛错时抛出同一个原始错误且不读取后续 profile", async () => {
    const profiles = [
      profile("account-001", "主号"),
      profile("account-002", "失败号"),
      profile("account-003", "后续号")
    ];
    const originalError = new Error("检查窗口失败");
    const readCalls: string[] = [];

    const readPromise = readWindowRegistryForProfiles(profiles, {
      readWindows: async (currentProfile) => {
        readCalls.push(currentProfile.id);
        if (currentProfile.id === "account-002") {
          throw originalError;
        }
        return [windowInfo()];
      }
    });

    await expect(readPromise).rejects.toBe(originalError);
    expect(readCalls).toEqual(["account-001", "account-002"]);
  });

  test("作用域失效后不再读取后续 profile，并标记为 cancelled", async () => {
    const profiles = [
      profile("account-001", "主号"),
      profile("account-002", "后续号")
    ];
    const readCalls: string[] = [];
    let current = true;

    await expect(
      readWindowRegistryForProfiles(profiles, {
        readWindows: async (currentProfile) => {
          readCalls.push(currentProfile.id);
          current = false;
          return [windowInfo()];
        },
        shouldContinue: () => current
      })
    ).resolves.toEqual({
      entries: [],
      inspectedWindows: [],
      cancelled: true
    });
    expect(readCalls).toEqual(["account-001"]);
  });

  test("首个读取挂起后作用域失效再失败时返回 cancelled 且不读取后续 profile", async () => {
    const profiles = [
      profile("account-001", "主号"),
      profile("account-002", "后续号")
    ];
    const pendingRead = deferred<ChromeWindowInfo[]>();
    const readCalls: string[] = [];
    let current = true;
    const readPromise = readWindowRegistryForProfiles(profiles, {
      readWindows: async (currentProfile) => {
        readCalls.push(currentProfile.id);
        return pendingRead.promise;
      },
      shouldContinue: () => current
    });

    current = false;
    const originalError = new Error("读取失败");
    pendingRead.reject(originalError);

    await expect(readPromise).resolves.toEqual({
      entries: [],
      inspectedWindows: [],
      cancelled: true
    });
    expect(readCalls).toEqual(["account-001"]);
  });

  test("无窗口、最小化和多窗口字段语义通过 entries 保持", async () => {
    const profiles = [
      profile("account-001", "无窗口"),
      profile("account-002", "最小化"),
      profile("account-003", "多窗口")
    ];

    await expect(
      readWindowRegistryForProfiles(profiles, {
        readWindows: async (currentProfile) => {
          if (currentProfile.id === "account-001") {
            return [];
          }
          if (currentProfile.id === "account-002") {
            return [windowInfo({ minimized: true })];
          }
          return [windowInfo(), windowInfo({ index: 2, x: 1200 })];
        }
      })
    ).resolves.toMatchObject({
      entries: [
        {
          profileId: "account-001",
          status: "missing",
          windowCount: 0,
          primaryWindow: null,
          minimized: false,
          hasMultipleWindows: false
        },
        {
          profileId: "account-002",
          status: "ready",
          windowCount: 1,
          minimized: true,
          hasMultipleWindows: false
        },
        {
          profileId: "account-003",
          status: "ready",
          windowCount: 2,
          minimized: false,
          hasMultipleWindows: true
        }
      ]
    });
  });
});
