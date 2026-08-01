import { useRef, useState, type Dispatch, type SetStateAction } from "react";
import type {
  AirdropProject,
  ChromeProfile,
  ProfileDocument,
  ProfileSettings
} from "../types";
import { useProfileDocumentMutations } from "./useProfileDocumentMutations";

interface ProfileDocumentState {
  profiles: ChromeProfile[];
  settings: ProfileSettings;
  projects: AirdropProject[];
}

interface UseProfileDocumentStoreOptions {
  initialRootPath?: string;
  initialSettings: ProfileSettings;
  initialProfiles?: ChromeProfile[];
  initialProjects?: AirdropProject[];
  saveDocument: (
    rootPath: string,
    document: ProfileDocument
  ) => Promise<void>;
  normalizeDocumentSettings?: (settings: ProfileSettings) => ProfileSettings;
  onDocumentCommitted: (
    state: ProfileDocumentState,
    message: string
  ) => void;
}

export function useProfileDocumentStore(options: UseProfileDocumentStoreOptions) {
  const [rootPath, setRootPathState] = useState(options.initialRootPath ?? "");
  const [settings, setSettingsState] = useState(options.initialSettings);
  const [profiles, setProfilesState] = useState(options.initialProfiles ?? []);
  const [projects, setProjectsState] = useState(options.initialProjects ?? []);
  const documentStateRef = useRef({ rootPath, settings, profiles, projects });
  documentStateRef.current = { rootPath, settings, profiles, projects };

  const mutations = useProfileDocumentMutations({
    rootPath,
    profiles,
    settings,
    projects,
    saveDocument: options.saveDocument,
    normalizeDocumentSettings: options.normalizeDocumentSettings,
    onCommitDocumentState: (state, message) => {
      documentStateRef.current = {
        ...documentStateRef.current,
        ...state
      };
      setProfilesState(state.profiles);
      setSettingsState(state.settings);
      setProjectsState(state.projects);
      options.onDocumentCommitted(state, message);
    }
  });

  function replaceState(nextState: {
    rootPath: string;
    profiles: ChromeProfile[];
    settings: ProfileSettings;
    projects: AirdropProject[];
  }, bumpGeneration: boolean) {
    documentStateRef.current = nextState;
    mutations.replaceProfileDocumentState({ ...nextState, bumpGeneration });
    setRootPathState(nextState.rootPath);
    setProfilesState(nextState.profiles);
    setSettingsState(nextState.settings);
    setProjectsState(nextState.projects);
  }

  function setDocumentField<K extends keyof typeof documentStateRef.current>(
    field: K,
    value: SetStateAction<(typeof documentStateRef.current)[K]>,
    bumpGeneration = false
  ) {
    const currentValue = documentStateRef.current[field];
    const nextValue = typeof value === "function"
      ? (value as (previous: typeof currentValue) => typeof currentValue)(currentValue)
      : value;
    const nextState = {
      ...documentStateRef.current,
      [field]: nextValue
    } as typeof documentStateRef.current;
    replaceState(nextState, bumpGeneration);
  }

  const setRootPath: Dispatch<SetStateAction<string>> = (value) => {
    const currentRootPath = documentStateRef.current.rootPath;
    const nextRootPath = typeof value === "function" ? value(currentRootPath) : value;
    if (nextRootPath === currentRootPath) {
      return;
    }
    setDocumentField("rootPath", nextRootPath, true);
  };
  const setSettings: Dispatch<SetStateAction<ProfileSettings>> = (value) =>
    setDocumentField("settings", value);
  const setProfiles: Dispatch<SetStateAction<ChromeProfile[]>> = (value) =>
    setDocumentField("profiles", value);
  const setProjects: Dispatch<SetStateAction<AirdropProject[]>> = (value) =>
    setDocumentField("projects", value);

  function commitProfileDocumentState(
    nextProfiles: ChromeProfile[],
    nextSettings: ProfileSettings,
    nextProjects: AirdropProject[],
    nextMessage: string
  ) {
    mutations.commitProfileDocumentState(
      nextProfiles,
      nextSettings,
      nextProjects,
      nextMessage
    );
  }

  function replaceProfileDocumentState({
    rootPath: nextRootPath,
    profiles: nextProfiles,
    settings: nextSettings,
    projects: nextProjects,
    bumpGeneration = true
  }: Parameters<typeof mutations.replaceProfileDocumentState>[0]) {
    replaceState(
      {
        rootPath: nextRootPath ?? documentStateRef.current.rootPath,
        profiles: nextProfiles,
        settings: nextSettings,
        projects: nextProjects
      },
      bumpGeneration
    );
  }

  return {
    rootPath,
    settings,
    profiles,
    projects,
    setRootPath,
    setSettings,
    setProfiles,
    setProjects,
    enqueueDocumentMutation: mutations.enqueueDocumentMutation,
    persistDocument: mutations.persistDocument,
    commitProfileDocumentState,
    replaceProfileDocumentState,
    getProfileDocumentSnapshot: mutations.getProfileDocumentSnapshot
  };
}
