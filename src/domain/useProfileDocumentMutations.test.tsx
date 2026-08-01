import { act, renderHook } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import type {
  AirdropProject,
  ChromeProfile,
  ProfileDocument,
  ProfileSettings
} from "../types";
import { useProfileDocumentMutations } from "./useProfileDocumentMutations";

describe("useProfileDocumentMutations", () => {
  test("两个排队 persist 分别修改不同账号时最终都保留", async () => {
    const settings = profileSettings();
    const profiles = [
      profile({ id: "account-001", name: "主号" }),
      profile({ id: "account-002", name: "副号" })
    ];
    const savedDocuments: ProfileDocument[] = [];
    const onCommitDocumentState = vi.fn();
    const { result } = renderHook(() =>
      useProfileDocumentMutations({
        rootPath: "/profiles",
        profiles,
        settings,
        projects: [],
        saveDocument: async (_rootPath, document) => {
          savedDocuments.push(document);
        },
        onCommitDocumentState
      })
    );

    await act(async () => {
      await Promise.all([
        result.current.persistDocument({
          profiles: profiles.map((current) =>
            current.id === "account-001"
              ? { ...current, notes: "第一笔修改" }
              : current
          ),
          message: "第一笔已保存"
        }),
        result.current.persistDocument({
          profiles: profiles.map((current) =>
            current.id === "account-002"
              ? { ...current, tags: ["queue"] }
              : current
          ),
          message: "第二笔已保存"
        })
      ]);
    });

    const lastSavedDocument = savedDocuments[savedDocuments.length - 1];
    expect(lastSavedDocument?.profiles).toEqual([
      expect.objectContaining({ id: "account-001", notes: "第一笔修改" }),
      expect.objectContaining({ id: "account-002", tags: ["queue"] })
    ]);
    expect(onCommitDocumentState).toHaveBeenLastCalledWith(
      {
        profiles: lastSavedDocument?.profiles,
        settings,
        projects: []
      },
      "第二笔已保存"
    );
  });

  test("队列中间发生旧 props rerender 时仍以已提交 refs 继续合并", async () => {
    const settings = profileSettings();
    const profiles = [
      profile({ id: "account-001", name: "主号" }),
      profile({ id: "account-002", name: "副号" })
    ];
    const savedDocuments: ProfileDocument[] = [];
    const onCommitDocumentState = vi.fn();
    const initialOptions = {
      rootPath: "/profiles",
      profiles,
      settings,
      projects: [] as AirdropProject[],
      saveDocument: async (_rootPath: string, document: ProfileDocument) => {
        savedDocuments.push(document);
      },
      onCommitDocumentState
    };
    let rerenderWithStaleProps: (() => void) | null = null;
    const { result, rerender } = renderHook(
      (options: typeof initialOptions) => useProfileDocumentMutations(options),
      { initialProps: initialOptions }
    );
    rerenderWithStaleProps = () => rerender(initialOptions);
    onCommitDocumentState.mockImplementationOnce(() => {
      rerenderWithStaleProps?.();
    });

    await act(async () => {
      await Promise.all([
        result.current.persistDocument({
          profiles: profiles.map((current) =>
            current.id === "account-001"
              ? { ...current, notes: "第一笔修改" }
              : current
          ),
          message: "第一笔已保存"
        }),
        result.current.persistDocument({
          profiles: profiles.map((current) =>
            current.id === "account-002"
              ? { ...current, tags: ["queue"] }
              : current
          ),
          message: "第二笔已保存"
        })
      ]);
    });

    expect(savedDocuments[savedDocuments.length - 1]?.profiles).toEqual([
      expect.objectContaining({ id: "account-001", notes: "第一笔修改" }),
      expect.objectContaining({ id: "account-002", tags: ["queue"] })
    ]);
  });

  test("同 root 旧 props rerender 不会覆盖已提交 document refs", () => {
    const settings = profileSettings();
    const profiles = [profile({ id: "account-001", name: "主号" })];
    const onCommitDocumentState = vi.fn();
    const initialOptions = {
      rootPath: "/profiles",
      profiles,
      settings,
      projects: [] as AirdropProject[],
      saveDocument: vi.fn(),
      onCommitDocumentState
    };
    const { result, rerender } = renderHook(
      (options: typeof initialOptions) => useProfileDocumentMutations(options),
      { initialProps: initialOptions }
    );

    const committedProfiles = [
      { ...profiles[0], notes: "已提交但 props 还没追上" }
    ];
    act(() => {
      result.current.commitProfileDocumentState(
        committedProfiles,
        settings,
        [],
        "已保存"
      );
    });
    rerender({ ...initialOptions, profiles });

    expect(result.current.getProfileDocumentSnapshot().profiles).toEqual(
      committedProfiles
    );
  });

  test("root generation 变更后旧 persist 不会保存或提交", async () => {
    const settings = profileSettings();
    const profiles = [profile({ id: "account-001" })];
    const gate = deferred<void>();
    const saveDocument = vi.fn();
    const onCommitDocumentState = vi.fn();
    const { result } = renderHook(() =>
      useProfileDocumentMutations({
        rootPath: "/old-root",
        profiles,
        settings,
        projects: [],
        saveDocument,
        onCommitDocumentState
      })
    );

    await act(async () => {
      const blocking = result.current.enqueueDocumentMutation(() => gate.promise);
      const stalePersist = result.current.persistDocument({
        profiles: [{ ...profiles[0], notes: "过期修改" }],
        message: "不应提交"
      });
      result.current.replaceProfileDocumentState({
        rootPath: "/new-root",
        profiles: [profile({ id: "account-999" })],
        settings,
        projects: []
      });
      gate.resolve();
      await blocking;
      await expect(stalePersist).resolves.toBe(false);
    });

    expect(saveDocument).not.toHaveBeenCalled();
    expect(onCommitDocumentState).not.toHaveBeenCalled();
  });

  test("stale persist 使用调用方旧 base，不会复活当前已删除账号", async () => {
    const settings = profileSettings();
    const oldProfiles = [
      profile({ id: "account-001", name: "主号" }),
      profile({ id: "account-002", name: "副号" })
    ];
    const savedDocuments: ProfileDocument[] = [];
    const { result } = renderHook(() =>
      useProfileDocumentMutations({
        rootPath: "/profiles",
        profiles: oldProfiles,
        settings,
        projects: [],
        saveDocument: async (_rootPath, document) => {
          savedDocuments.push(document);
        },
        onCommitDocumentState: vi.fn()
      })
    );

    await act(async () => {
      result.current.commitProfileDocumentState(
        [oldProfiles[1]],
        settings,
        [],
        "账号记录已删除"
      );
      await result.current.persistDocument({
        profiles: [
          { ...oldProfiles[0], lastOpenedAt: "2026-07-17T00:00:00.000Z" },
          oldProfiles[1]
        ],
        message: "旧启动完成",
        baseDocument: {
          profiles: oldProfiles,
          settings,
          projects: []
        }
      });
    });

    expect(
      savedDocuments[savedDocuments.length - 1]?.profiles.map((item) => item.id)
    ).toEqual(["account-002"]);
  });

  test("hook persist 保留复用同 ID 的新实体", async () => {
    const settings = profileSettings();
    const oldProfile = profile({
      id: "account-001",
      name: "旧账号",
      createdAt: "",
      lastOpenedAt: null
    });
    const replacementProfile = profile({
      id: "account-001",
      name: "复用新账号",
      createdAt: "2026-07-16T00:00:00.000Z",
      lastOpenedAt: null
    });
    const savedDocuments: ProfileDocument[] = [];
    const { result } = renderHook(() =>
      useProfileDocumentMutations({
        rootPath: "/profiles",
        profiles: [oldProfile],
        settings,
        projects: [],
        saveDocument: async (_rootPath, document) => {
          savedDocuments.push(document);
        },
        onCommitDocumentState: vi.fn()
      })
    );

    await act(async () => {
      await Promise.all([
        result.current.enqueueDocumentMutation(async () => {
          result.current.commitProfileDocumentState(
            [replacementProfile],
            settings,
            [],
            "导入已保存"
          );
        }),
        result.current.persistDocument({
          profiles: [
            {
              ...oldProfile,
              lastOpenedAt: "2026-07-17T00:00:00.000Z"
            }
          ],
          message: "旧账号启动已保存"
        })
      ]);
    });

    expect(savedDocuments[savedDocuments.length - 1]?.profiles).toEqual([
      expect.objectContaining({
        id: "account-001",
        name: "复用新账号",
        createdAt: "2026-07-16T00:00:00.000Z",
        lastOpenedAt: null
      })
    ]);
  });
});

function profileSettings(
  overrides: Partial<ProfileSettings> = {}
): ProfileSettings {
  return {
    browserPath: "/Applications/Google Chrome.app",
    favoriteUrls: [],
    recentUrls: [],
    urlLibrary: [],
    theme: "light",
    ...overrides
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

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}
