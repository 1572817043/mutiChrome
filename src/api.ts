import { invoke } from "@tauri-apps/api/core";
import {
  normalizeBrowserLaunchEvents,
  type BrowserLaunchEvent
} from "./browserSessionLaunch";
import type {
  AccountPlatform,
  AirdropProject,
  AppTheme,
  ChromeProfile,
  FullProfileBackupPreview,
  FullProfileBackupResult,
  FullProfileRestorePreview,
  ProfileBackupResult,
  ProfileDocument,
  ProfileImportCandidate,
  ProfileMarker,
  ProjectUrl,
  ProfileSettings,
  RootHealthReport,
  RootRepairResult,
  UrlLibraryItem
} from "./types";

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
export const DEFAULT_BROWSER_PATH = "/Applications/Google Chrome.app";

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

    const document = normalizeDocument(JSON.parse(raw) as ProfileDocument);
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
      ? normalizeDocument(JSON.parse(raw) as ProfileDocument)
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
      ? normalizeDocument(JSON.parse(raw) as ProfileDocument)
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
    return emptyDocument();
  }

  try {
    const parsed = JSON.parse(raw) as ProfileDocument;
    return normalizeDocument(parsed);
  } catch {
    return emptyDocument();
  }
}

function normalizeDocument(document: ProfileDocument): ProfileDocument {
  return {
    version: 1,
    settings: normalizeSettings(document.settings),
    profiles: normalizeProfiles(document.profiles),
    projects: normalizeProjects(document.projects)
  };
}

function emptyDocument(): ProfileDocument {
  return {
    version: 1,
    settings: normalizeSettings(),
    profiles: [],
    projects: []
  };
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

export function normalizeSettings(settings?: Partial<ProfileSettings>): ProfileSettings {
  const favoriteUrls = normalizeUrlList(settings?.favoriteUrls, 20);
  const rawUrlLibrary = Array.isArray(settings?.urlLibrary) ? settings.urlLibrary : [];
  const urlLibrarySource = rawUrlLibrary.length > 0
    ? rawUrlLibrary
    : favoriteUrls.map((url, index) => createUrlLibraryItemFromUrl(url, index));
  const urlLibrary = normalizeUrlLibrary(urlLibrarySource);

  return {
    browserPath: normalizeBrowserPath(settings?.browserPath),
    favoriteUrls: normalizeUrlList(urlLibrary.map((item) => item.url), 20),
    recentUrls: normalizeUrlList(settings?.recentUrls, 10),
    urlLibrary,
    theme: normalizeTheme(settings?.theme)
  };
}

function normalizeBrowserPath(browserPath?: string): string {
  const cleaned = browserPath?.trim() ?? "";
  return cleaned || DEFAULT_BROWSER_PATH;
}

function normalizeUrlList(urls: string[] | undefined, limit: number): string[] {
  if (!Array.isArray(urls)) {
    return [];
  }

  const normalized = urls
    .map((url) => normalizeStoredUrl(url))
    .filter(Boolean);
  const seen = new Set<string>();
  const result: string[] = [];

  for (const url of normalized) {
    if (seen.has(url)) {
      continue;
    }

    seen.add(url);
    result.push(url);
    if (result.length >= limit) {
      break;
    }
  }

  return result;
}

function normalizeStoredUrl(url: string): string {
  const cleaned = url.trim();
  if (!cleaned) {
    return "";
  }
  if (/^https?:\/\//i.test(cleaned)) {
    return cleaned;
  }
  return `https://${cleaned}`;
}

function normalizeUrlLibrary(items: Partial<UrlLibraryItem>[] | undefined): UrlLibraryItem[] {
  if (!Array.isArray(items)) {
    return [];
  }

  const seenUrls = new Set<string>();
  const seenIds = new Set<string>();
  const result: UrlLibraryItem[] = [];

  for (const [index, item] of items.entries()) {
    const url = normalizeStoredUrl(typeof item.url === "string" ? item.url : "");
    if (!url || seenUrls.has(url)) {
      continue;
    }

    const fallbackId = `url-${String(index + 1).padStart(3, "0")}`;
    const id = uniqueUrlLibraryId(
      typeof item.id === "string" && item.id.trim() ? item.id.trim() : fallbackId,
      seenIds
    );
    const name =
      typeof item.name === "string" && item.name.trim()
        ? item.name.trim()
        : displayStoredUrlLabel(url);
    const tags = Array.isArray(item.tags)
      ? [...new Set(item.tags.map((tag) => tag.trim()).filter(Boolean))]
      : [];
    const createdAt = typeof item.createdAt === "string" ? item.createdAt : "";
    const updatedAt = typeof item.updatedAt === "string" ? item.updatedAt : createdAt;

    seenUrls.add(url);
    result.push({
      id,
      name,
      url,
      tags,
      notes: typeof item.notes === "string" ? item.notes : "",
      createdAt,
      updatedAt
    });
  }

  return result;
}

function createUrlLibraryItemFromUrl(url: string, index: number): UrlLibraryItem {
  return {
    id: `url-${String(index + 1).padStart(3, "0")}`,
    name: displayStoredUrlLabel(url),
    url,
    tags: [],
    notes: "",
    createdAt: "",
    updatedAt: ""
  };
}

function uniqueUrlLibraryId(baseId: string, seenIds: Set<string>): string {
  if (!seenIds.has(baseId)) {
    seenIds.add(baseId);
    return baseId;
  }

  let suffix = 2;
  let id = `${baseId}-${suffix}`;
  while (seenIds.has(id)) {
    suffix += 1;
    id = `${baseId}-${suffix}`;
  }
  seenIds.add(id);
  return id;
}

function displayStoredUrlLabel(url: string): string {
  try {
    const parsed = new URL(url);
    const path = `${parsed.pathname}${parsed.search}`.replace(/\/$/, "");
    return `${parsed.host}${path}`;
  } catch {
    return url.replace(/^https?:\/\//i, "");
  }
}

function normalizeTheme(theme?: AppTheme): AppTheme {
  return theme === "dark" ? "dark" : "light";
}

function normalizeProfiles(profiles: ChromeProfile[] | undefined): ChromeProfile[] {
  if (!Array.isArray(profiles)) {
    return [];
  }

  return profiles
    .filter((profile) => profile && typeof profile.id === "string")
    .map((profile) => ({
      id: profile.id,
      name: typeof profile.name === "string" && profile.name.trim() ? profile.name : profile.id,
      tags: Array.isArray(profile.tags)
        ? profile.tags.filter((tag) => typeof tag === "string" && tag.trim())
        : [],
      notes: typeof profile.notes === "string" ? profile.notes : "",
      status: profile.status === "needs_check" || profile.status === "archived" ? profile.status : "active",
      accountPlatforms: normalizeAccountPlatforms(profile.accountPlatforms),
      accentColor: profile.accentColor,
      importSource: normalizeProfileImportSource(profile.importSource),
      createdAt: typeof profile.createdAt === "string" ? profile.createdAt : "",
      updatedAt: typeof profile.updatedAt === "string" ? profile.updatedAt : "",
      lastOpenedAt:
        typeof profile.lastOpenedAt === "string" ? profile.lastOpenedAt : null
    }));
}

function normalizeAccountPlatforms(
  accountPlatforms: AccountPlatform[] | undefined
): AccountPlatform[] {
  if (!Array.isArray(accountPlatforms)) {
    return [];
  }

  return accountPlatforms
    .filter((accountPlatform) => accountPlatform && typeof accountPlatform.id === "string")
    .map((accountPlatform) => ({
      id: accountPlatform.id,
      platform:
        typeof accountPlatform.platform === "string" ? accountPlatform.platform.trim() : "",
      loginUrl:
        typeof accountPlatform.loginUrl === "string"
          ? normalizeStoredUrl(accountPlatform.loginUrl)
          : "",
      username:
        typeof accountPlatform.username === "string" ? accountPlatform.username.trim() : "",
      notes: typeof accountPlatform.notes === "string" ? accountPlatform.notes.trim() : ""
    }));
}

function normalizeProfileImportSource(
  importSource: ChromeProfile["importSource"] | undefined
): ChromeProfile["importSource"] | undefined {
  if (!importSource) {
    return undefined;
  }

  const profileUid =
    typeof importSource.profileUid === "string" ? importSource.profileUid.trim() : "";
  const sourcePath =
    typeof importSource.sourcePath === "string" ? importSource.sourcePath.trim() : "";
  const sourceFolderName =
    typeof importSource.sourceFolderName === "string"
      ? importSource.sourceFolderName.trim()
      : "";
  const importedAt =
    typeof importSource.importedAt === "string" ? importSource.importedAt.trim() : "";
  if (!profileUid || !sourcePath || !sourceFolderName || !importedAt) {
    return undefined;
  }

  return {
    profileUid,
    sourcePath,
    sourceFolderName,
    importedAt
  };
}

function normalizeProjects(projects: AirdropProject[] | undefined): AirdropProject[] {
  if (!Array.isArray(projects)) {
    return [];
  }

  return projects
    .filter((project) => project && typeof project.id === "string")
    .map((project) => {
      const urls = normalizeProjectUrls(project.urls, project.url);
      return {
        id: project.id,
        name:
          typeof project.name === "string" && project.name.trim()
            ? project.name
            : project.id,
        url: urls[0]?.url ?? (typeof project.url === "string" ? normalizeStoredUrl(project.url) : ""),
        urls,
        notes: typeof project.notes === "string" ? project.notes : "",
        profileIds: Array.isArray(project.profileIds)
          ? [...new Set(project.profileIds.filter((id) => typeof id === "string" && id.trim()))]
          : [],
        intervalSeconds: normalizeProjectInterval(project.intervalSeconds),
        createdAt: typeof project.createdAt === "string" ? project.createdAt : "",
        updatedAt: typeof project.updatedAt === "string" ? project.updatedAt : "",
        lastOpenedAt:
          typeof project.lastOpenedAt === "string" ? project.lastOpenedAt : null
      };
    });
}

function normalizeProjectUrls(
  urls: ProjectUrl[] | undefined,
  fallbackUrl: string | undefined
): ProjectUrl[] {
  if (!Array.isArray(urls) || urls.length === 0) {
    const normalizedFallback =
      typeof fallbackUrl === "string" ? normalizeStoredUrl(fallbackUrl) : "";
    return normalizedFallback
      ? [
          {
            id: "url-001",
            name: "主入口",
            url: normalizedFallback,
            notes: ""
          }
        ]
      : [];
  }

  const seen = new Set<string>();
  return urls
    .filter((projectUrl) => projectUrl && typeof projectUrl.id === "string")
    .map((projectUrl, index) => {
      const normalizedUrl =
        typeof projectUrl.url === "string" ? normalizeStoredUrl(projectUrl.url) : "";
      const id = uniqueProjectUrlId(projectUrl.id, index, seen);
      return {
        id,
        name:
          typeof projectUrl.name === "string" && projectUrl.name.trim()
            ? projectUrl.name.trim()
            : `网址 ${index + 1}`,
        url: normalizedUrl,
        notes: typeof projectUrl.notes === "string" ? projectUrl.notes.trim() : ""
      };
    });
}

function uniqueProjectUrlId(id: string, index: number, seen: Set<string>): string {
  const fallback = `url-${String(index + 1).padStart(3, "0")}`;
  let nextId = id.trim() || fallback;
  if (!seen.has(nextId)) {
    seen.add(nextId);
    return nextId;
  }

  for (let offset = index + 1; offset < 10000; offset += 1) {
    nextId = `url-${String(offset).padStart(3, "0")}`;
    if (!seen.has(nextId)) {
      seen.add(nextId);
      return nextId;
    }
  }

  nextId = `url-${Date.now()}`;
  seen.add(nextId);
  return nextId;
}

function normalizeProjectInterval(value: number): number {
  if (!Number.isFinite(value)) {
    return 3;
  }
  return Math.min(60, Math.max(1, Math.round(value)));
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
