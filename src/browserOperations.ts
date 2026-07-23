import type { BrowserLaunchQueueSummary } from "./browserSessionLaunch";

export type BrowserOperationStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled";

export type BrowserOperationType =
  | "profile-open"
  | "bulk-open-url"
  | "project-open"
  | "window-action"
  | "ai-action";

export type BrowserOperationTarget =
  | { kind: "profile" }
  | { kind: "url"; url: string }
  | {
      kind: "project";
      projectId: string;
      projectName: string;
      projectUrlIds: string[];
    }
  | { kind: "window"; action: string }
  | { kind: "ai"; action: string };

export interface BrowserOperation<Summary = unknown> {
  id: string;
  type: BrowserOperationType;
  status: BrowserOperationStatus;
  sourceLabel: string;
  profileIds: string[];
  target: BrowserOperationTarget;
  createdAt: number;
  startedAt: number | null;
  finishedAt: number | null;
  summary: Summary | null;
  cancelReason: string | null;
}

export interface CreateBrowserOperationInput {
  id: string;
  type: BrowserOperationType;
  sourceLabel: string;
  profileIds: string[];
  target: BrowserOperationTarget;
}

export interface BrowserOperationProfileConflict {
  operation: BrowserOperation;
  profileIds: string[];
}

export function createBrowserOperation(
  input: CreateBrowserOperationInput,
  createdAt = Date.now()
): BrowserOperation {
  return {
    id: input.id,
    type: input.type,
    status: "queued",
    sourceLabel: input.sourceLabel,
    profileIds: [...input.profileIds],
    target: input.target,
    createdAt,
    startedAt: null,
    finishedAt: null,
    summary: null,
    cancelReason: null
  };
}

export function startBrowserOperation<Summary>(
  operation: BrowserOperation<Summary>,
  startedAt = Date.now()
): BrowserOperation<Summary> {
  if (operation.status !== "queued") {
    throw new Error("只能启动 queued operation");
  }

  return {
    ...operation,
    status: "running",
    startedAt
  };
}

export function finishBrowserOperation<Summary>(
  operation: BrowserOperation<unknown>,
  status: Exclude<BrowserOperationStatus, "queued" | "running">,
  summary: Summary,
  finishedAt = Date.now()
): BrowserOperation<Summary> {
  if (operation.status !== "running") {
    throw new Error("只能结束 running operation");
  }

  return {
    ...operation,
    status,
    finishedAt,
    summary
  };
}

export function cancelBrowserOperation<Summary>(
  operation: BrowserOperation<Summary>,
  cancelReason: string,
  finishedAt = Date.now()
): BrowserOperation<Summary> {
  if (operation.status !== "queued" && operation.status !== "running") {
    throw new Error("只能取消 queued 或 running operation");
  }

  return {
    ...operation,
    status: "cancelled",
    finishedAt,
    cancelReason
  };
}

export function browserOperationStatusFromLaunchQueue(
  summary: BrowserLaunchQueueSummary
): Exclude<BrowserOperationStatus, "queued" | "running"> {
  if (summary.stopped) {
    return "cancelled";
  }

  return summary.failureCount > 0 ? "failed" : "succeeded";
}

export function isActiveBrowserOperationStatus(status: BrowserOperationStatus) {
  return status === "queued" || status === "running";
}

export function findActiveBrowserOperationProfileConflicts(
  operations: BrowserOperation[],
  profileIds: string[]
): BrowserOperationProfileConflict[] {
  const profileIdSet = new Set(profileIds);

  return operations
    .filter((operation) => isActiveBrowserOperationStatus(operation.status))
    .map((operation) => ({
      operation,
      profileIds: operation.profileIds.filter((profileId) => profileIdSet.has(profileId))
    }))
    .filter((conflict) => conflict.profileIds.length > 0);
}

export function trimBrowserOperations(
  operations: BrowserOperation[],
  maxOperations: number
) {
  const activeCount = operations.filter((operation) =>
    isActiveBrowserOperationStatus(operation.status)
  ).length;
  const inactiveLimit = Math.max(0, maxOperations - activeCount);
  let inactiveCount = 0;

  return operations.filter((operation) => {
    if (isActiveBrowserOperationStatus(operation.status)) {
      return true;
    }

    if (inactiveCount >= inactiveLimit) {
      return false;
    }

    inactiveCount += 1;
    return true;
  });
}

export function withBrowserOperationTimeout<T>(
  command: Promise<T>,
  timeoutMs: number,
  timeoutMessage: string
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  return new Promise<T>((resolve, reject) => {
    timeoutId = setTimeout(() => {
      timeoutId = null;
      reject(new Error(timeoutMessage));
    }, timeoutMs);

    command
      .then(resolve, reject)
      .finally(() => {
        if (timeoutId !== null) {
          clearTimeout(timeoutId);
        }
      });
  });
}
