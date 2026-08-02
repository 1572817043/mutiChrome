import type {
  AirdropProject,
  ChromeProfile,
  ProfileDocument,
  ProfileImportCandidate,
  ProfileMarker,
  ProfileSettings,
  UrlLibraryItem
} from "../types";
import { createProfile, nextProfileId } from "./profileModel";

export function buildImportedProfilePlan({
  candidate,
  existingProfiles,
  profileUid,
  importedAt
}: {
  candidate: ProfileImportCandidate;
  existingProfiles: ChromeProfile[];
  profileUid: string;
  importedAt: string;
}): { profile: ChromeProfile; marker: ProfileMarker } {
  const profile = createProfile(
    {
      name: candidate.suggestedName,
      tags: candidate.suggestedTags,
      notes: candidate.suggestedNotes.trim() || `来源：${candidate.path}`,
      importSource: {
        profileUid,
        sourcePath: candidate.path,
        sourceFolderName: candidate.folderName,
        importedAt
      }
    },
    existingProfiles,
    importedAt
  );
  const marker: ProfileMarker = {
    schemaVersion: 1,
    app: "MultiChrome",
    profileUid,
    profileId: profile.id,
    name: profile.name,
    sourcePath: candidate.path,
    sourceFolderName: candidate.folderName,
    importedAt
  };

  return { profile, marker };
}

export function formatImportRollbackFailureMessage(
  errorMessage: string,
  failures: string[]
): string {
  return `${errorMessage}${formatImportRollbackFailureSuffix(failures)}`;
}

export function formatImportCancelledMessage(
  errorMessage: string,
  failures: string[]
): string {
  return `导入已取消：${errorMessage}${formatImportRollbackFailureSuffix(failures)}`;
}

export function formatImportCancelledRollbackFailureMessage(
  failures: string[]
): string {
  return `导入已取消，但回滚失败账号：${failures.join("、")}`;
}

function formatImportRollbackFailureSuffix(failures: string[]): string {
  return failures.length > 0 ? `；回滚失败账号：${failures.join("、")}` : "";
}

export function buildImportDocumentCommitPlan({
  currentDocument,
  createdProfiles,
  normalizeSettings
}: {
  currentDocument: Pick<ProfileDocument, "settings" | "profiles" | "projects">;
  createdProfiles: ChromeProfile[];
  normalizeSettings: (settings: ProfileSettings) => ProfileSettings;
}): {
  document: ProfileDocument;
  profiles: ChromeProfile[];
  settings: ProfileSettings;
  projects: AirdropProject[];
} {
  const profiles = [...currentDocument.profiles, ...createdProfiles];
  const settings = normalizeSettings(currentDocument.settings);
  const existingProfileIds = new Set(profiles.map((profile) => profile.id));
  const projects = currentDocument.projects.map((project) => ({
    ...project,
    profileIds: project.profileIds.filter((profileId) =>
      existingProfileIds.has(profileId)
    )
  }));
  const document = { version: 1 as const, settings, profiles, projects };

  return { document, profiles, settings, projects };
}

export function mergeQueuedProfiles(
  baseProfiles: ChromeProfile[],
  currentProfiles: ChromeProfile[],
  requestedProfiles: ChromeProfile[]
): { profiles: ChromeProfile[]; remappedIds: Map<string, string> } {
  const baseById = new Map(baseProfiles.map((profile) => [profile.id, profile]));
  const currentById = new Map(
    currentProfiles.map((profile) => [profile.id, profile])
  );
  const requestedById = new Map(
    requestedProfiles.map((profile) => [profile.id, profile])
  );
  const merged = currentProfiles.flatMap((profile) => {
    const base = baseById.get(profile.id);
    if (!base) {
      return [profile];
    }
    if (isReplacementEntity(base, profile)) {
      return [profile];
    }
    const requested = requestedById.get(profile.id);
    if (!requested) {
      return [];
    }
    return documentValuesMatch(base, requested)
      ? [profile]
      : [mergeProfileFields(base, profile, requested)];
  });
  const remappedIds = new Map<string, string>();
  for (const profile of requestedProfiles) {
    if (baseById.has(profile.id)) {
      continue;
    }
    const current = currentById.get(profile.id);
    if (!current) {
      merged.push(profile);
      continue;
    }
    if (!documentValuesMatch(current, profile)) {
      const nextId = nextProfileId([...merged, ...requestedProfiles]);
      remappedIds.set(profile.id, nextId);
      merged.push({ ...profile, id: nextId });
    }
  }
  return { profiles: merged, remappedIds };
}

export function mergeQueuedSettings(
  base: ProfileSettings,
  current: ProfileSettings,
  requested: ProfileSettings
): ProfileSettings {
  return {
    browserPath: mergeProfileField(
      base.browserPath,
      current.browserPath,
      requested.browserPath
    ),
    favoriteUrls: mergeOrderedStringList(
      base.favoriteUrls,
      current.favoriteUrls,
      requested.favoriteUrls
    ),
    recentUrls: mergeOrderedStringList(
      base.recentUrls,
      current.recentUrls,
      requested.recentUrls
    ),
    urlLibrary: mergeUrlLibraryItems(
      base.urlLibrary,
      current.urlLibrary,
      requested.urlLibrary
    ),
    theme: mergeProfileField(base.theme, current.theme, requested.theme)
  };
}

export function mergeQueuedProjects(
  baseProjects: AirdropProject[],
  currentProjects: AirdropProject[],
  requestedProjects: AirdropProject[]
): AirdropProject[] {
  const baseById = new Map(baseProjects.map((project) => [project.id, project]));
  const currentById = new Map(
    currentProjects.map((project) => [project.id, project])
  );
  const requestedById = new Map(
    requestedProjects.map((project) => [project.id, project])
  );
  if (documentValuesMatch(baseProjects, requestedProjects)) {
    return currentProjects;
  }
  const consumedIds = new Set<string>();
  const merged: AirdropProject[] = [];
  for (const project of requestedProjects) {
    const base = baseById.get(project.id);
    const current = currentById.get(project.id);
    if (!base) {
      if (!current) {
        merged.push(project);
        consumedIds.add(project.id);
      } else if (!documentValuesMatch(current, project)) {
        const remapped = {
          ...project,
          id: nextSequentialId("project-", [
            ...merged,
            ...currentProjects,
            ...requestedProjects
          ])
        };
        merged.push(remapped);
        consumedIds.add(remapped.id);
      }
      continue;
    }
    const requested = requestedById.get(project.id);
    if (!requested) {
      continue;
    }
    if (!current) {
      continue;
    }
    if (isReplacementEntity(base, current)) {
      continue;
    }
    merged.push(
      documentValuesMatch(base, requested)
        ? current
        : mergeProjectFields(base, current, requested)
    );
    consumedIds.add(project.id);
  }
  for (const project of currentProjects) {
    const base = baseById.get(project.id);
    if (base && isReplacementEntity(base, project) && !consumedIds.has(project.id)) {
      insertBeforeNextCurrentAnchor(
        merged,
        currentProjects,
        project,
        (entry) => entry.id
      );
      continue;
    }
    if (!baseById.has(project.id) && !consumedIds.has(project.id)) {
      insertBeforeNextCurrentAnchor(
        merged,
        currentProjects,
        project,
        (entry) => entry.id
      );
    }
  }
  return merged;
}

export function isReplacementCreatedAt(
  baseCreatedAt: string | null | undefined,
  currentCreatedAt: string | null | undefined
): boolean {
  const baseValue = baseCreatedAt ?? "";
  const currentValue = currentCreatedAt ?? "";
  return (baseValue !== "" || currentValue !== "") && baseValue !== currentValue;
}

function mergeUrlLibraryItems(
  baseItems: UrlLibraryItem[],
  currentItems: UrlLibraryItem[],
  requestedItems: UrlLibraryItem[]
): UrlLibraryItem[] {
  const baseById = new Map(baseItems.map((item) => [item.id, item]));
  const currentById = new Map(currentItems.map((item) => [item.id, item]));
  const requestedById = new Map(requestedItems.map((item) => [item.id, item]));
  if (documentValuesMatch(baseItems, requestedItems)) {
    return currentItems;
  }
  const consumedIds = new Set<string>();
  const merged: UrlLibraryItem[] = [];
  for (const item of requestedItems) {
    const base = baseById.get(item.id);
    const current = currentById.get(item.id);
    if (!base) {
      if (!current) {
        merged.push(item);
        consumedIds.add(item.id);
      } else if (!documentValuesMatch(current, item)) {
        const remapped = {
          ...item,
          id: nextSequentialId("url-", [...merged, ...currentItems, ...requestedItems])
        };
        merged.push(remapped);
        consumedIds.add(remapped.id);
      }
      continue;
    }
    const requested = requestedById.get(item.id);
    if (!requested) {
      continue;
    }
    if (!current) {
      continue;
    }
    if (isReplacementEntity(base, current)) {
      continue;
    }
    merged.push(
      documentValuesMatch(base, requested)
        ? current
        : mergeUrlLibraryItemFields(base, current, requested)
    );
    consumedIds.add(item.id);
  }
  for (const item of currentItems) {
    const base = baseById.get(item.id);
    if (base && isReplacementEntity(base, item) && !consumedIds.has(item.id)) {
      insertBeforeNextCurrentAnchor(merged, currentItems, item, (entry) => entry.id);
      continue;
    }
    if (!baseById.has(item.id) && !consumedIds.has(item.id)) {
      insertBeforeNextCurrentAnchor(merged, currentItems, item, (entry) => entry.id);
    }
  }
  return merged;
}

function documentValuesMatch(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function isReplacementEntity(
  base: { createdAt?: string | null },
  current: { createdAt?: string | null }
): boolean {
  return isReplacementCreatedAt(base.createdAt, current.createdAt);
}

function mergeProfileFields(
  base: ChromeProfile,
  current: ChromeProfile,
  requested: ChromeProfile
): ChromeProfile {
  return {
    ...current,
    name: mergeProfileField(base.name, current.name, requested.name),
    tags: mergeProfileField(base.tags, current.tags, requested.tags),
    notes: mergeProfileField(base.notes, current.notes, requested.notes),
    status: mergeProfileField(base.status, current.status, requested.status),
    accountPlatforms: mergeProfileField(
      base.accountPlatforms,
      current.accountPlatforms,
      requested.accountPlatforms
    ),
    accentColor: mergeProfileField(
      base.accentColor,
      current.accentColor,
      requested.accentColor
    ),
    importSource: mergeProfileField(
      base.importSource,
      current.importSource,
      requested.importSource
    ),
    createdAt: mergeProfileField(
      base.createdAt,
      current.createdAt,
      requested.createdAt
    ),
    updatedAt: mergeProfileField(
      base.updatedAt,
      current.updatedAt,
      requested.updatedAt
    ),
    lastOpenedAt: mergeProfileField(
      base.lastOpenedAt,
      current.lastOpenedAt,
      requested.lastOpenedAt
    )
  };
}

function mergeUrlLibraryItemFields(
  base: UrlLibraryItem,
  current: UrlLibraryItem,
  requested: UrlLibraryItem
): UrlLibraryItem {
  return {
    ...current,
    name: mergeProfileField(base.name, current.name, requested.name),
    url: mergeProfileField(base.url, current.url, requested.url),
    tags: mergeProfileField(base.tags, current.tags, requested.tags),
    notes: mergeProfileField(base.notes, current.notes, requested.notes),
    createdAt: mergeProfileField(
      base.createdAt,
      current.createdAt,
      requested.createdAt
    ),
    updatedAt: mergeProfileField(
      base.updatedAt,
      current.updatedAt,
      requested.updatedAt
    )
  };
}

function mergeProjectFields(
  base: AirdropProject,
  current: AirdropProject,
  requested: AirdropProject
): AirdropProject {
  return {
    ...current,
    name: mergeProfileField(base.name, current.name, requested.name),
    url: mergeProfileField(base.url, current.url, requested.url),
    urls: mergeProfileField(base.urls, current.urls, requested.urls),
    notes: mergeProfileField(base.notes, current.notes, requested.notes),
    profileIds: mergeProfileField(
      base.profileIds,
      current.profileIds,
      requested.profileIds
    ),
    intervalSeconds: mergeProfileField(
      base.intervalSeconds,
      current.intervalSeconds,
      requested.intervalSeconds
    ),
    createdAt: mergeProfileField(
      base.createdAt,
      current.createdAt,
      requested.createdAt
    ),
    updatedAt: mergeProfileField(
      base.updatedAt,
      current.updatedAt,
      requested.updatedAt
    ),
    lastOpenedAt: mergeProfileField(
      base.lastOpenedAt,
      current.lastOpenedAt,
      requested.lastOpenedAt
    )
  };
}

function mergeProfileField<T>(base: T, current: T, requested: T): T {
  return documentValuesMatch(base, requested) ? current : requested;
}

function mergeOrderedStringList(
  base: string[],
  current: string[],
  requested: string[]
): string[] {
  if (documentValuesMatch(base, requested)) {
    return current;
  }
  const baseSet = new Set(base);
  const currentSet = new Set(current);
  const merged: string[] = [];
  for (const value of requested) {
    if (!baseSet.has(value) || currentSet.has(value)) {
      merged.push(value);
    }
  }
  for (const value of current) {
    if (!baseSet.has(value) && !merged.includes(value)) {
      insertBeforeNextCurrentAnchor(merged, current, value);
    }
  }
  return merged;
}

function insertBeforeNextCurrentAnchor<T>(
  merged: T[],
  current: T[],
  value: T,
  getKey: (item: T) => string = (item) => String(item)
) {
  const currentIndex = current.findIndex((item) => getKey(item) === getKey(value));
  const nextAnchor = current
    .slice(currentIndex + 1)
    .find((item) =>
      merged.some((mergedItem) => getKey(mergedItem) === getKey(item))
    );
  if (!nextAnchor) {
    merged.push(value);
    return;
  }
  const anchorIndex = merged.findIndex(
    (item) => getKey(item) === getKey(nextAnchor)
  );
  merged.splice(anchorIndex, 0, value);
}

export function nextSequentialId(
  prefix: string,
  entities: Array<{ id: string }>
): string {
  const usedIds = new Set(entities.map((entity) => entity.id));
  for (let index = 1; ; index += 1) {
    const id = `${prefix}${String(index).padStart(3, "0")}`;
    if (!usedIds.has(id)) {
      return id;
    }
  }
}
