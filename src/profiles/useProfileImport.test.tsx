import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { profileApi } from "../api";
import type { ChromeProfile, ProfileImportCandidate } from "../types";
import { useProfileImport } from "./useProfileImport";

function profile(overrides: Partial<ChromeProfile> = {}): ChromeProfile {
  return {
    id: "account-001",
    name: "主号",
    tags: [],
    notes: "",
    status: "active",
    accountPlatforms: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    lastOpenedAt: null,
    ...overrides
  };
}

function importCandidate(
  overrides: Partial<ProfileImportCandidate> = {}
): ProfileImportCandidate {
  return {
    path: "/Volumes/SATA/profiles/twitter-main",
    folderName: "twitter-main",
    suggestedName: "推特主号",
    suggestedTags: ["旧盘"],
    suggestedNotes: "来源：旧索引",
    sizeBytes: 1024,
    confidence: "ready",
    evidence: ["发现 Default/Preferences"],
    skippedReason: null,
    profileUid: null,
    duplicateProfileId: null,
    duplicateProfileName: null,
    duplicateReason: null,
    ...overrides
  };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, resolve, reject };
}

type ImportPersistResult = "not-saved" | "saved-committed" | "saved-stale";

type TestImportCandidates = (
  candidates: ProfileImportCandidate[],
  shouldCommit: () => boolean
) => Promise<ImportPersistResult> | ImportPersistResult;

type RenderProfileImportOverrides = Omit<
  Partial<Parameters<typeof useProfileImport>[0]>,
  "onImportCandidates"
> & {
  onImportCandidates?: TestImportCandidates;
  getDocumentVersion?: () => number;
};

function renderProfileImport(
  overrides: RenderProfileImportOverrides = {}
) {
  const onImportCandidates = vi.fn().mockResolvedValue("saved-committed");
  const onMessage = vi.fn();
  const hook = renderHook(
    ({ profiles }) =>
      useProfileImport({
        rootPath: "/current-root",
        profiles,
        getDocumentVersion: () => 0,
        onImportCandidates,
        onMessage,
        ...overrides
      } as Parameters<typeof useProfileImport>[0]),
    {
      initialProps: {
        profiles: [
          profile(),
          profile({
            id: "account-002",
            name: "备用号"
          })
        ]
      }
    }
  );

  return {
    hook,
    onImportCandidates,
    onMessage
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useProfileImport", () => {
  test("输入来源路径时清空候选预览和选择", async () => {
    vi.spyOn(profileApi, "scanProfileImportCandidates").mockResolvedValue([
      importCandidate()
    ]);
    const { hook } = renderProfileImport();

    act(() => {
      hook.result.current.onImportPathChange("/first-source");
    });
    await act(async () => {
      await hook.result.current.scanImportCandidates();
    });
    expect(hook.result.current.importCandidates).toHaveLength(1);
    expect(hook.result.current.selectedImportPaths).toEqual([
      "/Volumes/SATA/profiles/twitter-main"
    ]);

    act(() => {
      hook.result.current.onImportPathChange("/next-source");
    });

    expect(hook.result.current.importPath).toBe("/next-source");
    expect(hook.result.current.importCandidates).toEqual([]);
    expect(hook.result.current.selectedImportPaths).toEqual([]);
  });

  test("扫描成功默认选择 ready 非重复候选并正确汇总消息", async () => {
    const candidates = [
      importCandidate(),
      importCandidate({
        path: "/Volumes/SATA/profiles/maybe",
        suggestedName: "maybe",
        confidence: "suspicious"
      }),
      importCandidate({
        path: "/Volumes/SATA/profiles/imported-ready",
        suggestedName: "imported-ready",
        duplicateProfileId: "account-001",
        duplicateProfileName: "主号"
      }),
      importCandidate({
        path: "/Volumes/SATA/profiles/imported-suspicious",
        suggestedName: "imported-suspicious",
        confidence: "suspicious",
        duplicateProfileId: "account-002",
        duplicateProfileName: "备用号"
      })
    ];
    const scanSpy = vi
      .spyOn(profileApi, "scanProfileImportCandidates")
      .mockResolvedValue(candidates);
    const { hook, onMessage } = renderProfileImport();

    act(() => {
      hook.result.current.onImportPathChange("  /source-root  ");
    });
    await act(async () => {
      await hook.result.current.scanImportCandidates();
    });

    expect(scanSpy).toHaveBeenCalledWith("/current-root", "/source-root");
    expect(hook.result.current.importCandidates).toEqual(candidates);
    expect(hook.result.current.selectedImportPaths).toEqual([
      "/Volumes/SATA/profiles/twitter-main"
    ]);
    expect(hook.result.current.selectedImportCount).toBe(1);
    expect(onMessage).toHaveBeenLastCalledWith("可导入 1 · 可疑 1 · 已导入 2");
    expect(hook.result.current.importScanning).toBe(false);
  });

  test("导入成功后把选中候选交给 App、清空状态并关闭面板", async () => {
    const candidates = [
      importCandidate(),
      importCandidate({
        path: "/Volumes/SATA/profiles/galxe-01",
        folderName: "galxe-01",
        suggestedName: "Galxe 01",
        suggestedTags: ["galxe"],
        suggestedNotes: "   "
      })
    ];
    vi.spyOn(profileApi, "scanProfileImportCandidates").mockResolvedValue(candidates);
    const { hook, onImportCandidates } = renderProfileImport();

    act(() => {
      hook.result.current.toggleImportPanel();
      hook.result.current.onImportPathChange("/source-root");
    });
    await act(async () => {
      await hook.result.current.scanImportCandidates();
    });
    await act(async () => {
      await hook.result.current.importSelectedCandidates();
    });

    expect(onImportCandidates).toHaveBeenCalledWith(candidates, expect.any(Function));
    expect(hook.result.current).toMatchObject({
      importPath: "",
      importCandidates: [],
      selectedImportPaths: [],
      importingProfiles: false,
      showImport: false
    });
  });

  test("导入失败时显示原始错误且不清空当前预览", async () => {
    vi.spyOn(profileApi, "scanProfileImportCandidates").mockResolvedValue([
      importCandidate(),
      importCandidate({
        path: "/Volumes/SATA/profiles/galxe-01",
        folderName: "galxe-01",
        suggestedName: "Galxe 01"
      })
    ]);
    const onImportCandidates = vi.fn().mockRejectedValue(new Error("复制失败"));
    const { hook, onMessage } = renderProfileImport({
      onImportCandidates
    });

    act(() => {
      hook.result.current.onImportPathChange("/source-root");
    });
    await act(async () => {
      await hook.result.current.scanImportCandidates();
    });
    await act(async () => {
      await hook.result.current.importSelectedCandidates();
    });

    expect(onImportCandidates).toHaveBeenCalledTimes(1);
    expect(onMessage).toHaveBeenLastCalledWith("复制失败");
    expect(hook.result.current.importCandidates).toHaveLength(2);
    expect(hook.result.current.importingProfiles).toBe(false);
  });

  test("resetForLoadedRoot 清空导入状态但保留面板开关", async () => {
    vi.spyOn(profileApi, "scanProfileImportCandidates").mockResolvedValue([
      importCandidate()
    ]);
    const importTask = deferred<ImportPersistResult>();
    const onImportCandidates = vi.fn(() => importTask.promise);
    const { hook } = renderProfileImport({ onImportCandidates });

    act(() => {
      hook.result.current.toggleImportPanel();
      hook.result.current.onImportPathChange("/source-root");
    });
    await act(async () => {
      await hook.result.current.scanImportCandidates();
    });
    act(() => {
      void hook.result.current.importSelectedCandidates();
    });
    expect(hook.result.current.importingProfiles).toBe(true);

    act(() => {
      hook.result.current.resetForLoadedRoot();
    });

    expect(hook.result.current).toMatchObject({
      importPath: "",
      importCandidates: [],
      selectedImportPaths: [],
      importScanning: false,
      importingProfiles: false,
      showImport: true
    });
  });

  test("旧扫描在 reset 后晚返回不会污染新 root 的预览、消息和扫描状态", async () => {
    const oldScan = deferred<ProfileImportCandidate[]>();
    const newScan = deferred<ProfileImportCandidate[]>();
    vi.spyOn(profileApi, "scanProfileImportCandidates")
      .mockReturnValueOnce(oldScan.promise)
      .mockReturnValueOnce(newScan.promise);
    const { hook, onMessage } = renderProfileImport();

    act(() => {
      hook.result.current.onImportPathChange("/old-source");
    });
    act(() => {
      void hook.result.current.scanImportCandidates();
    });
    expect(hook.result.current.importScanning).toBe(true);

    act(() => {
      hook.result.current.resetForLoadedRoot();
      hook.result.current.onImportPathChange("/new-source");
    });
    act(() => {
      void hook.result.current.scanImportCandidates();
    });
    expect(hook.result.current.importScanning).toBe(true);

    await act(async () => {
      oldScan.resolve([importCandidate({ path: "/old/profile" })]);
      await oldScan.promise;
    });

    expect(hook.result.current.importCandidates).toEqual([]);
    expect(hook.result.current.selectedImportPaths).toEqual([]);
    expect(hook.result.current.importScanning).toBe(true);
    expect(onMessage).not.toHaveBeenCalled();

    await act(async () => {
      newScan.resolve([importCandidate({ path: "/new/profile" })]);
      await newScan.promise;
    });
  });

  test("修改来源路径会让进行中的扫描失效", async () => {
    const oldScan = deferred<ProfileImportCandidate[]>();
    vi.spyOn(profileApi, "scanProfileImportCandidates").mockReturnValue(
      oldScan.promise
    );
    const { hook, onMessage } = renderProfileImport();

    act(() => {
      hook.result.current.onImportPathChange("/source-a");
    });
    act(() => {
      void hook.result.current.scanImportCandidates();
    });
    expect(hook.result.current.importScanning).toBe(true);

    act(() => {
      hook.result.current.onImportPathChange("/source-b");
    });

    await act(async () => {
      oldScan.resolve([importCandidate({ path: "/source-a/profile" })]);
      await oldScan.promise;
    });

    expect(hook.result.current.importCandidates).toEqual([]);
    expect(hook.result.current.selectedImportPaths).toEqual([]);
    expect(hook.result.current.importScanning).toBe(false);
    expect(onMessage).not.toHaveBeenCalled();
  });

  test("修改来源路径后发起新扫描时旧扫描不能关闭新 loading", async () => {
    const oldScan = deferred<ProfileImportCandidate[]>();
    const newScan = deferred<ProfileImportCandidate[]>();
    vi.spyOn(profileApi, "scanProfileImportCandidates")
      .mockReturnValueOnce(oldScan.promise)
      .mockReturnValueOnce(newScan.promise);
    const { hook, onMessage } = renderProfileImport();

    act(() => {
      hook.result.current.onImportPathChange("/source-a");
    });
    act(() => {
      void hook.result.current.scanImportCandidates();
    });
    act(() => {
      hook.result.current.onImportPathChange("/source-b");
    });
    act(() => {
      void hook.result.current.scanImportCandidates();
    });

    expect(hook.result.current.importScanning).toBe(true);

    await act(async () => {
      oldScan.resolve([importCandidate({ path: "/source-a/profile" })]);
      await oldScan.promise;
    });

    expect(hook.result.current.importCandidates).toEqual([]);
    expect(hook.result.current.selectedImportPaths).toEqual([]);
    expect(hook.result.current.importScanning).toBe(true);
    expect(onMessage).not.toHaveBeenCalled();

    await act(async () => {
      newScan.resolve([importCandidate({ path: "/source-b/profile" })]);
      await newScan.promise;
    });
  });

  test("旧导入在 reset 后完成不会污染新 root 面板状态或打开旧候选", async () => {
    vi.spyOn(profileApi, "scanProfileImportCandidates").mockResolvedValue([
      importCandidate()
    ]);
    const persist = deferred<ImportPersistResult>();
    const onImportCandidates = vi.fn(() => persist.promise);
    const { hook } = renderProfileImport({
      onImportCandidates
    });

    act(() => {
      hook.result.current.toggleImportPanel();
      hook.result.current.onImportPathChange("/old-source");
    });
    await act(async () => {
      await hook.result.current.scanImportCandidates();
    });

    let importPromise!: Promise<void>;
    act(() => {
      importPromise = hook.result.current.importSelectedCandidates();
    });
    await vi.waitFor(() => {
      expect(onImportCandidates).toHaveBeenCalledTimes(1);
    });

    act(() => {
      hook.result.current.resetForLoadedRoot();
      hook.result.current.toggleImportPanel();
      hook.result.current.toggleImportPanel();
      hook.result.current.onImportPathChange("/new-source");
    });

    await act(async () => {
      persist.resolve("saved-stale");
      await importPromise;
    });

    expect(onImportCandidates).toHaveBeenCalledTimes(1);
    expect(hook.result.current.importPath).toBe("/new-source");
    expect(hook.result.current.showImport).toBe(true);
  });

  test("reset 后导入任务返回 not-saved 不污染当前 UI", async () => {
    vi.spyOn(profileApi, "scanProfileImportCandidates").mockResolvedValue([
      importCandidate()
    ]);
    const importTask = deferred<ImportPersistResult>();
    const onImportCandidates = vi.fn(() => importTask.promise);
    const { hook, onMessage } = renderProfileImport({
      onImportCandidates
    });

    act(() => {
      hook.result.current.toggleImportPanel();
      hook.result.current.onImportPathChange("/old-source");
    });
    await act(async () => {
      await hook.result.current.scanImportCandidates();
    });
    onMessage.mockClear();

    let importPromise!: Promise<void>;
    act(() => {
      importPromise = hook.result.current.importSelectedCandidates();
    });
    expect(hook.result.current.importingProfiles).toBe(true);

    act(() => {
      hook.result.current.resetForLoadedRoot();
      hook.result.current.toggleImportPanel();
      hook.result.current.toggleImportPanel();
      hook.result.current.onImportPathChange("/new-source");
    });

    await act(async () => {
      importTask.resolve("not-saved");
      await importPromise;
    });

    expect(onImportCandidates).toHaveBeenCalledTimes(1);
    expect(onMessage).not.toHaveBeenCalled();
    expect(hook.result.current.importPath).toBe("/new-source");
    expect(hook.result.current.showImport).toBe(true);
  });

  test("导入任务返回 not-saved 时不清空预览也不打开候选", async () => {
    vi.spyOn(profileApi, "scanProfileImportCandidates").mockResolvedValue([
      importCandidate()
    ]);
    const onImportCandidates = vi.fn(() => "not-saved" as const);
    const { hook, onMessage } = renderProfileImport({
      onImportCandidates
    });

    act(() => {
      hook.result.current.toggleImportPanel();
      hook.result.current.onImportPathChange("/source-root");
    });
    await act(async () => {
      await hook.result.current.scanImportCandidates();
    });
    onMessage.mockClear();

    await act(async () => {
      await hook.result.current.importSelectedCandidates();
    });

    expect(onImportCandidates).toHaveBeenCalledTimes(1);
    expect(onMessage).not.toHaveBeenCalled();
    expect(hook.result.current.importPath).toBe("/source-root");
    expect(hook.result.current.showImport).toBe(true);
  });

  test("App 导入任务在 reset 后返回 not-saved 不污染当前 UI", async () => {
    vi.spyOn(profileApi, "scanProfileImportCandidates").mockResolvedValue([
      importCandidate()
    ]);
    const persist = deferred<void>();
    let guardResultAfterResolve: boolean | undefined;
    const onImportCandidates = vi.fn(
      async (_candidates: ProfileImportCandidate[], shouldCommit: () => boolean) => {
        await persist.promise;
        guardResultAfterResolve = shouldCommit();
        return "not-saved" as const;
      }
    );
    const { hook, onMessage } = renderProfileImport({
      onImportCandidates
    });

    act(() => {
      hook.result.current.toggleImportPanel();
      hook.result.current.onImportPathChange("/old-source");
    });
    await act(async () => {
      await hook.result.current.scanImportCandidates();
    });
    onMessage.mockClear();

    let importPromise!: Promise<void>;
    act(() => {
      importPromise = hook.result.current.importSelectedCandidates();
    });
    await vi.waitFor(() => {
      expect(onImportCandidates).toHaveBeenCalledTimes(1);
    });

    act(() => {
      hook.result.current.resetForLoadedRoot();
      hook.result.current.toggleImportPanel();
      hook.result.current.toggleImportPanel();
      hook.result.current.onImportPathChange("/new-source");
    });

    await act(async () => {
      persist.resolve();
      await importPromise;
    });

    expect(guardResultAfterResolve).toBe(false);
    expect(onMessage).not.toHaveBeenCalled();
    expect(hook.result.current.importPath).toBe("/new-source");
    expect(hook.result.current.showImport).toBe(true);
  });

  test("App 导入任务返回 saved-stale 不污染当前 UI", async () => {
    vi.spyOn(profileApi, "scanProfileImportCandidates").mockResolvedValue([
      importCandidate()
    ]);
    const persist = deferred<void>();
    let guardResultAfterResolve: boolean | undefined;
    const onImportCandidates = vi.fn(
      async (_candidates: ProfileImportCandidate[], shouldCommit: () => boolean) => {
        await persist.promise;
        guardResultAfterResolve = shouldCommit();
        return "saved-stale" as const;
      }
    );
    const { hook, onMessage } = renderProfileImport({
      onImportCandidates
    });

    act(() => {
      hook.result.current.toggleImportPanel();
      hook.result.current.onImportPathChange("/old-source");
    });
    await act(async () => {
      await hook.result.current.scanImportCandidates();
    });
    onMessage.mockClear();

    let importPromise!: Promise<void>;
    act(() => {
      importPromise = hook.result.current.importSelectedCandidates();
    });
    await vi.waitFor(() => {
      expect(onImportCandidates).toHaveBeenCalledTimes(1);
    });

    act(() => {
      hook.result.current.resetForLoadedRoot();
      hook.result.current.toggleImportPanel();
      hook.result.current.toggleImportPanel();
      hook.result.current.onImportPathChange("/new-source");
    });

    await act(async () => {
      persist.resolve();
      await importPromise;
    });

    expect(guardResultAfterResolve).toBe(false);
    expect(onMessage).not.toHaveBeenCalled();
    expect(hook.result.current.importPath).toBe("/new-source");
    expect(hook.result.current.showImport).toBe(true);
  });

  test("导入中修改来源路径会让旧导入失效且不清空新路径", async () => {
    vi.spyOn(profileApi, "scanProfileImportCandidates").mockResolvedValue([
      importCandidate()
    ]);
    const importTask = deferred<ImportPersistResult>();
    let shouldCommit!: () => boolean;
    const onImportCandidates = vi.fn(
      (
        _candidates: ProfileImportCandidate[],
        currentRequest: () => boolean
      ) => {
        shouldCommit = currentRequest;
        return importTask.promise;
      }
    );
    const { hook } = renderProfileImport({ onImportCandidates });

    act(() => {
      hook.result.current.toggleImportPanel();
      hook.result.current.onImportPathChange("/old-source");
    });
    await act(async () => {
      await hook.result.current.scanImportCandidates();
    });
    act(() => {
      void hook.result.current.importSelectedCandidates();
    });
    await vi.waitFor(() => {
      expect(onImportCandidates).toHaveBeenCalledTimes(1);
    });

    act(() => {
      hook.result.current.onImportPathChange("/new-source");
    });
    expect(shouldCommit()).toBe(false);

    await act(async () => {
      importTask.resolve("saved-committed");
      await importTask.promise;
    });

    expect(hook.result.current.importPath).toBe("/new-source");
    expect(hook.result.current.importCandidates).toEqual([]);
    expect(hook.result.current.importingProfiles).toBe(false);
    expect(hook.result.current.showImport).toBe(true);
  });
});
