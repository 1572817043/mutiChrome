import { describe, expect, test } from "vitest";
import {
  cloneProfileForDraft,
  createProfile,
  defaultAccentColor,
  duplicateProfile,
  nextProfileId,
  removeProfile,
  updateProfile
} from "./profileModel";
import type { ChromeProfile } from "../types";

const now = "2026-07-15T10:00:00.000Z";

describe("profileModel", () => {
  test("nextProfileId uses the next account number", () => {
    const profiles: ChromeProfile[] = [
      profile({ id: "account-001" }),
      profile({ id: "account-002" }),
      profile({ id: "custom-note" })
    ];

    expect(nextProfileId(profiles)).toBe("account-003");
  });

  test("defaultAccentColor uses a 12 color cycle for many accounts", () => {
    expect(defaultAccentColor("account-001")).toBe("forest");
    expect(defaultAccentColor("account-012")).toBe("slate");
    expect(defaultAccentColor("account-013")).toBe("forest");
  });

  test("createProfile builds a clean account profile", () => {
    const result = createProfile(
      {
        name: "  推特 01  ",
        tags: [" twitter ", "galxe", "twitter", ""],
        notes: "  主力小号  "
      },
      [profile({ id: "account-001" })],
      now
    );

    expect(result).toEqual({
      id: "account-002",
      name: "推特 01",
      tags: ["twitter", "galxe"],
      notes: "主力小号",
      status: "active",
      accountPlatforms: [],
      accentColor: "teal",
      createdAt: now,
      updatedAt: now,
      lastOpenedAt: null
    });
  });

  test("updateProfile edits mutable fields and refreshes updatedAt", () => {
    const original = profile({
      id: "account-009",
      name: "旧名称",
      tags: ["x"],
      notes: "旧备注",
      status: "active",
      createdAt: "2026-07-01T00:00:00.000Z",
      updatedAt: "2026-07-01T00:00:00.000Z"
    });

    const result = updateProfile(
      original,
      {
        name: " 新名称 ",
        tags: [" tg ", "tg", "discord"],
        notes: " 新备注 ",
        status: "needs_check",
        accentColor: "blue",
        lastOpenedAt: "2026-07-15T11:00:00.000Z"
      },
      now
    );

    expect(result).toEqual({
      id: "account-009",
      name: "新名称",
      tags: ["tg", "discord"],
      notes: "新备注",
      status: "needs_check",
      accountPlatforms: [],
      accentColor: "blue",
      createdAt: "2026-07-01T00:00:00.000Z",
      updatedAt: now,
      lastOpenedAt: "2026-07-15T11:00:00.000Z"
    });
  });

  test("duplicateProfile creates a new clean copy without last opened time", () => {
    const source = profile({
      id: "account-003",
      name: "主号",
      tags: ["twitter", "galxe"],
      notes: "已有登录态",
      status: "needs_check",
      accountPlatforms: [
        {
          id: "platform-009",
          platform: "Galxe",
          loginUrl: "https://galxe.com/login",
          username: "tree_user",
          notes: "每日打卡"
        }
      ],
      lastOpenedAt: "2026-07-14T11:00:00.000Z"
    });

    const result = duplicateProfile(
      source,
      [profile({ id: "account-001" }), source],
      now
    );

    expect(result).toEqual({
      id: "account-004",
      name: "主号 副本",
      tags: ["twitter", "galxe"],
      notes: "已有登录态",
      status: "active",
      accountPlatforms: [
        {
          id: "platform-001",
          platform: "Galxe",
          loginUrl: "https://galxe.com/login",
          username: "tree_user",
          notes: "每日打卡"
        }
      ],
      accentColor: "sage",
      createdAt: now,
      updatedAt: now,
      lastOpenedAt: null
    });
  });

  test("cloneProfileForDraft copies nested editable profile data", () => {
    const original = profile({
      tags: ["twitter"],
      accountPlatforms: [
        {
          id: "platform-001",
          platform: "X",
          loginUrl: "https://x.com",
          username: "main",
          notes: "ready"
        }
      ]
    });

    const draft = cloneProfileForDraft(original);

    draft.tags.push("galxe");
    draft.accountPlatforms[0].username = "changed";
    expect(original.tags).toEqual(["twitter"]);
    expect(original.accountPlatforms[0].username).toBe("main");
  });

  test("removeProfile removes the target and selects a nearby account", () => {
    const profiles: ChromeProfile[] = [
      profile({ id: "account-001" }),
      profile({ id: "account-002" }),
      profile({ id: "account-003" })
    ];

    expect(removeProfile(profiles, "account-002")).toEqual({
      profiles: [profile({ id: "account-001" }), profile({ id: "account-003" })],
      selectedId: "account-003"
    });
  });
});

function profile(overrides: Partial<ChromeProfile>): ChromeProfile {
  return {
    id: "account-001",
    name: "账号",
    tags: [],
    notes: "",
    status: "active",
    accountPlatforms: [],
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    lastOpenedAt: null,
    ...overrides
  };
}
