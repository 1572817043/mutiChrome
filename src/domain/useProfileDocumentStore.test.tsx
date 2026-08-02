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

  test("restoreProfileDocument 成功时更新 document state 并返回 restore 结果", async () => {
    const restoredSettings = profileSettings({ theme: "dark" });
    const restoredProfiles = [profile({ id: "account-restored" })];
    const restoredProjects = [project({ id: "project-restored" })];
    const restored: {
      document: ProfileDocument;
      settings: ProfileSettings;
      extra: string;
    } = {
      document: {
        version: 1,
        settings: restoredSettings,
        profiles: restoredProfiles,
        projects: restoredProjects
      },
      settings: restoredSettings,
      extra: "restore-result"
    };
    const restore = vi.fn(async () => restored);
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

    let restoredResult: typeof restored | null = null;
    await act(async () => {
      restoredResult = await result.current.restoreProfileDocument({
        targetRootPath: "/profiles",
        restore
      });
    });

    expect(restoredResult).toBe(restored);
    expect(restore).toHaveBeenCalledTimes(1);
    expect(result.current.profiles).toEqual(restoredProfiles);
    expect(result.current.settings).toEqual(restoredSettings);
    expect(result.current.projects).toEqual(restoredProjects);
  });

  test("restoreProfileDocument 在 target root 不匹配时不调用 restore 且不更新 state", async () => {
    const restore = vi.fn(async (): Promise<{
      document: ProfileDocument;
      settings: ProfileSettings;
    }> => ({
      document: {
        version: 1,
        settings,
        profiles: [profile({ id: "account-restored" })],
        projects: []
      },
      settings
    }));
    const { result } = renderHook(() =>
      useProfileDocumentStore({
        initialRootPath: "/current-root",
        initialSettings: settings,
        initialProfiles: profiles,
        initialProjects: projects,
        saveDocument: vi.fn(),
        onDocumentCommitted: vi.fn()
      })
    );

    let restoredResult: Awaited<ReturnType<typeof result.current.restoreProfileDocument>> = null;
    await act(async () => {
      restoredResult = await result.current.restoreProfileDocument({
        targetRootPath: "/stale-root",
        restore
      });
    });

    expect(restoredResult).toBeNull();
    expect(restore).not.toHaveBeenCalled();
    expect(result.current.profiles).toEqual(profiles);
    expect(result.current.settings).toEqual(settings);
    expect(result.current.projects).toEqual(projects);
  });

  test("restoreProfileDocument 等待期间 root 切换时返回 null 且不提交结果", async () => {
    const restoreGate = deferred<{
      document: ProfileDocument;
      settings: ProfileSettings;
    }>();
    const restoredProfiles = [profile({ id: "account-restored" })];
    const restore = vi.fn(() => restoreGate.promise);
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

    let restoredResult: Awaited<ReturnType<typeof result.current.restoreProfileDocument>> = null;
    await act(async () => {
      const restorePromise = result.current.restoreProfileDocument({
        targetRootPath: "/profiles",
        restore
      });
      await Promise.resolve();
      result.current.setRootPath("/other-root");
      restoreGate.resolve({
        document: {
          version: 1,
          settings,
          profiles: restoredProfiles,
          projects: []
        },
        settings
      });
      restoredResult = await restorePromise;
    });

    expect(restoredResult).toBeNull();
    expect(restore).toHaveBeenCalledTimes(1);
    expect(result.current.rootPath).toBe("/other-root");
    expect(result.current.profiles).toEqual(profiles);
    expect(result.current.settings).toEqual(settings);
    expect(result.current.projects).toEqual(projects);
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

  test("两个排队 persist 分别修改不同账号时最终都保留", async () => {
    const initialProfiles = [
      profile({ id: "account-001", name: "主号" }),
      profile({ id: "account-002", name: "副号" })
    ];
    const savedDocuments: ProfileDocument[] = [];
    const gate = deferred<void>();
    const { result } = renderHook(() =>
      useProfileDocumentStore({
        initialSettings: settings,
        initialProfiles,
        saveDocument: async (_rootPath, document) => {
          savedDocuments.push(document);
        },
        onDocumentCommitted: vi.fn()
      })
    );
    const firstProfiles = initialProfiles.map((profile) =>
      profile.id === "account-001"
        ? { ...profile, notes: "第一笔修改" }
        : profile
    );
    const secondProfiles = initialProfiles.map((profile) =>
      profile.id === "account-002"
        ? { ...profile, tags: ["queue"] }
        : profile
    );

    await act(async () => {
      const blocking = result.current.enqueueDocumentMutation(() => gate.promise);
      const firstPersist = result.current.persistProfileDocument(
        firstProfiles,
        "第一笔已保存"
      );
      result.current.setProfiles(secondProfiles);
      const secondPersist = result.current.persistProfileDocument(
        secondProfiles,
        "第二笔已保存"
      );
      gate.resolve();
      await blocking;
      await Promise.all([firstPersist, secondPersist]);
    });

    expect(savedDocuments[savedDocuments.length - 1]?.profiles).toEqual([
      expect.objectContaining({ id: "account-001", notes: "第一笔修改" }),
      expect.objectContaining({ id: "account-002", tags: ["queue"] })
    ]);
  });

  test("setter 更新 settings 和 projects 后 persist 默认使用最新 state", async () => {
    const saveDocument = vi.fn<
      (rootPath: string, document: ProfileDocument) => Promise<void>
    >(async () => undefined);
    const nextSettings = profileSettings({ theme: "dark" });
    const nextProjects = [project({ id: "project-002" })];
    const { result } = renderHook(() =>
      useProfileDocumentStore({
        initialSettings: settings,
        initialProfiles: profiles,
        initialProjects: projects,
        saveDocument,
        onDocumentCommitted: vi.fn()
      })
    );

    await act(async () => {
      result.current.setSettings(nextSettings);
      result.current.setProjects(nextProjects);
      await result.current.persistProfileDocument(profiles, "已保存");
    });

    expect(saveDocument).toHaveBeenCalledWith("", {
      version: 1,
      settings: nextSettings,
      profiles,
      projects: nextProjects
    });
  });

  test("root 切换后旧 persist 不会绑定新 root", async () => {
    const saveDocument = vi.fn<
      (rootPath: string, document: ProfileDocument) => Promise<void>
    >(async () => undefined);
    const onDocumentCommitted = vi.fn();
    const { result } = renderHook(() =>
      useProfileDocumentStore({
        initialRootPath: "/old-root",
        initialSettings: settings,
        initialProfiles: profiles,
        saveDocument,
        onDocumentCommitted
      })
    );
    const oldPersistProfileDocument = result.current.persistProfileDocument;

    act(() => {
      result.current.setRootPath("/new-root");
    });

    await act(async () => {
      await expect(
        oldPersistProfileDocument(profiles, "旧 root 不应保存")
      ).resolves.toBe(false);
    });

    expect(saveDocument).not.toHaveBeenCalled();
    expect(onDocumentCommitted).not.toHaveBeenCalled();
  });

  test("shouldCommit 返回 false 时 persist 不保存不提交", async () => {
    const saveDocument = vi.fn<
      (rootPath: string, document: ProfileDocument) => Promise<void>
    >(async () => undefined);
    const onDocumentCommitted = vi.fn();
    const { result } = renderHook(() =>
      useProfileDocumentStore({
        initialSettings: settings,
        initialProfiles: profiles,
        saveDocument,
        onDocumentCommitted
      })
    );

    let persisted = true;
    await act(async () => {
      persisted = await result.current.persistProfileDocument(
        profiles,
        "不应保存",
        undefined,
        undefined,
        undefined,
        () => false
      );
    });

    expect(persisted).toBe(false);
    expect(saveDocument).not.toHaveBeenCalled();
    expect(onDocumentCommitted).not.toHaveBeenCalled();
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

  test("loadProfileDocument 更新完整 document state 和 snapshot", () => {
    const nextSettings = profileSettings({ theme: "dark" });
    const nextProfiles = [profile({ id: "account-loaded" })];
    const nextProjects = [project({ id: "project-loaded", profileIds: ["account-loaded"] })];
    const { result } = renderHook(() =>
      useProfileDocumentStore({
        initialRootPath: "/old-root",
        initialSettings: settings,
        initialProfiles: profiles,
        initialProjects: projects,
        saveDocument: vi.fn(),
        onDocumentCommitted: vi.fn()
      })
    );

    act(() => {
      result.current.loadProfileDocument({
        rootPath: "/loaded-root",
        profiles: nextProfiles,
        settings: nextSettings,
        projects: nextProjects
      });
    });

    expect(result.current.rootPath).toBe("/loaded-root");
    expect(result.current.profiles).toEqual(nextProfiles);
    expect(result.current.settings).toEqual(nextSettings);
    expect(result.current.projects).toEqual(nextProjects);
    expect(result.current.getProfileDocumentSnapshot()).toEqual({
      rootPath: "/loaded-root",
      profiles: nextProfiles,
      settings: nextSettings,
      projects: nextProjects
    });
  });

  test("loadProfileDocument 后旧 persist 不会保存或提交", async () => {
    const saveDocument = vi.fn<
      (rootPath: string, document: ProfileDocument) => Promise<void>
    >(async () => undefined);
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
      result.current.loadProfileDocument({
        rootPath: "/loaded-root",
        profiles: [profile({ id: "account-loaded" })],
        settings,
        projects: []
      });
      await blocking;
      await expect(stalePersist).resolves.toBe(false);
    });

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
