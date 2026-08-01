import { describe, expect, test } from "vitest";
import type {
  AirdropProject,
  ChromeProfile,
  ProfileSettings,
  UrlLibraryItem
} from "../types";
import {
  mergeQueuedProfiles,
  mergeQueuedProjects,
  mergeQueuedSettings
} from "./profileDocumentMutationModel";

describe("profile document mutation merge", () => {
  test("空 createdAt 的旧账号不会更新复用同 ID 的新账号", () => {
    const base = [profile({ createdAt: "" })];
    const current = [
      profile({
        name: "复用新号",
        createdAt: "2026-07-16T00:00:00.000Z",
        lastOpenedAt: null
      })
    ];
    const requested = [
      profile({
        createdAt: "",
        lastOpenedAt: "2026-07-17T00:00:00.000Z"
      })
    ];

    const { profiles } = mergeQueuedProfiles(base, current, requested);

    expect(profiles).toEqual([
      expect.objectContaining({
        id: "account-001",
        name: "复用新号",
        createdAt: "2026-07-16T00:00:00.000Z",
        lastOpenedAt: null
      })
    ]);
  });

  test("空 createdAt 的旧项目不会更新复用同 ID 的新项目", () => {
    const base = [project({ createdAt: "" })];
    const current = [
      project({
        name: "复用新项目",
        createdAt: "2026-07-16T00:00:00.000Z",
        lastOpenedAt: null
      })
    ];
    const requested = [
      project({
        createdAt: "",
        lastOpenedAt: "2026-07-17T00:00:00.000Z"
      })
    ];

    const projects = mergeQueuedProjects(base, current, requested);

    expect(projects).toEqual([
      expect.objectContaining({
        id: "project-001",
        name: "复用新项目",
        createdAt: "2026-07-16T00:00:00.000Z",
        lastOpenedAt: null
      })
    ]);
  });

  test("空 createdAt 的旧网址不会更新复用同 ID 的新网址", () => {
    const base = settingsWith([urlItem({ createdAt: "" })]);
    const current = settingsWith([
      urlItem({
        name: "复用新网址",
        createdAt: "2026-07-16T00:00:00.000Z"
      })
    ]);
    const requested = settingsWith([
      urlItem({
        createdAt: "",
        name: "旧网址回写"
      })
    ]);

    const settings = mergeQueuedSettings(base, current, requested);

    expect(settings.urlLibrary).toEqual([
      expect.objectContaining({
        id: "url-001",
        name: "复用新网址",
        createdAt: "2026-07-16T00:00:00.000Z"
      })
    ]);
  });

  test("复用同 ID 的新网址保持 current 顺序，不被 stale requested 顺序拖动", () => {
    const base = settingsWith([
      urlItem({ id: "url-001", name: "A", createdAt: "2026-07-15T00:00:00.000Z" }),
      urlItem({ id: "url-002", name: "B", createdAt: "2026-07-15T00:00:00.000Z" })
    ]);
    const current = settingsWith([
      urlItem({ id: "url-002", name: "B replacement", createdAt: "2026-07-16T00:00:00.000Z" }),
      urlItem({ id: "url-001", name: "A current", createdAt: "2026-07-15T00:00:00.000Z" })
    ]);
    const requested = settingsWith([
      urlItem({ id: "url-001", name: "A stale", createdAt: "2026-07-15T00:00:00.000Z" }),
      urlItem({ id: "url-002", name: "B", createdAt: "2026-07-15T00:00:00.000Z" })
    ]);

    const settings = mergeQueuedSettings(base, current, requested);

    expect(settings.urlLibrary.map((item) => item.name)).toEqual([
      "B replacement",
      "A stale"
    ]);
  });

  test("复用同 ID 的新项目保持 current 顺序，不被 stale requested 顺序拖动", () => {
    const base = [
      project({ id: "project-001", name: "A", createdAt: "2026-07-15T00:00:00.000Z" }),
      project({ id: "project-002", name: "B", createdAt: "2026-07-15T00:00:00.000Z" })
    ];
    const current = [
      project({ id: "project-002", name: "B replacement", createdAt: "2026-07-16T00:00:00.000Z" }),
      project({ id: "project-001", name: "A current", createdAt: "2026-07-15T00:00:00.000Z" })
    ];
    const requested = [
      project({ id: "project-001", name: "A stale", createdAt: "2026-07-15T00:00:00.000Z" }),
      project({ id: "project-002", name: "B", createdAt: "2026-07-15T00:00:00.000Z" })
    ];

    const projects = mergeQueuedProjects(base, current, requested);

    expect(projects.map((item) => item.name)).toEqual([
      "B replacement",
      "A stale"
    ]);
  });
});

function settingsWith(urlLibrary: UrlLibraryItem[]): ProfileSettings {
  return {
    browserPath: "/Applications/Google Chrome.app",
    favoriteUrls: [],
    recentUrls: [],
    urlLibrary,
    theme: "light"
  };
}

function profile(overrides: Partial<ChromeProfile> = {}): ChromeProfile {
  return {
    id: "account-001",
    name: "账号",
    tags: [],
    notes: "",
    status: "active",
    accountPlatforms: [],
    createdAt: "2026-07-15T00:00:00.000Z",
    updatedAt: "2026-07-15T00:00:00.000Z",
    lastOpenedAt: null,
    ...overrides
  };
}

function project(overrides: Partial<AirdropProject> = {}): AirdropProject {
  return {
    id: "project-001",
    name: "项目",
    url: "https://example.com",
    urls: [
      {
        id: "url-001",
        name: "主入口",
        url: "https://example.com",
        notes: ""
      }
    ],
    notes: "",
    profileIds: [],
    intervalSeconds: 3,
    createdAt: "2026-07-15T00:00:00.000Z",
    updatedAt: "2026-07-15T00:00:00.000Z",
    lastOpenedAt: null,
    ...overrides
  };
}

function urlItem(overrides: Partial<UrlLibraryItem> = {}): UrlLibraryItem {
  return {
    id: "url-001",
    name: "网址",
    url: "https://example.com",
    tags: [],
    notes: "",
    createdAt: "2026-07-15T00:00:00.000Z",
    updatedAt: "2026-07-15T00:00:00.000Z",
    ...overrides
  };
}
