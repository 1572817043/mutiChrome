import { useRef } from "react";
import type {
  AirdropProject,
  ChromeProfile,
  ProfileDocument,
  ProfileSettings
} from "../types";
import {
  mergeQueuedProfiles,
  mergeQueuedProjects,
  mergeQueuedSettings
} from "./profileDocumentMutationModel";

interface ProfileDocumentState {
  profiles: ChromeProfile[];
  settings: ProfileSettings;
  projects: AirdropProject[];
}

interface UseProfileDocumentMutationsOptions extends ProfileDocumentState {
  rootPath: string;
  saveDocument: (
    rootPath: string,
    document: ProfileDocument
  ) => Promise<void>;
  normalizeDocumentSettings?: (settings: ProfileSettings) => ProfileSettings;
  onCommitDocumentState: (
    state: ProfileDocumentState,
    message: string
  ) => void;
}

interface PersistProfileDocumentInput {
  profiles: ChromeProfile[];
  message: string;
  settings?: ProfileSettings;
  projects?: AirdropProject[];
  baseDocument?: ProfileDocumentState;
  targetRootPath?: string;
  shouldCommit?: () => boolean;
}

interface ReplaceProfileDocumentStateInput extends ProfileDocumentState {
  rootPath?: string;
  bumpGeneration?: boolean;
}

interface ProfileDocumentSnapshot extends ProfileDocumentState {
  rootPath: string;
}

export function useProfileDocumentMutations(
  options: UseProfileDocumentMutationsOptions
) {
  const rootPathRef = useRef(options.rootPath);
  const profilesRef = useRef(options.profiles);
  const settingsRef = useRef(options.settings);
  const projectsRef = useRef(options.projects);
  const renderedRootPathRef = useRef(options.rootPath);
  const documentGenerationRef = useRef(0);
  const documentMutationQueueRef = useRef<Promise<void>>(Promise.resolve());

  if (renderedRootPathRef.current !== options.rootPath) {
    renderedRootPathRef.current = options.rootPath;
    rootPathRef.current = options.rootPath;
    profilesRef.current = options.profiles;
    settingsRef.current = options.settings;
    projectsRef.current = options.projects;
    documentGenerationRef.current += 1;
  }

  const normalizeDocumentSettings =
    options.normalizeDocumentSettings ?? ((settings: ProfileSettings) => settings);

  function enqueueDocumentMutation<T>(task: () => Promise<T>): Promise<T> {
    const queued = documentMutationQueueRef.current.then(task, task);
    documentMutationQueueRef.current = queued.then(
      () => undefined,
      () => undefined
    );
    return queued;
  }

  function commitProfileDocumentState(
    nextProfiles: ChromeProfile[],
    nextSettings: ProfileSettings,
    nextProjects: AirdropProject[],
    nextMessage: string
  ) {
    profilesRef.current = nextProfiles;
    settingsRef.current = nextSettings;
    projectsRef.current = nextProjects;
    options.onCommitDocumentState(
      {
        profiles: nextProfiles,
        settings: nextSettings,
        projects: nextProjects
      },
      nextMessage
    );
  }

  function replaceProfileDocumentState({
    rootPath,
    profiles,
    settings,
    projects,
    bumpGeneration = true
  }: ReplaceProfileDocumentStateInput) {
    if (bumpGeneration) {
      documentGenerationRef.current += 1;
    }
    if (rootPath !== undefined) {
      renderedRootPathRef.current = rootPath;
      rootPathRef.current = rootPath;
    }
    profilesRef.current = profiles;
    settingsRef.current = settings;
    projectsRef.current = projects;
  }

  function getProfileDocumentSnapshot(): ProfileDocumentSnapshot {
    return {
      rootPath: rootPathRef.current,
      profiles: profilesRef.current,
      settings: settingsRef.current,
      projects: projectsRef.current
    };
  }

  async function persistDocument({
    profiles: nextProfiles,
    message,
    settings: nextSettings = settingsRef.current,
    projects: nextProjects = projectsRef.current,
    baseDocument,
    targetRootPath = rootPathRef.current,
    shouldCommit
  }: PersistProfileDocumentInput): Promise<boolean> {
    const baseProfiles = baseDocument?.profiles ?? profilesRef.current;
    const baseSettings = baseDocument?.settings ?? settingsRef.current;
    const baseProjects = baseDocument?.projects ?? projectsRef.current;
    const generation = documentGenerationRef.current;
    const isCurrentDocument = () =>
      documentGenerationRef.current === generation &&
      rootPathRef.current === targetRootPath;

    return enqueueDocumentMutation(async () => {
      if (!isCurrentDocument()) {
        return false;
      }
      const { profiles: queuedProfiles, remappedIds } = mergeQueuedProfiles(
        baseProfiles,
        profilesRef.current,
        nextProfiles
      );
      const sanitizedSettings = normalizeDocumentSettings(
        mergeQueuedSettings(baseSettings, settingsRef.current, nextSettings)
      );
      const remappedRequestedProjects = nextProjects.map((project) => ({
        ...project,
        profileIds: project.profileIds.map(
          (profileId) => remappedIds.get(profileId) ?? profileId
        )
      }));
      const queuedProjects = mergeQueuedProjects(
        baseProjects,
        projectsRef.current,
        remappedRequestedProjects
      );
      const existingProfileIds = new Set(queuedProfiles.map((profile) => profile.id));
      const sanitizedProjects = queuedProjects.map((project) => ({
        ...project,
        profileIds: project.profileIds.filter((profileId) =>
          existingProfileIds.has(profileId)
        )
      }));
      if (shouldCommit && !shouldCommit()) {
        return false;
      }
      await options.saveDocument(targetRootPath, {
        version: 1,
        settings: sanitizedSettings,
        profiles: queuedProfiles,
        projects: sanitizedProjects
      });
      if (!isCurrentDocument() || (shouldCommit && !shouldCommit())) {
        return true;
      }
      commitProfileDocumentState(
        queuedProfiles,
        sanitizedSettings,
        sanitizedProjects,
        message
      );
      return true;
    });
  }

  return {
    enqueueDocumentMutation,
    persistDocument,
    commitProfileDocumentState,
    replaceProfileDocumentState,
    getProfileDocumentSnapshot
  };
}
