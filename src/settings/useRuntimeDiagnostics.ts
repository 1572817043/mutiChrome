import { useEffect, useRef, useState } from "react";
import {
  profileApi,
  type BrowserRuntimeNavigationResult,
  type BrowserRuntimeTabSnapshot,
  type BrowserSessionSnapshot
} from "../api";
import { errorMessage } from "../shared/windowAutomationErrors";
import type { ChromeProfile } from "../types";
import type {
  RuntimeDiagnosticsProps,
  RuntimeDiagnosticsStatus
} from "./SettingsDialog";

interface RuntimeDiagnosticsState {
  status: RuntimeDiagnosticsStatus;
  tabs: BrowserRuntimeTabSnapshot[];
  error: string | null;
  navigationConfirmationMessage: string | null;
  navigateUrl: string;
  navigateStatus: RuntimeDiagnosticsStatus;
  navigateResult: BrowserRuntimeNavigationResult | null;
  navigateError: string | null;
}

interface UseRuntimeDiagnosticsOptions {
  rootPath: string;
  settingsOpen: boolean;
  selectedProfile: ChromeProfile | null;
  session: BrowserSessionSnapshot | null;
  selectedProfileCount: number;
  enabled: boolean;
}

const RUNTIME_NAVIGATION_CONFIRMATION_POLL_MS = 100;
const RUNTIME_NAVIGATION_CONFIRMATION_MAX_ATTEMPTS = 3;

function createInitialState(): RuntimeDiagnosticsState {
  return {
    status: "idle",
    tabs: [],
    error: null,
    navigationConfirmationMessage: null,
    navigateUrl: "",
    navigateStatus: "idle",
    navigateResult: null,
    navigateError: null
  };
}

function runtimeNavigationUrlMatches(targetUrl: string, tabUrl: string): boolean {
  try {
    return new URL(targetUrl).href === new URL(tabUrl).href;
  } catch {
    return targetUrl.replace(/\/+$/, "") === tabUrl.replace(/\/+$/, "");
  }
}

export function useRuntimeDiagnostics({
  rootPath,
  settingsOpen,
  selectedProfile,
  session,
  selectedProfileCount,
  enabled
}: UseRuntimeDiagnosticsOptions) {
  const [state, setState] = useState<RuntimeDiagnosticsState>(createInitialState);
  const requestIdRef = useRef(0);
  const profileIdRef = useRef<string | null>(null);
  const rootPathRef = useRef("");
  const settingsOpenRef = useRef(false);

  profileIdRef.current = selectedProfile?.id ?? null;
  rootPathRef.current = rootPath;
  settingsOpenRef.current = settingsOpen;

  function resetRuntimeDiagnostics() {
    requestIdRef.current += 1;
    setState(createInitialState());
  }

  function isRequestCurrent(requestId: number, profileId: string, requestRootPath: string) {
    return (
      requestIdRef.current === requestId &&
      settingsOpenRef.current &&
      profileIdRef.current === profileId &&
      rootPathRef.current === requestRootPath
    );
  }

  useEffect(() => {
    return () => {
      requestIdRef.current += 1;
    };
  }, []);

  useEffect(() => {
    if (settingsOpen) {
      resetRuntimeDiagnostics();
    }
  }, [selectedProfile?.id, rootPath]);

  async function readTabs() {
    if (!selectedProfile) {
      return;
    }

    const profileId = selectedProfile.id;
    const requestRootPath = rootPath;
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setState((current) => ({
      ...current,
      status: "loading",
      tabs: [],
      error: null,
      navigationConfirmationMessage: null
    }));
    try {
      const tabs = await profileApi.listRuntimeTabs(requestRootPath, profileId);
      if (!isRequestCurrent(requestId, profileId, requestRootPath)) {
        return;
      }
      setState((current) => ({
        ...current,
        status: "succeeded",
        tabs,
        error: null,
        navigationConfirmationMessage: null
      }));
    } catch (error) {
      if (!isRequestCurrent(requestId, profileId, requestRootPath)) {
        return;
      }
      setState((current) => ({
        ...current,
        status: "failed",
        tabs: [],
        error: errorMessage(error),
        navigationConfirmationMessage: null
      }));
    }
  }

  function updateNavigationUrl(value: string) {
    setState((current) => ({
      ...current,
      navigateUrl: value,
      navigateStatus: "idle",
      navigateResult: null,
      navigateError: null,
      navigationConfirmationMessage: null
    }));
  }

  async function navigate() {
    if (!selectedProfile) {
      return;
    }
    const url = state.navigateUrl.trim();
    if (!url) {
      return;
    }

    const profileId = selectedProfile.id;
    const requestRootPath = rootPath;
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setState((current) => ({
      ...current,
      navigateStatus: "loading",
      navigateResult: null,
      navigateError: null
    }));

    try {
      const result = await profileApi.navigateRuntimeTab(requestRootPath, profileId, url);
      if (!isRequestCurrent(requestId, profileId, requestRootPath)) {
        return;
      }

      setState((current) => ({
        ...current,
        status: "loading",
        error: null,
        navigationConfirmationMessage: null,
        navigateStatus: "succeeded",
        navigateResult: result,
        navigateError: null
      }));

      try {
        let tabs: BrowserRuntimeTabSnapshot[] = [];
        for (let attempt = 0; attempt < RUNTIME_NAVIGATION_CONFIRMATION_MAX_ATTEMPTS; attempt += 1) {
          tabs = await profileApi.listRuntimeTabs(requestRootPath, profileId);
          if (!isRequestCurrent(requestId, profileId, requestRootPath)) {
            return;
          }

          const navigationConfirmed = tabs.some(
            (tab) =>
              tab.targetId === result.targetId && runtimeNavigationUrlMatches(result.url, tab.url)
          );
          if (navigationConfirmed) {
            setState((current) => ({
              ...current,
              status: "succeeded",
              tabs,
              error: null,
              navigationConfirmationMessage: null
            }));
            return;
          }

          if (attempt < RUNTIME_NAVIGATION_CONFIRMATION_MAX_ATTEMPTS - 1) {
            await new Promise<void>((resolve) =>
              setTimeout(resolve, RUNTIME_NAVIGATION_CONFIRMATION_POLL_MS)
            );
            if (!isRequestCurrent(requestId, profileId, requestRootPath)) {
              return;
            }
          }
        }

        setState((current) => ({
          ...current,
          status: "succeeded",
          tabs,
          error: null,
          navigationConfirmationMessage: "导航成功，但暂未确认标签页已更新。"
        }));
      } catch (error) {
        if (!isRequestCurrent(requestId, profileId, requestRootPath)) {
          return;
        }
        setState((current) => ({
          ...current,
          status: "failed",
          error: `导航成功，但刷新标签页失败：${errorMessage(error)}`,
          navigationConfirmationMessage: null
        }));
      }
    } catch (error) {
      if (!isRequestCurrent(requestId, profileId, requestRootPath)) {
        return;
      }
      setState((current) => ({
        ...current,
        navigateStatus: "failed",
        navigateResult: null,
        navigateError: errorMessage(error)
      }));
    }
  }

  const runtimeDiagnostics: RuntimeDiagnosticsProps = {
    enabled,
    selectedProfileCount,
    selectedProfileName: selectedProfile?.name ?? null,
    session,
    status: state.status,
    tabs: state.tabs,
    error: state.error,
    navigationConfirmationMessage: state.navigationConfirmationMessage,
    onReadTabs: readTabs,
    navigateUrl: state.navigateUrl,
    navigateStatus: state.navigateStatus,
    navigateResult: state.navigateResult,
    navigateError: state.navigateError,
    onNavigateUrlChange: updateNavigationUrl,
    onNavigate: navigate
  };

  return { runtimeDiagnostics, resetRuntimeDiagnostics };
}
