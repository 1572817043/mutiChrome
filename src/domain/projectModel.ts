import type { AirdropProject, ProjectUrl } from "../types";
import { normalizeBulkOpenIntervalSeconds } from "../shared/formatHelpers";
import { displayUrlLabel, normalizeLaunchUrl } from "../shared/urlHelpers";

export function parseProjectUrlImportLines(value: string): ProjectUrl[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .reduce<ProjectUrl[]>((urls, line) => {
      const parsed = parseProjectUrlImportLine(line, urls.length);
      return parsed ? [...urls, parsed] : urls;
    }, []);
}

function parseProjectUrlImportLine(line: string, index: number): ProjectUrl | null {
  const urlMatch = line.match(
    /https?:\/\/[^\s]+|(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}(?:\/[^\s]*)?/i
  );
  if (!urlMatch || urlMatch.index === undefined) {
    return null;
  }

  const rawUrl = trimImportedUrl(urlMatch[0]);
  const url = normalizeLaunchUrl(rawUrl);
  if (!url) {
    return null;
  }

  const beforeUrl = line.slice(0, urlMatch.index).trim();
  const afterUrl = line.slice(urlMatch.index + urlMatch[0].length).trim();
  const notes = afterUrl.replace(/^[-:：,，\s]+/, "").trim();

  return {
    id: `url-${String(index + 1).padStart(3, "0")}`,
    name: beforeUrl || displayUrlLabel(url),
    url,
    notes
  };
}

function trimImportedUrl(value: string): string {
  return value.trim().replace(/[),，。；;、]+$/g, "");
}

export function projectDisplayUrls(project: AirdropProject): ProjectUrl[] {
  return normalizeProjectUrlsForStorage(project.urls).filter((projectUrl) => projectUrl.url);
}

export function projectEditableUrls(project: AirdropProject): ProjectUrl[] {
  const urls = cleanEditableProjectUrls(project.urls);
  if (urls.length > 0) {
    return urls;
  }

  const legacyUrl = normalizeLaunchUrl(project.url);
  return [
    {
      id: "url-001",
      name: "主入口",
      url: legacyUrl,
      notes: ""
    }
  ];
}

export function projectOpenUrls(project: AirdropProject): ProjectUrl[] {
  const urls = projectDisplayUrls(project);
  if (urls.length > 0) {
    return urls;
  }

  const legacyUrl = normalizeLaunchUrl(project.url);
  return legacyUrl
    ? [
        {
          id: "url-001",
          name: "主入口",
          url: legacyUrl,
          notes: ""
        }
      ]
    : [];
}

export function normalizeEditableProjectUrls(
  urls: ProjectUrl[] | undefined
): ProjectUrl[] {
  return normalizeProjectUrlsForStorage(urls);
}

export function cleanEditableProjectUrls(
  urls: ProjectUrl[] | undefined
): ProjectUrl[] {
  if (!Array.isArray(urls)) {
    return [];
  }

  const seen = new Set<string>();
  return urls
    .filter((projectUrl) => projectUrl && typeof projectUrl.id === "string")
    .map((projectUrl, index) => {
      const id = uniqueProjectUrlId(projectUrl.id, index, seen);
      return {
        id,
        name: typeof projectUrl.name === "string" ? projectUrl.name : `网址 ${index + 1}`,
        url: typeof projectUrl.url === "string" ? projectUrl.url : "",
        notes: typeof projectUrl.notes === "string" ? projectUrl.notes : ""
      };
    });
}

function normalizeProjectUrlsForStorage(urls: ProjectUrl[] | undefined): ProjectUrl[] {
  return cleanEditableProjectUrls(urls).map((projectUrl, index) => ({
    ...projectUrl,
    name: projectUrl.name.trim() || `网址 ${index + 1}`,
    url: normalizeLaunchUrl(projectUrl.url),
    notes: projectUrl.notes.trim()
  }));
}

export function createProjectUrl(
  existingUrls: ProjectUrl[],
  overrides: Partial<ProjectUrl> = {}
): ProjectUrl {
  const id = overrides.id ?? nextProjectUrlId(existingUrls);
  const index = existingUrls.length + 1;
  return {
    id,
    name: overrides.name ?? `网址 ${index}`,
    url: overrides.url ?? "",
    notes: overrides.notes ?? ""
  };
}

function nextProjectUrlId(urls: ProjectUrl[]): string {
  const used = new Set(urls.map((projectUrl) => projectUrl.id));
  for (let index = 1; index < 10000; index += 1) {
    const id = `url-${String(index).padStart(3, "0")}`;
    if (!used.has(id)) {
      return id;
    }
  }

  return `url-${Date.now()}`;
}

function uniqueProjectUrlId(id: string, index: number, seen: Set<string>): string {
  const cleanedId = id.trim();
  const fallback = `url-${String(index + 1).padStart(3, "0")}`;
  let nextId = cleanedId || fallback;
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

export function primaryProjectUrl(urls: ProjectUrl[]): string {
  return cleanEditableProjectUrls(urls).find((projectUrl) => projectUrl.url.trim())?.url ?? "";
}

export function cloneProjectForDraft(project: AirdropProject): AirdropProject {
  return {
    ...project,
    urls: projectEditableUrls(project).map((projectUrl) => ({ ...projectUrl })),
    profileIds: [...project.profileIds]
  };
}

export function createProject(
  existingProjects: AirdropProject[],
  initialProfileIds: string[],
  now: string
): AirdropProject {
  const id = nextProjectId(existingProjects);
  return {
    id,
    name: `项目 ${existingProjects.length + 1}`,
    url: "",
    urls: [createProjectUrl([], { id: "url-001", name: "主入口" })],
    notes: "",
    profileIds: [...new Set(initialProfileIds)],
    intervalSeconds: normalizeBulkOpenIntervalSeconds("3"),
    createdAt: now,
    updatedAt: now,
    lastOpenedAt: null
  };
}

export function updateProject(
  project: AirdropProject,
  patch: Partial<AirdropProject>,
  now: string
): AirdropProject {
  const nextUrls = Array.isArray(patch.urls)
    ? cleanEditableProjectUrls(patch.urls)
    : typeof patch.url === "string"
      ? updatePrimaryProjectUrl(projectEditableUrls(project), patch.url)
      : projectEditableUrls(project);
  const nextUrl =
    typeof patch.url === "string" && !Array.isArray(patch.urls)
      ? normalizeLaunchUrl(patch.url)
      : primaryProjectUrl(nextUrls);

  return {
    ...project,
    ...patch,
    name: typeof patch.name === "string" ? patch.name : project.name,
    url: nextUrl,
    urls: nextUrls,
    notes: typeof patch.notes === "string" ? patch.notes : project.notes,
    profileIds: Array.isArray(patch.profileIds)
      ? [...new Set(patch.profileIds)]
      : project.profileIds,
    intervalSeconds:
      typeof patch.intervalSeconds === "number"
        ? normalizeBulkOpenIntervalSeconds(String(patch.intervalSeconds))
        : project.intervalSeconds,
    updatedAt: now
  };
}

export function duplicateProject(
  source: AirdropProject,
  existingProjects: AirdropProject[],
  now: string
): AirdropProject {
  return {
    ...source,
    id: nextProjectId(existingProjects),
    name: `${source.name} 副本`,
    profileIds: [...source.profileIds],
    createdAt: now,
    updatedAt: now,
    lastOpenedAt: null
  };
}

function updatePrimaryProjectUrl(urls: ProjectUrl[], url: string): ProjectUrl[] {
  const safeUrls =
    urls.length > 0 ? urls : [createProjectUrl([], { id: "url-001", name: "主入口" })];
  return safeUrls.map((projectUrl, index) =>
    index === 0 ? { ...projectUrl, url } : projectUrl
  );
}

function nextProjectId(projects: AirdropProject[]): string {
  const used = new Set(projects.map((project) => project.id));
  for (let index = 1; index < 10000; index += 1) {
    const id = `project-${String(index).padStart(3, "0")}`;
    if (!used.has(id)) {
      return id;
    }
  }
  return `project-${Date.now()}`;
}
