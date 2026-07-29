import { invoke } from "@tauri-apps/api/core";
import {
  normalizeBrowserLaunchEvents,
  type BrowserLaunchEvent
} from "./browserSessionLaunch";
import {
  createEmptyProfileDocument,
  normalizeBrowserPath,
  normalizeProfileDocument
} from "./domain/profileDocumentModel";
import type {
  FullProfileBackupPreview,
  FullProfileBackupResult,
  FullProfileRestorePreview,
  ProfileBackupResult,
  ProfileDocument,
  ProfileImportCandidate,
  ProfileMarker,
  RootHealthReport,
  RootRepairResult
} from "./types";

export {
  DEFAULT_BROWSER_PATH,
  normalizeProfileSettings as normalizeSettings
} from "./domain/profileDocumentModel";

export interface RootStatus {
  rootExists: boolean;
  writable: boolean;
  profileCount: number;
}

export interface ChromeStatus {
  available: boolean;
  appPath: string | null;
}

export interface ChromeWindowInfo {
  index: number;
  title: string;
  x: number;
  y: number;
  width: number;
  height: number;
  minimized?: boolean;
}

export interface WindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type BrowserSessionStatus = "starting" | "running" | "stopped";
export type BrowserSessionCdpStatus =
  | "unknown"
  | "available"
  | "missing-port"
  | "failed";

export interface BrowserSessionSnapshot {
  profileId: string;
  status: BrowserSessionStatus;
  running: boolean;
  pid: number | null;
  debugPort: number | null;
  cdpStatus: BrowserSessionCdpStatus;
  runtimeError: string | null;
  windowCount: number | null;
  windows: ChromeWindowInfo[];
  windowError: string | null;
  checkedAt: number;
}

export interface BrowserRuntimeTabSnapshot {
  targetId: string;
  type: "page";
  url: string;
  title: string;
  webSocketDebuggerUrl: string | null;
  checkedAt: number;
}

export interface BrowserRuntimeNavigationResult {
  profileId: string;
  targetId: string;
  url: string;
  navigatedAt: number;
}

const ROOT_KEY = "multichrome.rootPath";
const DOCUMENT_KEY = "multichrome.profileDocument";
const BACKUP_PREFIX = "multichrome.profileBackup.";
const LAUNCH_EVENTS_PREFIX = "multichrome.browserLaunchEvents.";

function isTauriRuntime(): boolean {
  return (
    typeof window !== "undefined" &&
    "__TAURI_INTERNALS__" in (window as Window & { __TAURI_INTERNALS__?: unknown })
  );
}

export function profilePath(rootPath: string, profileId: string): string {
  return `${rootPath.replace(/\/$/, "")}/profiles/${profileId}`;
}

export const profileApi = {
  async defaultRootPath(): Promise<string> {
    if (isTauriRuntime()) {
      return invoke<string>("default_root_path");
    }

    return localStorage.getItem(ROOT_KEY) ?? "~/MultiChromeProfiles";
  },

  async initProfileRoot(rootPath: string): Promise<RootStatus> {
    if (isTauriRuntime()) {
      return invoke<RootStatus>("init_profile_root", { rootPath });
    }

    localStorage.setItem(ROOT_KEY, rootPath);
    const document = loadBrowserDocument();
    return {
      rootExists: true,
      writable: true,
      profileCount: document.profiles.length
    };
  },

  async checkProfileRootHealth(rootPath: string): Promise<RootHealthReport> {
    if (isTauriRuntime()) {
      return invoke<RootHealthReport>("check_profile_root_health", { rootPath });
    }

    const document = loadBrowserDocument();
    return {
      rootPath,
      summary: {
        profileCount: document.profiles.length,
        warningCount: 0,
        errorCount: 0
      },
      issues: []
    };
  },

  async repairProfileRootHealth(rootPath: string): Promise<RootRepairResult> {
    if (isTauriRuntime()) {
      return invoke<RootRepairResult>("repair_profile_root_health", { rootPath });
    }

    const document = loadBrowserDocument();
    return {
      repairedCount: 0,
      actions: [],
      health: {
        rootPath,
        summary: {
          profileCount: document.profiles.length,
          warningCount: 0,
          errorCount: 0
        },
        issues: []
      }
    };
  },

  async createProfilesBackup(rootPath: string): Promise<ProfileBackupResult> {
    if (isTauriRuntime()) {
      return invoke<ProfileBackupResult>("create_profiles_backup", { rootPath });
    }

    const document = loadBrowserDocument();
    const path = `browser-preview://profiles-${Date.now()}.json`;
    localStorage.setItem(`${BACKUP_PREFIX}${path}`, JSON.stringify(document));
    return {
      path,
      profileCount: document.profiles.length
    };
  },

  async restoreProfilesBackup(
    rootPath: string,
    backupPath: string
  ): Promise<ProfileDocument> {
    if (isTauriRuntime()) {
      return invoke<ProfileDocument>("restore_profiles_backup", {
        rootPath,
        backupPath
      });
    }

    const raw = localStorage.getItem(`${BACKUP_PREFIX}${backupPath}`);
    if (!raw) {
      throw new Error("未找到浏览器预览备份");
    }

    const document = normalizeProfileDocument(JSON.parse(raw) as ProfileDocument);
    localStorage.setItem(ROOT_KEY, rootPath);
    localStorage.setItem(DOCUMENT_KEY, JSON.stringify(document));
    return document;
  },

  async previewFullProfileBackup(
    rootPath: string,
    profileIds: string[]
  ): Promise<FullProfileBackupPreview> {
    if (isTauriRuntime()) {
      return invoke<FullProfileBackupPreview>("preview_full_profiles_backup", {
        rootPath,
        profileIds
      });
    }

    const document = loadBrowserDocument();
    const selectedIds = selectBrowserProfileIds(document, profileIds);
    return {
      destinationDir: `${rootPath.replace(/\/$/, "")}/app-data/backups`,
      profileCount: selectedIds.length,
      profileIds: selectedIds,
      totalBytes: 0
    };
  },

  async createFullProfileBackup(
    rootPath: string,
    profileIds: string[]
  ): Promise<FullProfileBackupResult> {
    if (isTauriRuntime()) {
      return invoke<FullProfileBackupResult>("create_full_profiles_backup", {
        rootPath,
        profileIds
      });
    }

    const document = loadBrowserDocument();
    const selectedIds = selectBrowserProfileIds(document, profileIds);
    const path = `browser-preview://full-profiles-${Date.now()}`;
    localStorage.setItem(
      `${BACKUP_PREFIX}${path}`,
      JSON.stringify(filterBrowserDocumentForProfiles(document, selectedIds))
    );
    return {
      path,
      profileCount: selectedIds.length,
      profileIds: selectedIds,
      totalBytes: 0
    };
  },

  async previewFullProfileRestore(
    rootPath: string,
    backupPath: string
  ): Promise<FullProfileRestorePreview> {
    if (isTauriRuntime()) {
      return invoke<FullProfileRestorePreview>("preview_full_profiles_restore", {
        rootPath,
        backupPath
      });
    }

    const raw = localStorage.getItem(`${BACKUP_PREFIX}${backupPath}`);
    const document = raw
      ? normalizeProfileDocument(JSON.parse(raw) as ProfileDocument)
      : loadBrowserDocument();
    const currentIds = new Set(loadBrowserDocument().profiles.map((profile) => profile.id));
    const profileIds = document.profiles.map((profile) => profile.id);
    return {
      path: backupPath,
      profileCount: document.profiles.length,
      profileIds,
      newProfileIds: profileIds.filter((profileId) => !currentIds.has(profileId)),
      overwriteProfileIds: profileIds.filter((profileId) => currentIds.has(profileId)),
      totalBytes: 0
    };
  },

  async restoreFullProfileBackup(
    rootPath: string,
    backupPath: string,
    overwriteExisting: boolean
  ): Promise<ProfileDocument> {
    if (isTauriRuntime()) {
      return invoke<ProfileDocument>("restore_full_profiles_backup", {
        rootPath,
        backupPath,
        overwriteExisting
      });
    }

    const raw = localStorage.getItem(`${BACKUP_PREFIX}${backupPath}`);
    const document = raw
      ? normalizeProfileDocument(JSON.parse(raw) as ProfileDocument)
      : loadBrowserDocument();
    localStorage.setItem(ROOT_KEY, rootPath);
    localStorage.setItem(DOCUMENT_KEY, JSON.stringify(document));
    return document;
  },

  async loadProfiles(rootPath: string): Promise<ProfileDocument> {
    if (isTauriRuntime()) {
      return invoke<ProfileDocument>("load_profiles", { rootPath });
    }

    return loadBrowserDocument();
  },

  async saveProfiles(
    rootPath: string,
    document: ProfileDocument
  ): Promise<void> {
    if (isTauriRuntime()) {
      return invoke<void>("save_profiles", { rootPath, document });
    }

    localStorage.setItem(ROOT_KEY, rootPath);
    localStorage.setItem(DOCUMENT_KEY, JSON.stringify(document));
  },

  async loadBrowserLaunchEvents(rootPath: string): Promise<BrowserLaunchEvent[]> {
    if (isTauriRuntime()) {
      const events = await invoke<BrowserLaunchEvent[]>("load_browser_launch_events", {
        rootPath
      });
      return normalizeBrowserLaunchEvents(events);
    }

    const raw = localStorage.getItem(launchEventsStorageKey(rootPath));
    if (!raw) {
      return [];
    }

    try {
      return normalizeBrowserLaunchEvents(JSON.parse(raw));
    } catch {
      return [];
    }
  },

  async saveBrowserLaunchEvents(
    rootPath: string,
    events: BrowserLaunchEvent[]
  ): Promise<void> {
    const normalizedEvents = normalizeBrowserLaunchEvents(events);
    if (isTauriRuntime()) {
      return invoke<void>("save_browser_launch_events", {
        rootPath,
        events: normalizedEvents
      });
    }

    localStorage.setItem(
      launchEventsStorageKey(rootPath),
      JSON.stringify(normalizedEvents)
    );
  },

  async detectChrome(browserPath?: string): Promise<ChromeStatus> {
    if (isTauriRuntime()) {
      return invoke<ChromeStatus>("detect_chrome", { browserPath });
    }

    const appPath = normalizeBrowserPath(browserPath);
    return {
      available: Boolean(appPath),
      appPath
    };
  },

  async profileDirectorySize(path: string): Promise<number> {
    if (isTauriRuntime()) {
      return invoke<number>("profile_directory_size", { path });
    }

    return 0;
  },

  async openProfile(
    rootPath: string,
    profileId: string,
    browserPath?: string,
    launchUrl?: string
  ): Promise<string> {
    if (isTauriRuntime()) {
      return invoke<string>("open_profile", {
        rootPath,
        profileId,
        browserPath,
        launchUrl
      });
    }

    return profilePath(rootPath, profileId);
  },

  async listRunningProfiles(rootPath: string): Promise<string[]> {
    if (isTauriRuntime()) {
      return invoke<string[]>("list_running_profiles", { rootPath });
    }

    return [];
  },

  async snapshotBrowserSessions(
    rootPath: string,
    profileIds: string[],
    includeWindows = false
  ): Promise<BrowserSessionSnapshot[]> {
    if (isTauriRuntime()) {
      return invoke<BrowserSessionSnapshot[]>("snapshot_browser_sessions", {
        rootPath,
        profileIds,
        includeWindows
      });
    }

    const runningIds = await profileApi.listRunningProfiles(rootPath);
    const runningIdSet = new Set(runningIds);
    const checkedAt = Date.now();
    return profileIds.map((profileId) => ({
      profileId,
      status: runningIdSet.has(profileId) ? "running" : "stopped",
      running: runningIdSet.has(profileId),
      pid: null,
      debugPort: null,
      cdpStatus: "unknown",
      runtimeError: null,
      windowCount: runningIdSet.has(profileId) ? null : 0,
      windows: [],
      windowError: null,
      checkedAt
    }));
  },

  async listRuntimeTabs(
    rootPath: string,
    profileId: string
  ): Promise<BrowserRuntimeTabSnapshot[]> {
    if (isTauriRuntime()) {
      return invoke<BrowserRuntimeTabSnapshot[]>("list_runtime_tabs", {
        rootPath,
        profileId
      });
    }

    return [];
  },

  async navigateRuntimeTab(
    rootPath: string,
    profileId: string,
    url: string
  ): Promise<BrowserRuntimeNavigationResult> {
    if (isTauriRuntime()) {
      return invoke<BrowserRuntimeNavigationResult>("navigate_runtime_tab", {
        rootPath,
        profileId,
        url
      });
    }

    throw new Error("Browser Runtime 仅在桌面应用中可用");
  },

  async focusProfileWindow(rootPath: string, profileId: string): Promise<void> {
    if (isTauriRuntime()) {
      return invoke<void>("focus_profile_window", { rootPath, profileId });
    }
  },

  async listProfileWindows(
    rootPath: string,
    profileId: string
  ): Promise<ChromeWindowInfo[]> {
    if (isTauriRuntime()) {
      return invoke<ChromeWindowInfo[]>("list_profile_windows", { rootPath, profileId });
    }

    return [];
  },

  async setProfileWindowBounds(
    rootPath: string,
    profileId: string,
    bounds: WindowBounds
  ): Promise<void> {
    if (isTauriRuntime()) {
      return invoke<void>("set_profile_window_bounds", {
        rootPath,
        profileId,
        ...bounds
      });
    }
  },

  async deleteProfileData(rootPath: string, profileId: string): Promise<void> {
    if (isTauriRuntime()) {
      return invoke<void>("delete_profile_data", { rootPath, profileId });
    }
  },

  async copyProfileData(
    rootPath: string,
    sourceProfileId: string,
    targetProfileId: string
  ): Promise<void> {
    if (isTauriRuntime()) {
      return invoke<void>("copy_profile_data", {
        rootPath,
        sourceProfileId,
        targetProfileId
      });
    }
  },

  async importProfileData(
    rootPath: string,
    sourcePath: string,
    targetProfileId: string,
    marker?: ProfileMarker
  ): Promise<void> {
    if (isTauriRuntime()) {
      return invoke<void>("import_profile_data", {
        rootPath,
        sourcePath,
        targetProfileId,
        marker
      });
    }
  },

  async scanProfileImportCandidates(
    rootPath: string,
    sourcePath: string
  ): Promise<ProfileImportCandidate[]> {
    if (isTauriRuntime()) {
      return invoke<ProfileImportCandidate[]>("scan_profile_import_candidates", {
        rootPath,
        sourcePath
      });
    }

    return [];
  },

  async revealPath(path: string): Promise<void> {
    if (isTauriRuntime()) {
      return invoke<void>("reveal_path", { path });
    }

    console.info("浏览器预览模式不能打开本地目录：", path);
  },

  async revealProfileBackupsDir(rootPath: string): Promise<string> {
    if (isTauriRuntime()) {
      return invoke<string>("reveal_profile_backups_dir", { rootPath });
    }

    const path = `${rootPath.replace(/\/$/, "")}/app-data/backups`;
    console.info("浏览器预览模式不能打开备份目录：", path);
    return path;
  }
};

function launchEventsStorageKey(rootPath: string): string {
  return `${LAUNCH_EVENTS_PREFIX}${rootPath}`;
}

function loadBrowserDocument(): ProfileDocument {
  const raw = localStorage.getItem(DOCUMENT_KEY);
  if (!raw) {
    return createEmptyProfileDocument();
  }

  try {
    const parsed = JSON.parse(raw) as ProfileDocument;
    return normalizeProfileDocument(parsed);
  } catch {
    return createEmptyProfileDocument();
  }
}

function selectBrowserProfileIds(document: ProfileDocument, profileIds: string[]): string[] {
  const cleanedIds = profileIds.map((profileId) => profileId.trim()).filter(Boolean);
  if (cleanedIds.length === 0) {
    return document.profiles.map((profile) => profile.id);
  }

  const requestedIds = new Set(cleanedIds);
  return document.profiles
    .filter((profile) => requestedIds.has(profile.id))
    .map((profile) => profile.id);
}

function filterBrowserDocumentForProfiles(
  document: ProfileDocument,
  profileIds: string[]
): ProfileDocument {
  const selectedIds = new Set(profileIds);
  return {
    ...document,
    profiles: document.profiles.filter((profile) => selectedIds.has(profile.id)),
    projects: document.projects.map((project) => ({
      ...project,
      profileIds: project.profileIds.filter((profileId) => selectedIds.has(profileId))
    }))
  };
}

export function formatBytes(bytes: number | null): string {
  if (bytes === null) {
    return "未检测";
  }

  if (bytes < 1024) {
    return `${bytes} B`;
  }

  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value.toFixed(value >= 10 ? 1 : 2)} ${units[unitIndex]}`;
}
