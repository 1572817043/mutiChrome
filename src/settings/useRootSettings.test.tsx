import { act, renderHook } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { profileApi, type ChromeStatus, type RootStatus } from "../api";
import type { ProfileDocument, ProfileSettings } from "../types";
import { useRootSettings } from "./useRootSettings";

function settings(
  browserPath = "/Applications/Google Chrome.app",
  theme: ProfileSettings["theme"] = "light"
): ProfileSettings {
  return {
    browserPath,
    favoriteUrls: [],
    recentUrls: [],
    urlLibrary: [],
    theme
  };
}

function renderRootSettings(
  rootPath = "/tmp/committed-root",
  committedSettings = settings(),
  overrides: Partial<Parameters<typeof useRootSettings>[0]> = {}
) {
  const onLoadRoot = vi.fn();
  const onReadRootData = vi.fn();
  const onCommitLoadedRoot = vi.fn();
  const onPersistSettings = vi.fn();
  const onMessage = vi.fn();
  const onBeginRootSwitch = vi.fn(() => 1);
  const isCurrentRootSwitch = vi.fn(() => true);
  const onFinishRootSwitch = vi.fn();
  const options = {
    onBeginRootSwitch,
    isCurrentRootSwitch,
    onFinishRootSwitch,
    onLoadRoot,
    onReadRootData,
    onCommitLoadedRoot,
    onPersistSettings,
    onMessage,
    ...overrides
  };

  return renderHook(
    ({ currentRootPath, currentSettings }) =>
      useRootSettings({
        rootPath: currentRootPath,
        settings: currentSettings,
        ...options
      }),
    {
      initialProps: {
        currentRootPath: rootPath,
        currentSettings: committedSettings
      }
    }
  );
}

function rootStatus(profileCount = 3): RootStatus {
  return {
    rootExists: true,
    writable: true,
    profileCount
  };
}

function chromeStatus(appPath = "/tmp/Chrome.app"): ChromeStatus {
  return {
    available: true,
    appPath
  };
}

function documentWithSettings(profileSettings = settings()): ProfileDocument {
  return {
    version: 1,
    settings: profileSettings,
    profiles: [],
    projects: []
  };
}

describe("useRootSettings", () => {
  test("resetDrafts 恢复 committed root、browserPath 和 theme", () => {
    const hook = renderRootSettings();

    act(() => {
      hook.result.current.rootSettings.onRootPathChange("/tmp/draft-root");
      hook.result.current.rootSettings.onBrowserPathChange("/tmp/Draft Chrome.app");
      hook.result.current.rootSettings.onThemeChange("dark");
    });
    hook.rerender({
      currentRootPath: "/tmp/next-committed-root",
      currentSettings: settings("/tmp/Committed Chrome.app", "dark")
    });
    act(() => {
      hook.result.current.resetDrafts();
    });

    expect(hook.result.current.rootSettings).toMatchObject({
      rootPathDraft: "/tmp/next-committed-root",
      browserPathDraft: "/tmp/Committed Chrome.app",
      themeDraft: "dark"
    });
  });

  test("syncLoadedRoot 同步 root status、Chrome status 和设置草稿", () => {
    const hook = renderRootSettings();
    const loadedRootStatus = rootStatus(3);
    const loadedChromeStatus = chromeStatus("/tmp/Loaded Chrome.app");

    act(() => {
      hook.result.current.syncLoadedRoot(
        "/tmp/loaded-root",
        loadedRootStatus,
        settings("/tmp/Loaded Chrome.app", "dark"),
        loadedChromeStatus
      );
    });

    expect(hook.result.current.rootSettings).toMatchObject({
      rootPathDraft: "/tmp/loaded-root",
      rootStatus: loadedRootStatus,
      chromeStatus: loadedChromeStatus,
      browserPathDraft: "/tmp/Loaded Chrome.app",
      themeDraft: "dark"
    });
  });

  test("syncPersistedSettings 更新 profileCount，同步外部变更的 browserPath，但不自动改 theme", () => {
    const hook = renderRootSettings(
      "/tmp/committed-root",
      settings("/tmp/Committed Chrome.app", "light")
    );

    act(() => {
      hook.result.current.syncLoadedRoot(
        "/tmp/committed-root",
        rootStatus(1),
        settings("/tmp/Committed Chrome.app", "light"),
        chromeStatus()
      );
      hook.result.current.rootSettings.onThemeChange("dark");
      hook.result.current.syncPersistedSettings(
        settings("/tmp/Persisted Chrome.app", "light"),
        7
      );
    });

    expect(hook.result.current.rootSettings.rootStatus).toMatchObject({
      profileCount: 7
    });
    expect(hook.result.current.rootSettings.browserPathDraft).toBe(
      "/tmp/Persisted Chrome.app"
    );
    expect(hook.result.current.rootSettings.themeDraft).toBe("dark");
  });

  test("syncRestoredRoot 同步 root status、Chrome status、browserPath 和 theme 草稿", () => {
    const hook = renderRootSettings();
    const restoredRootStatus = rootStatus(5);
    const restoredChromeStatus = chromeStatus("/tmp/Restored Chrome.app");

    act(() => {
      hook.result.current.syncRestoredRoot(
        restoredRootStatus,
        settings("/tmp/Restored Chrome.app", "dark"),
        restoredChromeStatus
      );
    });

    expect(hook.result.current.rootSettings).toMatchObject({
      rootStatus: restoredRootStatus,
      chromeStatus: restoredChromeStatus,
      browserPathDraft: "/tmp/Restored Chrome.app",
      themeDraft: "dark"
    });
  });

  test("同 root 保存先持久化设置再检测 Chrome，检测失败时清空 Chrome 状态并提示错误", async () => {
    const onPersistSettings = vi.fn().mockResolvedValue(undefined);
    const onMessage = vi.fn();
    const detectChromeSpy = vi
      .spyOn(profileApi, "detectChrome")
      .mockRejectedValue(new Error("Chrome missing"));
    const hook = renderRootSettings(
      "/tmp/committed-root",
      settings("/tmp/Committed Chrome.app", "light"),
      { onPersistSettings, onMessage }
    );

    act(() => {
      hook.result.current.syncLoadedRoot(
        "/tmp/committed-root",
        rootStatus(),
        settings("/tmp/Committed Chrome.app", "light"),
        chromeStatus("/tmp/Existing Chrome.app")
      );
      hook.result.current.rootSettings.onBrowserPathChange("/tmp/Draft Chrome.app");
      hook.result.current.rootSettings.onThemeChange("dark");
    });
    await act(async () => {
      await hook.result.current.rootSettings.onSaveSettings();
    });

    expect(onPersistSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        browserPath: "/tmp/Draft Chrome.app",
        theme: "dark"
      })
    );
    expect(detectChromeSpy).toHaveBeenCalledWith("/tmp/Draft Chrome.app");
    expect(onPersistSettings.mock.invocationCallOrder[0]).toBeLessThan(
      detectChromeSpy.mock.invocationCallOrder[0]
    );
    expect(hook.result.current.rootSettings.chromeStatus).toBeNull();
    expect(onMessage).toHaveBeenCalledWith("Chrome missing");
    detectChromeSpy.mockRestore();
  });

  test("跨 root 保存用草稿写入新 root document，detect 失败仍先 commit loaded root 再清空并提示", async () => {
    const onReadRootData = vi.fn().mockResolvedValue({
      status: rootStatus(2),
      document: documentWithSettings(settings("/tmp/Loaded Chrome.app", "light")),
      settings: settings("/tmp/Loaded Chrome.app", "light"),
      chrome: chromeStatus("/tmp/Loaded Chrome.app")
    });
    const onCommitLoadedRoot = vi.fn().mockResolvedValue(undefined);
    const onMessage = vi.fn();
    const saveProfilesSpy = vi.spyOn(profileApi, "saveProfiles").mockResolvedValue();
    const detectChromeSpy = vi
      .spyOn(profileApi, "detectChrome")
      .mockRejectedValue(new Error("Chrome missing"));
    const hook = renderRootSettings(
      "/tmp/committed-root",
      settings("/tmp/Committed Chrome.app", "light"),
      { onReadRootData, onCommitLoadedRoot, onMessage }
    );

    act(() => {
      hook.result.current.rootSettings.onRootPathChange("/tmp/next-root");
      hook.result.current.rootSettings.onBrowserPathChange("/tmp/Draft Chrome.app");
      hook.result.current.rootSettings.onThemeChange("dark");
    });
    await act(async () => {
      await hook.result.current.rootSettings.onSaveSettings();
    });

    expect(saveProfilesSpy).toHaveBeenCalledWith(
      "/tmp/next-root",
      expect.objectContaining({
        settings: expect.objectContaining({
          browserPath: "/tmp/Draft Chrome.app",
          theme: "dark"
        })
      })
    );
    expect(onCommitLoadedRoot).toHaveBeenCalledWith(
      "/tmp/next-root",
      expect.objectContaining({
        settings: expect.objectContaining({
          browserPath: "/tmp/Draft Chrome.app",
          theme: "dark"
        })
      })
    );
    expect(detectChromeSpy.mock.invocationCallOrder[0]).toBeLessThan(
      onCommitLoadedRoot.mock.invocationCallOrder[0]
    );
    expect(onCommitLoadedRoot.mock.invocationCallOrder[0]).toBeLessThan(
      onMessage.mock.invocationCallOrder[0]
    );
    expect(hook.result.current.rootSettings.chromeStatus).toBeNull();
    expect(onMessage).toHaveBeenCalledWith("Chrome missing");
    saveProfilesSpy.mockRestore();
    detectChromeSpy.mockRestore();
  });

  test("跨 root 检测和保存都会在读取目标根前开启生命周期", async () => {
    const onBeginRootSwitch = vi.fn(() => 7);
    const isCurrentRootSwitch = vi.fn(() => true);
    const onFinishRootSwitch = vi.fn();
    const onLoadRoot = vi.fn().mockResolvedValue(undefined);
    const onReadRootData = vi.fn().mockResolvedValue({
      status: rootStatus(1),
      document: documentWithSettings(),
      settings: settings(),
      chrome: chromeStatus()
    });
    const hook = renderRootSettings(
      "/tmp/committed-root",
      settings(),
      {
        onBeginRootSwitch,
        isCurrentRootSwitch,
        onFinishRootSwitch,
        onLoadRoot,
        onReadRootData
      }
    );

    act(() => {
      hook.result.current.rootSettings.onRootPathChange("/tmp/next-root");
    });
    await act(async () => {
      await hook.result.current.rootSettings.onApplyRootPath();
    });

    expect(onBeginRootSwitch.mock.invocationCallOrder[0]).toBeLessThan(
      onLoadRoot.mock.invocationCallOrder[0]
    );

    await act(async () => {
      await hook.result.current.rootSettings.onSaveSettings();
    });

    expect(onBeginRootSwitch.mock.invocationCallOrder[1]).toBeLessThan(
      onReadRootData.mock.invocationCallOrder[0]
    );
    expect(onFinishRootSwitch).toHaveBeenCalledWith(7);
  });

  test("revealRootDirectory 使用 committed rootPath 而不是 draft", async () => {
    const revealPathSpy = vi.spyOn(profileApi, "revealPath").mockResolvedValue();
    const hook = renderRootSettings();

    act(() => {
      hook.result.current.rootSettings.onRootPathChange("/tmp/draft-root");
    });
    await act(async () => {
      await hook.result.current.rootSettings.onRevealRootDirectory();
    });

    expect(revealPathSpy).toHaveBeenCalledWith("/tmp/committed-root");
    revealPathSpy.mockRestore();
  });

  test("返回值只暴露 App 需要的根设置同步接口", () => {
    const hook = renderRootSettings();

    expect(Object.keys(hook.result.current).sort()).toEqual([
      "chromeStatus",
      "resetDrafts",
      "rootSettings",
      "syncLoadedRoot",
      "syncPersistedSettings",
      "syncRestoredRoot",
      "themeDraft"
    ]);
  });
});
