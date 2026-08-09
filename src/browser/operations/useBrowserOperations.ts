import { useCallback, useRef, useState } from "react";
import { profileApi, type WindowBounds } from "../../api";
import type { BrowserLaunchQueueSummary, BrowserLaunchResult } from "../../browserSessionLaunch";
import {
  browserOperationStatusFromLaunchQueue,
  createBrowserOperation,
  findActiveBrowserOperationProfileConflicts,
  finishBrowserOperation,
  startBrowserOperation,
  trimBrowserOperations,
  withBrowserOperationTimeout,
  type BrowserOperation,
  type BrowserOperationProfileConflict,
  type BrowserOperationStatus
} from "../../browserOperations";
import type { ChromeProfile } from "../../types";
import { errorMessage } from "../../shared/windowAutomationErrors";

interface UseBrowserOperationsOptions {
  rootPath: string;
  maxOperations: number;
  commandTimeoutMs: number;
  onMessage: (message: string) => void;
}

interface ProjectOperationTargetInput {
  projectId: string;
  projectName: string;
  projectUrlIds: string[];
}

export function useBrowserOperations({
  rootPath,
  maxOperations,
  commandTimeoutMs,
  onMessage
}: UseBrowserOperationsOptions) {
  const [browserOperations, setBrowserOperations] = useState<BrowserOperation[]>([]);
  const browserOperationsRef = useRef<BrowserOperation[]>([]);
  const nextBrowserOperationIndexRef = useRef(1);

  const nextBrowserOperationId = useCallback(() => {
    const index = nextBrowserOperationIndexRef.current;
    nextBrowserOperationIndexRef.current += 1;
    return `operation-${String(index).padStart(4, "0")}`;
  }, []);

  const upsertBrowserOperation = useCallback(
    (operation: BrowserOperation) => {
      const nextOperations = trimBrowserOperations([
        operation,
        ...browserOperationsRef.current.filter((current) => current.id !== operation.id)
      ], maxOperations);
      browserOperationsRef.current = nextOperations;
      setBrowserOperations(nextOperations);
    },
    [maxOperations]
  );

  const startWindowOperation = useCallback(
    (action: string, profilesToOperate: ChromeProfile[]): BrowserOperation => {
      const operation = startBrowserOperation(
        createBrowserOperation({
          id: nextBrowserOperationId(),
          type: "window-action",
          sourceLabel: action,
          profileIds: profilesToOperate.map((profile) => profile.id),
          target: { kind: "window", action }
        })
      );
      upsertBrowserOperation(operation);
      return operation;
    },
    [nextBrowserOperationId, upsertBrowserOperation]
  );

  const finishWindowOperation = useCallback(
    <Summary,>(
      operation: BrowserOperation,
      status: Exclude<BrowserOperationStatus, "queued" | "running">,
      summary: Summary
    ) => {
      upsertBrowserOperation(finishBrowserOperation(operation, status, summary));
    },
    [upsertBrowserOperation]
  );

  const startProfileOpenOperation = useCallback(
    (sourceLabel: string, profile: ChromeProfile) => {
      const operation = startBrowserOperation(
        createBrowserOperation({
          id: nextBrowserOperationId(),
          type: "profile-open",
          sourceLabel,
          profileIds: [profile.id],
          target: { kind: "profile" }
        })
      );
      upsertBrowserOperation(operation);
      return operation;
    },
    [nextBrowserOperationId, upsertBrowserOperation]
  );

  const finishProfileOpenOperation = useCallback(
    (operation: BrowserOperation, result: BrowserLaunchResult) => {
      upsertBrowserOperation(
        finishBrowserOperation(operation, result.ok ? "succeeded" : "failed", {
          ok: result.ok,
          message: result.ok ? "已启动" : result.message
        })
      );
    },
    [upsertBrowserOperation]
  );

  const failProfileOpenOperation = useCallback(
    (operation: BrowserOperation, error: unknown) => {
      upsertBrowserOperation(
        finishBrowserOperation(operation, "failed", {
          ok: false,
          message: errorMessage(error)
        })
      );
    },
    [upsertBrowserOperation]
  );

  const startBulkOpenUrlOperation = useCallback(
    (
      sourceLabel: string,
      url: string,
      profilesToOperate: ChromeProfile[]
    ): BrowserOperation => {
      const operation = startBrowserOperation(
        createBrowserOperation({
          id: nextBrowserOperationId(),
          type: "bulk-open-url",
          sourceLabel,
          profileIds: profilesToOperate.map((profile) => profile.id),
          target: { kind: "url", url }
        })
      );
      upsertBrowserOperation(operation);
      return operation;
    },
    [nextBrowserOperationId, upsertBrowserOperation]
  );

  const startProjectOpenOperation = useCallback(
    (
      sourceLabel: string,
      target: ProjectOperationTargetInput,
      profilesToOperate: ChromeProfile[]
    ): BrowserOperation => {
      const operation = startBrowserOperation(
        createBrowserOperation({
          id: nextBrowserOperationId(),
          type: "project-open",
          sourceLabel,
          profileIds: profilesToOperate.map((profile) => profile.id),
          target: {
            kind: "project",
            projectId: target.projectId,
            projectName: target.projectName,
            projectUrlIds: target.projectUrlIds
          }
        })
      );
      upsertBrowserOperation(operation);
      return operation;
    },
    [nextBrowserOperationId, upsertBrowserOperation]
  );

  const finishLaunchQueueOperation = useCallback(
    (operation: BrowserOperation, summary: BrowserLaunchQueueSummary) => {
      upsertBrowserOperation(
        finishBrowserOperation(
          operation,
          browserOperationStatusFromLaunchQueue(summary),
          summary
        )
      );
    },
    [upsertBrowserOperation]
  );

  const runBrowserCommandWithTimeout = useCallback(
    <T,>(command: Promise<T>, actionLabel: string): Promise<T> => {
      return withBrowserOperationTimeout(
        command,
        commandTimeoutMs,
        `${actionLabel}超时，请稍后再试`
      );
    },
    [commandTimeoutMs]
  );

  const listProfileWindowsWithTimeout = useCallback(
    (profile: ChromeProfile, actionLabel: string) => {
      return runBrowserCommandWithTimeout(
        profileApi.listProfileWindows(rootPath, profile.id),
        `${profile.name} ${actionLabel}`
      );
    },
    [rootPath, runBrowserCommandWithTimeout]
  );

  const focusProfileWindowWithTimeout = useCallback(
    (profile: ChromeProfile) => {
      return runBrowserCommandWithTimeout(
        profileApi.focusProfileWindow(rootPath, profile.id),
        `${profile.name} 前置窗口`
      );
    },
    [rootPath, runBrowserCommandWithTimeout]
  );

  const quitProfileBrowserWithTimeout = useCallback(
    (profile: ChromeProfile) =>
      runBrowserCommandWithTimeout(
        profileApi.quitProfileBrowser(rootPath, profile.id),
        `${profile.name} 关闭运行账号`
      ),
    [rootPath, runBrowserCommandWithTimeout]
  );

  const setProfileWindowBoundsWithTimeout = useCallback(
    (profile: ChromeProfile, bounds: WindowBounds, actionLabel: string) => {
      return runBrowserCommandWithTimeout(
        profileApi.setProfileWindowBounds(rootPath, profile.id, bounds),
        `${profile.name} ${actionLabel}`
      );
    },
    [rootPath, runBrowserCommandWithTimeout]
  );

  const canStartBrowserOperationForProfiles = useCallback(
    (profilesToOperate: ChromeProfile[]) => {
      const conflicts = findActiveBrowserOperationProfileConflicts(
        browserOperationsRef.current,
        profilesToOperate.map((profile) => profile.id)
      );
      if (conflicts.length === 0) {
        return true;
      }

      onMessage(browserOperationConflictMessage(conflicts, profilesToOperate));
      return false;
    },
    [onMessage]
  );

  return {
    browserOperations,
    startWindowOperation,
    finishWindowOperation,
    startProfileOpenOperation,
    finishProfileOpenOperation,
    failProfileOpenOperation,
    startBulkOpenUrlOperation,
    startProjectOpenOperation,
    finishLaunchQueueOperation,
    runBrowserCommandWithTimeout,
    listProfileWindowsWithTimeout,
    focusProfileWindowWithTimeout,
    quitProfileBrowserWithTimeout,
    setProfileWindowBoundsWithTimeout,
    canStartBrowserOperationForProfiles
  };
}

function browserOperationConflictMessage(
  conflicts: BrowserOperationProfileConflict[],
  profilesToOperate: ChromeProfile[]
) {
  const profileNameById = new Map(
    profilesToOperate.map((profile) => [profile.id, profile.name])
  );
  const firstConflict = conflicts[0];
  const conflictingNames = firstConflict.profileIds.map(
    (profileId) => profileNameById.get(profileId) ?? profileId
  );
  const visibleNames = conflictingNames.slice(0, 2).join("、");
  const profileLabel =
    conflictingNames.length > 2
      ? `${visibleNames} 等 ${conflictingNames.length} 个账号`
      : visibleNames;
  return `${profileLabel} 正在执行${firstConflict.operation.sourceLabel}，请稍后再试`;
}
