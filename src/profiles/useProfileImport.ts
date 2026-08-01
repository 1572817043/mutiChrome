import { useMemo, useRef, useState } from "react";
import { profileApi } from "../api";
import { errorMessage } from "../shared/windowAutomationErrors";
import type { ProfileImportCandidate } from "../types";

interface UseProfileImportOptions {
  rootPath: string;
  onImportCandidates: (
    candidates: ProfileImportCandidate[],
    shouldCommit: () => boolean
  ) => Promise<ImportPersistResult> | ImportPersistResult;
  onMessage: (message: string) => void;
}

export type ImportPersistResult =
  | "not-saved"
  | "saved-committed"
  | "saved-stale";

export function useProfileImport({
  rootPath,
  onImportCandidates,
  onMessage
}: UseProfileImportOptions) {
  const [importPath, setImportPath] = useState("");
  const [importCandidates, setImportCandidates] = useState<ProfileImportCandidate[]>([]);
  const [selectedImportPaths, setSelectedImportPaths] = useState<string[]>([]);
  const [importScanning, setImportScanning] = useState(false);
  const [importingProfiles, setImportingProfiles] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const rootGenerationRef = useRef(0);
  const scanRequestRef = useRef(0);
  const importRequestRef = useRef(0);

  const selectedImportCount = useMemo(
    () =>
      importCandidates.filter(
        (candidate) =>
          isImportCandidateSelectable(candidate) &&
          selectedImportPaths.includes(candidate.path)
      ).length,
    [importCandidates, selectedImportPaths]
  );

  function onImportPathChange(path: string) {
    scanRequestRef.current += 1;
    importRequestRef.current += 1;
    setImportPath(path);
    setImportCandidates([]);
    setSelectedImportPaths([]);
    setImportScanning(false);
    setImportingProfiles(false);
  }

  function clearImportPreview() {
    setImportCandidates([]);
    setSelectedImportPaths([]);
  }

  function toggleImportPanel() {
    setShowImport((current) => !current);
  }

  function resetForLoadedRoot() {
    rootGenerationRef.current += 1;
    setImportPath("");
    setImportCandidates([]);
    setSelectedImportPaths([]);
    setImportScanning(false);
    setImportingProfiles(false);
  }

  async function scanImportCandidates() {
    const sourcePath = importPath.trim();
    if (!sourcePath) {
      onMessage("请先填写要扫描的来源目录");
      return;
    }

    const generation = rootGenerationRef.current;
    const request = scanRequestRef.current + 1;
    scanRequestRef.current = request;
    setImportScanning(true);
    setImportCandidates([]);
    setSelectedImportPaths([]);
    try {
      const candidates = await profileApi.scanProfileImportCandidates(
        rootPath,
        sourcePath
      );
      if (!isCurrentScan(generation, request)) {
        return;
      }
      setImportCandidates(candidates);
      setSelectedImportPaths(
        candidates
          .filter(
            (candidate) =>
              candidate.confidence === "ready" && !candidate.duplicateProfileId
          )
          .map((candidate) => candidate.path)
      );
      const readyCount = candidates.filter(
        (candidate) =>
          candidate.confidence === "ready" && !candidate.duplicateProfileId
      ).length;
      const suspiciousCount = candidates.filter(
        (candidate) =>
          candidate.confidence === "suspicious" && !candidate.duplicateProfileId
      ).length;
      const duplicateCount = candidates.filter(
        (candidate) => candidate.duplicateProfileId
      ).length;
      onMessage(
        `可导入 ${readyCount} · 可疑 ${suspiciousCount} · 已导入 ${duplicateCount}`
      );
    } catch (error) {
      if (isCurrentScan(generation, request)) {
        onMessage(errorMessage(error));
      }
    } finally {
      if (isCurrentScan(generation, request)) {
        setImportScanning(false);
      }
    }
  }

  function toggleImportCandidate(path: string) {
    setSelectedImportPaths((current) =>
      current.includes(path)
        ? current.filter((selectedPath) => selectedPath !== path)
        : [...current, path]
    );
  }

  async function importSelectedCandidates() {
    const selectedCandidates = importCandidates.filter(
      (candidate) =>
        isImportCandidateSelectable(candidate) &&
        selectedImportPaths.includes(candidate.path)
    );
    if (selectedCandidates.length === 0) {
      onMessage("请先选择要导入的候选目录");
      return;
    }

    const generation = rootGenerationRef.current;
    const request = importRequestRef.current + 1;
    importRequestRef.current = request;
    setImportingProfiles(true);
    try {
      if (!isCurrentImport(generation, request)) {
        return;
      }

      const importResult = await onImportCandidates(
        selectedCandidates,
        () => isCurrentImport(generation, request)
      );
      if (importResult === "not-saved") {
        return;
      }
      if (
        importResult === "saved-stale" ||
        !isCurrentImport(generation, request)
      ) {
        return;
      }
      setImportPath("");
      setImportCandidates([]);
      setSelectedImportPaths([]);
      setShowImport(false);
    } catch (error) {
      if (isCurrentImport(generation, request)) {
        onMessage(errorMessage(error));
      }
    } finally {
      if (isCurrentImport(generation, request)) {
        setImportingProfiles(false);
      }
    }
  }

  function isCurrentScan(generation: number, request: number) {
    return (
      rootGenerationRef.current === generation && scanRequestRef.current === request
    );
  }

  function isCurrentImport(generation: number, request: number) {
    return (
      rootGenerationRef.current === generation &&
      importRequestRef.current === request
    );
  }

  return {
    importPath,
    importCandidates,
    selectedImportPaths,
    importScanning,
    importingProfiles,
    showImport,
    selectedImportCount,
    scanImportCandidates,
    toggleImportCandidate,
    importSelectedCandidates,
    onImportPathChange,
    clearImportPreview,
    toggleImportPanel,
    resetForLoadedRoot
  };
}

export function isImportCandidateSelectable(
  candidate: ProfileImportCandidate
): boolean {
  return candidate.confidence !== "skipped" && !candidate.duplicateProfileId;
}

export function importCandidateStatusText(
  candidate: ProfileImportCandidate
): string {
  if (candidate.duplicateProfileName) {
    return `已导入：${candidate.duplicateProfileName}`;
  }
  if (candidate.confidence === "ready") {
    return "可导入";
  }
  if (candidate.confidence === "suspicious") {
    return "可疑";
  }
  return candidate.skippedReason || "跳过";
}
