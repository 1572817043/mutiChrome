import type {
  AccountPlatform,
  AirdropProject,
  AppTheme,
  ChromeProfile,
  ProfileDocument,
  ProfileSettings,
  ProjectUrl,
  UrlLibraryItem
} from "../types";

export const DEFAULT_BROWSER_PATH = "/Applications/Google Chrome.app";

export function normalizeProfileDocument(
  document: Partial<ProfileDocument> | undefined
): ProfileDocument {
  return {
    version: 1,
    settings: normalizeProfileSettings(document?.settings),
    profiles: normalizeProfiles(document?.profiles),
    projects: normalizeProjects(document?.projects)
  };
}

export function createEmptyProfileDocument(): ProfileDocument {
  return {
    version: 1,
    settings: normalizeProfileSettings(),
    profiles: [],
    projects: []
  };
}

export function normalizeProfileSettings(
  settings?: Partial<ProfileSettings>
): ProfileSettings {
  const favoriteUrls = normalizeUrlList(settings?.favoriteUrls, 20);
  const rawUrlLibrary = Array.isArray(settings?.urlLibrary) ? settings.urlLibrary : [];
  const urlLibrarySource =
    rawUrlLibrary.length > 0
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

export function normalizeBrowserPath(browserPath?: string): string {
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

function normalizeUrlLibrary(
  items: Partial<UrlLibraryItem>[] | undefined
): UrlLibraryItem[] {
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
      status:
        profile.status === "needs_check" || profile.status === "archived"
          ? profile.status
          : "active",
      accountPlatforms: normalizeAccountPlatforms(profile.accountPlatforms),
      accentColor: profile.accentColor,
      importSource: normalizeProfileImportSource(profile.importSource),
      createdAt: typeof profile.createdAt === "string" ? profile.createdAt : "",
      updatedAt: typeof profile.updatedAt === "string" ? profile.updatedAt : "",
      lastOpenedAt: typeof profile.lastOpenedAt === "string" ? profile.lastOpenedAt : null
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
        url:
          urls[0]?.url ??
          (typeof project.url === "string" ? normalizeStoredUrl(project.url) : ""),
        urls,
        notes: typeof project.notes === "string" ? project.notes : "",
        profileIds: Array.isArray(project.profileIds)
          ? [...new Set(project.profileIds.filter((id) => typeof id === "string" && id.trim()))]
          : [],
        intervalSeconds: normalizeProjectInterval(project.intervalSeconds),
        createdAt: typeof project.createdAt === "string" ? project.createdAt : "",
        updatedAt: typeof project.updatedAt === "string" ? project.updatedAt : "",
        lastOpenedAt: typeof project.lastOpenedAt === "string" ? project.lastOpenedAt : null
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
