import { useEffect, useMemo, useRef, useState } from "react";
import {
  profileApi,
  type BrowserRuntimeTabSnapshot,
  type BrowserSessionSnapshot
} from "../api";
import { errorMessage } from "../shared/windowAutomationErrors";
import type { ChromeProfile } from "../types";
import {
  buildRuntimeTabsPanelModel,
  type RuntimeTabsPanelModel
} from "./runtimeTabs";

type RuntimeTabsStatus = "idle" | "loading" | "succeeded" | "failed";

interface RuntimeTabsState {
  status: RuntimeTabsStatus;
  tabs: BrowserRuntimeTabSnapshot[];
  error: string | null;
}

export interface UseProfileRuntimeTabsOptions {
  rootPath: string;
  selectedProfile: ChromeProfile | null;
  selectedProfileCount: number;
  session: BrowserSessionSnapshot | null;
  listRuntimeTabs?: (
    rootPath: string,
    profileId: string
  ) => Promise<BrowserRuntimeTabSnapshot[]>;
}

export interface UseProfileRuntimeTabsResult {
  model: RuntimeTabsPanelModel;
  loading: boolean;
  readTabs: () => Promise<void>;
  reset: () => void;
}

function createInitialState(): RuntimeTabsState {
  return {
    status: "idle",
    tabs: [],
    error: null
  };
}

function sessionRuntimeKey(session: BrowserSessionSnapshot | null): string {
  if (!session) {
    return "none";
  }

  return [
    session.profileId,
    session.status,
    session.running,
    session.pid,
    session.debugPort,
    session.cdpStatus,
    session.runtimeError
  ].join("|");
}

export function useProfileRuntimeTabs({
  rootPath,
  selectedProfile,
  selectedProfileCount,
  session,
  listRuntimeTabs = profileApi.listRuntimeTabs
}: UseProfileRuntimeTabsOptions): UseProfileRuntimeTabsResult {
  const [state, setState] = useState<RuntimeTabsState>(createInitialState);
  const requestIdRef = useRef(0);
  const mountedRef = useRef(true);
  const currentContextRef = useRef({
    rootPath,
    profileId: selectedProfile?.id ?? null,
    selectedProfileCount,
    sessionKey: sessionRuntimeKey(session)
  });

  const currentSessionKey = sessionRuntimeKey(session);
  currentContextRef.current = {
    rootPath,
    profileId: selectedProfile?.id ?? null,
    selectedProfileCount,
    sessionKey: currentSessionKey
  };

  const reset = () => {
    requestIdRef.current += 1;
    if (mountedRef.current) {
      setState(createInitialState());
    }
  };

  useEffect(() => {
    reset();
  }, [rootPath, selectedProfile?.id, selectedProfileCount, currentSessionKey]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      requestIdRef.current += 1;
    };
  }, []);

  const model = useMemo(
    () =>
      buildRuntimeTabsPanelModel({
        selectedProfile,
        selectedProfileCount,
        session,
        status: state.status,
        tabs: state.tabs,
        error: state.error
      }),
    [selectedProfile, selectedProfileCount, session, state]
  );

  async function readTabs(): Promise<void> {
    if (!model.canReadTabs || !selectedProfile) {
      return;
    }

    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    const requestContext = { ...currentContextRef.current };
    const profileId = selectedProfile.id;

    setState({ status: "loading", tabs: [], error: null });

    const isCurrent = () => {
      const currentContext = currentContextRef.current;
      return (
        mountedRef.current &&
        requestIdRef.current === requestId &&
        currentContext.rootPath === requestContext.rootPath &&
        currentContext.profileId === requestContext.profileId &&
        currentContext.selectedProfileCount === requestContext.selectedProfileCount &&
        currentContext.sessionKey === requestContext.sessionKey
      );
    };

    try {
      const tabs = await listRuntimeTabs(requestContext.rootPath, profileId);
      if (!isCurrent()) {
        return;
      }
      setState({ status: "succeeded", tabs, error: null });
    } catch (error) {
      if (!isCurrent()) {
        return;
      }
      setState({ status: "failed", tabs: [], error: errorMessage(error) });
    }
  }

  return { model, loading: state.status === "loading", readTabs, reset };
}
