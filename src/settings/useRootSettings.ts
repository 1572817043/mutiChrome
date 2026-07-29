import { useState } from "react";
import {
  normalizeSettings,
  profileApi,
  type ChromeStatus,
  type RootStatus
} from "../api";
import { errorMessage } from "../shared/windowAutomationErrors";
import type { ProfileDocument, ProfileSettings } from "../types";
import type { SettingsDialogRootSettingsProps } from "./SettingsDialog";

export interface RootSettingsLoadedData {
  status: RootStatus;
  document: ProfileDocument;
  settings: ProfileSettings;
  chrome: ChromeStatus;
}

interface UseRootSettingsOptions<TLoadedRoot extends RootSettingsLoadedData> {
  rootPath: string;
  settings: ProfileSettings;
  onLoadRoot: (path: string) => Promise<unknown>;
  onReadRootData: (path: string) => Promise<TLoadedRoot>;
  onCommitLoadedRoot: (path: string, loaded: TLoadedRoot) => Promise<void>;
  onPersistSettings: (settings: ProfileSettings) => Promise<void>;
  onMessage: (message: string) => void;
}

export function useRootSettings<TLoadedRoot extends RootSettingsLoadedData>({
  rootPath,
  settings,
  onLoadRoot,
  onReadRootData,
  onCommitLoadedRoot,
  onPersistSettings,
  onMessage
}: UseRootSettingsOptions<TLoadedRoot>) {
  const [rootPathDraft, setRootPathDraft] = useState(rootPath);
  const [rootStatus, setRootStatus] = useState<RootStatus | null>(null);
  const [chromeStatus, setChromeStatus] = useState<ChromeStatus | null>(null);
  const [browserPathDraft, setBrowserPathDraft] = useState(settings.browserPath);
  const [themeDraft, setThemeDraft] = useState(settings.theme);

  function resetDrafts() {
    setRootPathDraft(rootPath);
    setBrowserPathDraft(settings.browserPath);
    setThemeDraft(settings.theme);
  }

  function syncLoadedRoot(
    path: string,
    status: RootStatus,
    loadedSettings: ProfileSettings,
    chrome: ChromeStatus
  ) {
    setRootPathDraft(path);
    setRootStatus(status);
    setBrowserPathDraft(loadedSettings.browserPath);
    setThemeDraft(loadedSettings.theme);
    setChromeStatus(chrome);
  }

  function syncPersistedSettings(
    persistedSettings: ProfileSettings,
    profileCount: number
  ) {
    if (persistedSettings.browserPath !== settings.browserPath) {
      setBrowserPathDraft(persistedSettings.browserPath);
    }
    setRootStatus((current) =>
      current ? { ...current, profileCount } : current
    );
  }

  function syncRestoredRoot(
    status: RootStatus,
    restoredSettings: ProfileSettings,
    chrome: ChromeStatus
  ) {
    setRootStatus(status);
    setChromeStatus(chrome);
    setBrowserPathDraft(restoredSettings.browserPath);
    setThemeDraft(restoredSettings.theme);
  }

  async function applyRootPath() {
    const nextRootPath = rootPathDraft.trim();
    if (!nextRootPath) {
      onMessage("请先填写配置根目录");
      return;
    }

    try {
      await onLoadRoot(nextRootPath);
    } catch (error) {
      onMessage(errorMessage(error));
    }
  }

  async function saveSettingsDraft() {
    const nextRootPath = rootPathDraft.trim();
    if (!nextRootPath) {
      onMessage("请先填写配置根目录");
      return;
    }

    if (nextRootPath === rootPath) {
      const nextSettings = normalizeSettings({
        ...settings,
        browserPath: browserPathDraft,
        theme: themeDraft
      });
      try {
        await onPersistSettings(nextSettings);
        setBrowserPathDraft(nextSettings.browserPath);
        setThemeDraft(nextSettings.theme);
      } catch (error) {
        onMessage(errorMessage(error));
        return;
      }

      try {
        setChromeStatus(await profileApi.detectChrome(nextSettings.browserPath));
      } catch (error) {
        setChromeStatus(null);
        onMessage(errorMessage(error));
      }
      return;
    }

    try {
      const loaded = await onReadRootData(nextRootPath);
      const nextSettings = normalizeSettings({
        ...loaded.settings,
        browserPath: browserPathDraft,
        theme: themeDraft
      });
      const nextDocument = { ...loaded.document, settings: nextSettings };
      await profileApi.saveProfiles(nextRootPath, nextDocument);

      let chrome = loaded.chrome;
      let chromeDetectionError: unknown = null;
      try {
        chrome = await profileApi.detectChrome(nextSettings.browserPath);
      } catch (error) {
        chromeDetectionError = error;
      }

      await onCommitLoadedRoot(nextRootPath, {
        ...loaded,
        document: nextDocument,
        settings: nextSettings,
        chrome
      });
      if (chromeDetectionError) {
        setChromeStatus(null);
        onMessage(errorMessage(chromeDetectionError));
      }
    } catch (error) {
      onMessage(errorMessage(error));
    }
  }

  async function revealRootDirectory() {
    if (!rootPath.trim()) {
      onMessage("请先填写配置根目录");
      return;
    }

    try {
      await profileApi.revealPath(rootPath);
      onMessage("已打开数据目录");
    } catch (error) {
      onMessage(errorMessage(error));
    }
  }

  async function revealBackupsDirectory() {
    if (!rootPath.trim()) {
      onMessage("请先填写配置根目录");
      return;
    }

    try {
      await profileApi.revealProfileBackupsDir(rootPath);
      onMessage("已打开备份目录");
    } catch (error) {
      onMessage(errorMessage(error));
    }
  }

  const rootSettings: SettingsDialogRootSettingsProps = {
    rootPathDraft,
    rootStatus,
    chromeStatus,
    browserPathDraft,
    themeDraft,
    onRootPathChange: setRootPathDraft,
    onBrowserPathChange: setBrowserPathDraft,
    onThemeChange: setThemeDraft,
    onApplyRootPath: applyRootPath,
    onSaveSettings: saveSettingsDraft,
    onRevealRootDirectory: revealRootDirectory,
    onRevealBackupsDirectory: revealBackupsDirectory
  };

  return {
    rootSettings,
    chromeStatus,
    themeDraft,
    resetDrafts,
    syncLoadedRoot,
    syncPersistedSettings,
    syncRestoredRoot
  };
}
