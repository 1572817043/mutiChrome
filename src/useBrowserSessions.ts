import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { BrowserSessionSnapshot } from "./api";
import {
  createStartingBrowserSession,
  mergeBrowserSessionSnapshots,
  runningProfileIdsFromSessions
} from "./browserSessions";

interface UseBrowserSessionsOptions {
  launchConfirmationDelayMs: number;
}

export function useBrowserSessions({
  launchConfirmationDelayMs
}: UseBrowserSessionsOptions) {
  const [sessionsById, setSessionsById] = useState<
    Record<string, BrowserSessionSnapshot>
  >({});
  const requestIdRef = useRef(0);
  const launchConfirmationTimerRef = useRef<number | null>(null);

  const runningProfileIds = useMemo(
    () => runningProfileIdsFromSessions(sessionsById),
    [sessionsById]
  );

  const applySnapshots = useCallback((snapshots: BrowserSessionSnapshot[]) => {
    setSessionsById((current) => mergeBrowserSessionSnapshots(current, snapshots));
  }, []);

  const clearSnapshots = useCallback(() => {
    setSessionsById({});
  }, []);

  const nextRequestId = useCallback(() => {
    requestIdRef.current += 1;
    return requestIdRef.current;
  }, []);

  const isLatestRequest = useCallback((requestId: number) => {
    return requestId === requestIdRef.current;
  }, []);

  const clearLaunchConfirmationRefresh = useCallback(() => {
    if (launchConfirmationTimerRef.current !== null) {
      window.clearTimeout(launchConfirmationTimerRef.current);
      launchConfirmationTimerRef.current = null;
    }
  }, []);

  const scheduleLaunchConfirmationRefresh = useCallback(
    (callback: () => void) => {
      clearLaunchConfirmationRefresh();
      launchConfirmationTimerRef.current = window.setTimeout(() => {
        launchConfirmationTimerRef.current = null;
        callback();
      }, launchConfirmationDelayMs);
    },
    [clearLaunchConfirmationRefresh, launchConfirmationDelayMs]
  );

  const markStarting = useCallback((profileId: string) => {
    setSessionsById((current) => {
      if (current[profileId]?.status === "running") {
        return current;
      }

      return {
        ...current,
        [profileId]: createStartingBrowserSession(profileId)
      };
    });
  }, []);

  useEffect(() => {
    return () => {
      clearLaunchConfirmationRefresh();
    };
  }, [clearLaunchConfirmationRefresh]);

  return {
    sessionsById,
    runningProfileIds,
    applySnapshots,
    clearSnapshots,
    nextRequestId,
    isLatestRequest,
    markStarting,
    clearLaunchConfirmationRefresh,
    scheduleLaunchConfirmationRefresh
  };
}
