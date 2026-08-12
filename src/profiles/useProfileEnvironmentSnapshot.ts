import { useEffect, useRef, useState } from "react";
import { profileApi, type ProfileEnvironmentSnapshot } from "../api";
import type { ChromeProfile } from "../types";

interface UseProfileEnvironmentSnapshotOptions {
  rootPath: string;
  selectedProfile: ChromeProfile | null;
  browserPath?: string;
  loadSnapshot?: (
    rootPath: string,
    profileId: string,
    browserPath?: string
  ) => Promise<ProfileEnvironmentSnapshot>;
}

export function useProfileEnvironmentSnapshot({
  rootPath,
  selectedProfile,
  browserPath,
  loadSnapshot = profileApi.getProfileEnvironmentSnapshot
}: UseProfileEnvironmentSnapshotOptions) {
  const [snapshot, setSnapshot] = useState<ProfileEnvironmentSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);
  const mountedRef = useRef(true);
  const contextRef = useRef({
    rootPath,
    profileId: selectedProfile?.id ?? null,
    browserPath
  });

  contextRef.current = { rootPath, profileId: selectedProfile?.id ?? null, browserPath };

  useEffect(() => {
    requestIdRef.current += 1;
    setSnapshot(null);
    setLoading(false);
    setError(null);
  }, [rootPath, selectedProfile?.id, browserPath]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      requestIdRef.current += 1;
    };
  }, []);

  async function refresh(): Promise<boolean> {
    if (!selectedProfile) {
      return false;
    }
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    const requestContext = { ...contextRef.current };
    setLoading(true);
    setSnapshot(null);
    setError(null);
    const isCurrent = () =>
      mountedRef.current &&
      requestId === requestIdRef.current &&
      contextRef.current.rootPath === requestContext.rootPath &&
      contextRef.current.profileId === requestContext.profileId &&
      contextRef.current.browserPath === requestContext.browserPath;
    try {
      const nextSnapshot = await loadSnapshot(
        requestContext.rootPath,
        selectedProfile.id,
        requestContext.browserPath
      );
      if (!isCurrent()) {
        return false;
      }
      setSnapshot(nextSnapshot);
      return true;
    } catch (reason) {
      if (!isCurrent()) {
        return false;
      }
      setError(reason instanceof Error ? reason.message : "读取本地环境失败");
      return false;
    } finally {
      if (isCurrent()) {
        setLoading(false);
      }
    }
  }

  return { snapshot, loading, error, refresh };
}
