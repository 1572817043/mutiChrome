import { describe, expect, test, vi } from "vitest";
import type { ChromeProfile } from "../types";
import { rollbackImportedProfiles } from "./profileImportRollback";

function profile(id: string): ChromeProfile {
  return {
    id,
    name: id,
    tags: [],
    notes: "",
    status: "active",
    accountPlatforms: [],
    createdAt: "2026-08-02T00:00:00.000Z",
    updatedAt: "2026-08-02T00:00:00.000Z",
    lastOpenedAt: null
  };
}

describe("rollbackImportedProfiles", () => {
  test("空 profiles 时不调用删除并返回空列表", async () => {
    const deleteProfileData = vi.fn(async () => undefined);

    const failures = await rollbackImportedProfiles({
      targetRootPath: "/profiles",
      profiles: [],
      deleteProfileData
    });

    expect(deleteProfileData).not.toHaveBeenCalled();
    expect(failures).toEqual([]);
  });

  test("按 profiles 顺序删除，全部成功时返回空列表", async () => {
    const deleteProfileData = vi.fn(async () => undefined);

    const failures = await rollbackImportedProfiles({
      targetRootPath: "/profiles",
      profiles: [profile("profile-1"), profile("profile-2")],
      deleteProfileData
    });

    expect(deleteProfileData).toHaveBeenNthCalledWith(1, "/profiles", "profile-1");
    expect(deleteProfileData).toHaveBeenNthCalledWith(2, "/profiles", "profile-2");
    expect(failures).toEqual([]);
  });

  test("删除失败时继续处理后续 profile，并按失败顺序返回 id", async () => {
    const deleteProfileData = vi
      .fn<(rootPath: string, profileId: string) => Promise<void>>()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("profile-2 failed"))
      .mockRejectedValueOnce(new Error("profile-3 failed"))
      .mockResolvedValueOnce(undefined);

    const failures = await rollbackImportedProfiles({
      targetRootPath: "/profiles",
      profiles: [
        profile("profile-1"),
        profile("profile-2"),
        profile("profile-3"),
        profile("profile-4")
      ],
      deleteProfileData
    });

    expect(deleteProfileData).toHaveBeenCalledTimes(4);
    expect(deleteProfileData.mock.calls.map((call) => call[1])).toEqual([
      "profile-1",
      "profile-2",
      "profile-3",
      "profile-4"
    ]);
    expect(failures).toEqual(["profile-2", "profile-3"]);
  });
});
