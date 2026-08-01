import { act, renderHook } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import type {
  AirdropProject,
  ChromeProfile,
  ProfileDocument,
  ProfileSettings
} from "../types";
import { useProfileDocumentStore } from "./useProfileDocumentStore";

describe("useProfileDocumentStore", () => {
  const settings = profileSettings();
  const profiles = [profile({ id: "account-001" })];
  const projects = [project({ id: "project-001", profileIds: ["account-001"] })];

  test("暴露初始 settings、profiles、projects 和 rootPath", () => {
    const { result } = renderHook(() =>
      useProfileDocumentStore({
        initialRootPath: "/profiles",
        initialSettings: settings,
        initialProfiles: profiles,
        initialProjects: projects,
        saveDocument: vi.fn(),
        onDocumentCommitted: vi.fn()
      })
    );

    expect(result.current.rootPath).toBe("/profiles");
    expect(result.current.settings).toBe(settings);
    expect(result.current.profiles).toBe(profiles);
    expect(result.current.projects).toBe(projects);
  });

  test("commitProfileDocumentState 更新 state 并通知外部回调", () => {
    const onDocumentCommitted = vi.fn();
    const nextSettings = profileSettings({ theme: "dark" });
    const nextProfiles = [profile({ id: "account-002" })];
    const nextProjects = [project({ id: "project-002", profileIds: ["account-002"] })];
    const { result } = renderHook(() =>
      useProfileDocumentStore({
        initialSettings: settings,
        initialProfiles: profiles,
        initialProjects: projects,
        saveDocument: vi.fn(),
        onDocumentCommitted
      })
    );

    act(() => {
      result.current.commitProfileDocumentState(
        nextProfiles,
        nextSettings,
        nextProjects,
        "已保存"
      );
    });

    expect(result.current.profiles).toEqual(nextProfiles);
    expect(result.current.settings).toEqual(nextSettings);
    expect(result.current.projects).toEqual(nextProjects);
    expect(onDocumentCommitted).toHaveBeenCalledWith(
      { profiles: nextProfiles, settings: nextSettings, projects: nextProjects },
      "已保存"
    );
  });

  test("replace 后旧 persist 不会保存或提交", async () => {
    const saveDocument = vi.fn<(rootPath: string, document: ProfileDocument) => Promise<void>>(
      async () => undefined
    );
    const onDocumentCommitted = vi.fn();
    const { result } = renderHook(() =>
      useProfileDocumentStore({
        initialRootPath: "/old-root",
        initialSettings: settings,
        initialProfiles: profiles,
        initialProjects: projects,
        saveDocument,
        onDocumentCommitted
      })
    );

    await act(async () => {
      const blocking = result.current.enqueueDocumentMutation(() => new Promise<void>((resolve) => {
        setTimeout(resolve, 0);
      }));
      const stalePersist = result.current.persistDocument({
        profiles: [profile({ id: "account-001", notes: "过期修改" })],
        message: "不应提交"
      });
      result.current.replaceProfileDocumentState({
        rootPath: "/new-root",
        profiles: [profile({ id: "account-999" })],
        settings,
        projects: []
      });
      await blocking;
      await expect(stalePersist).resolves.toBe(false);
    });

    expect(result.current.rootPath).toBe("/new-root");
    expect(result.current.profiles).toEqual([profile({ id: "account-999" })]);
    expect(saveDocument).not.toHaveBeenCalled();
    expect(onDocumentCommitted).not.toHaveBeenCalled();
  });

  test("setRootPath 往返 old -> new -> old 后旧 persist 不会保存或提交", async () => {
    const saveDocument = vi.fn<(rootPath: string, document: ProfileDocument) => Promise<void>>(
      async () => undefined
    );
    const onDocumentCommitted = vi.fn();
    const gate = deferred<void>();
    const { result } = renderHook(() =>
      useProfileDocumentStore({
        initialRootPath: "/old-root",
        initialSettings: settings,
        initialProfiles: profiles,
        initialProjects: projects,
        saveDocument,
        onDocumentCommitted
      })
    );

    await act(async () => {
      const blocking = result.current.enqueueDocumentMutation(() => gate.promise);
      const stalePersist = result.current.persistDocument({
        profiles: [profile({ id: "account-001", notes: "过期修改" })],
        message: "不应提交"
      });
      result.current.setRootPath("/new-root");
      result.current.setRootPath("/old-root");
      gate.resolve();
      await blocking;
      await expect(stalePersist).resolves.toBe(false);
    });

    expect(result.current.rootPath).toBe("/old-root");
    expect(saveDocument).not.toHaveBeenCalled();
    expect(onDocumentCommitted).not.toHaveBeenCalled();
  });

  test("setter 更新后 state 与 snapshot 保持一致", () => {
    const { result } = renderHook(() =>
      useProfileDocumentStore({
        initialRootPath: "/profiles",
        initialSettings: settings,
        initialProfiles: profiles,
        initialProjects: projects,
        saveDocument: vi.fn(),
        onDocumentCommitted: vi.fn()
      })
    );
    const nextProfiles = [profile({ id: "account-003" })];

    act(() => {
      result.current.setProfiles(nextProfiles);
      result.current.setRootPath("/updated-root");
    });

    expect(result.current.profiles).toEqual(nextProfiles);
    expect(result.current.getProfileDocumentSnapshot()).toEqual({
      rootPath: "/updated-root",
      profiles: nextProfiles,
      settings,
      projects
    });
  });
});

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

function profileSettings(overrides: Partial<ProfileSettings> = {}): ProfileSettings {
  return {
    browserPath: "/Applications/Google Chrome.app",
    favoriteUrls: [],
    recentUrls: [],
    urlLibrary: [],
    theme: "light",
    ...overrides
  };
}

function project(overrides: Partial<AirdropProject> = {}): AirdropProject {
  return {
    id: "project-001",
    name: "项目",
    url: "https://example.com",
    urls: [],
    notes: "",
    profileIds: [],
    intervalSeconds: 1,
    createdAt: "2026-07-15T00:00:00.000Z",
    updatedAt: "2026-07-15T00:00:00.000Z",
    lastOpenedAt: null,
    ...overrides
  };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
}
