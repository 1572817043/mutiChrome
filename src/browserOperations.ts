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

export type WindowOperationSummaryAction = "inspect" | "tile" | "sync-layout";
export type WindowOperationSummaryReason =
  | "inspect-failed"
  | "missing-source-window"
  | "minimized-source-window"
  | "source-window-error"
  | "sync-layout-error";

export interface WindowOperationSummary {
  summaryType: "window-operation";
  action: WindowOperationSummaryAction;
  profileCount: number;
  succeededCount: number;
  skippedCount: number;
  failedCount: number;
  focusFailedCount: number;
  sourceProfileId?: string;
  noWindowCount?: number;
  minimizedCount?: number;
  unchangedCount?: number;
  multiWindowProfileCount?: number;
  tileableCount?: number;
  capacity?: number;
  capacityExceeded?: boolean;
  reason?: WindowOperationSummaryReason;
}

export interface BuildInspectWindowOperationSummaryInput {
  profileCount: number;
  inspectedCount?: number;
  failedCount?: number;
  reason?: WindowOperationSummaryReason;
}

export interface BuildTileWindowOperationSummaryInput {
  profileCount: number;
  tileableCount?: number;
  tiledCount?: number;
  unchangedCount?: number;
  noWindowCount?: number;
  multiWindowProfileCount?: number;
  failedCount?: number;
  focusFailedCount?: number;
  capacity?: number;
  capacityExceeded?: boolean;
}

export interface BuildSyncLayoutWindowOperationSummaryInput {
  profileCount: number;
  sourceProfileId: string;
  syncedCount?: number;
  noWindowCount?: number;
  minimizedCount?: number;
  unchangedCount?: number;
  failedCount?: number;
  focusFailedCount?: number;
  reason?: WindowOperationSummaryReason;
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

export function buildInspectWindowOperationSummary(
  input: BuildInspectWindowOperationSummaryInput
): WindowOperationSummary {
  const succeededCount = numberOrZero(input.inspectedCount);

  return {
    summaryType: "window-operation",
    action: "inspect",
    profileCount: input.profileCount,
    succeededCount,
    skippedCount: 0,
    failedCount: numberOrZero(input.failedCount),
    focusFailedCount: 0,
    reason: input.reason
  };
}

export function buildTileWindowOperationSummary(
  input: BuildTileWindowOperationSummaryInput
): WindowOperationSummary {
  const noWindowCount = numberOrZero(input.noWindowCount);
  const skippedCount = input.capacityExceeded
    ? numberOrZero(input.tileableCount) + noWindowCount
    : noWindowCount;

  return {
    summaryType: "window-operation",
    action: "tile",
    profileCount: input.profileCount,
    succeededCount: numberOrZero(input.tiledCount),
    skippedCount,
    failedCount: numberOrZero(input.failedCount),
    focusFailedCount: numberOrZero(input.focusFailedCount),
    noWindowCount,
    unchangedCount: numberOrZero(input.unchangedCount),
    multiWindowProfileCount: numberOrZero(input.multiWindowProfileCount),
    tileableCount: numberOrZero(input.tileableCount),
    capacity: input.capacity,
    capacityExceeded: input.capacityExceeded
  };
}

export function buildSyncLayoutWindowOperationSummary(
  input: BuildSyncLayoutWindowOperationSummaryInput
): WindowOperationSummary {
  const noWindowCount = numberOrZero(input.noWindowCount);
  const minimizedCount = numberOrZero(input.minimizedCount);

  return {
    summaryType: "window-operation",
    action: "sync-layout",
    profileCount: input.profileCount,
    sourceProfileId: input.sourceProfileId,
    succeededCount: numberOrZero(input.syncedCount),
    skippedCount: noWindowCount + minimizedCount,
    failedCount: numberOrZero(input.failedCount),
    focusFailedCount: numberOrZero(input.focusFailedCount),
    noWindowCount,
    minimizedCount,
    unchangedCount: numberOrZero(input.unchangedCount),
    reason: input.reason
  };
}

export function isWindowOperationSummary(
  summary: unknown
): summary is WindowOperationSummary {
  if (!summary || typeof summary !== "object") {
    return false;
  }

  const candidate = summary as Record<string, unknown>;
  return (
    candidate.summaryType === "window-operation" &&
    isWindowOperationSummaryAction(candidate.action) &&
    typeof candidate.profileCount === "number" &&
    typeof candidate.succeededCount === "number" &&
    typeof candidate.skippedCount === "number" &&
    typeof candidate.failedCount === "number" &&
    typeof candidate.focusFailedCount === "number" &&
    optionalString(candidate.sourceProfileId) &&
    optionalNumber(candidate.noWindowCount) &&
    optionalNumber(candidate.minimizedCount) &&
    optionalNumber(candidate.unchangedCount) &&
    optionalNumber(candidate.multiWindowProfileCount) &&
    optionalNumber(candidate.tileableCount) &&
    optionalNumber(candidate.capacity) &&
    optionalBoolean(candidate.capacityExceeded) &&
    optionalString(candidate.reason)
  );
}

export function formatWindowOperationSummary(
  summary: WindowOperationSummary
): string {
  if (summary.capacityExceeded) {
    const reasonSuffix = windowOperationReasonLabel(summary.reason);
    return [
      positiveCountLabel(summary.tileableCount, "可平铺"),
      typeof summary.capacity === "number" ? `屏幕容量 ${summary.capacity} 个` : "",
      "已超限",
      reasonSuffix
    ].filter(Boolean).join("，");
  }

  const reasonLabel = windowOperationReasonLabel(summary.reason);
  if (reasonLabel) {
    return reasonLabel;
  }

  const parts = [
    windowOperationSuccessLabel(summary),
    positiveCountLabel(summary.failedCount, "失败"),
    positiveCountLabel(summary.noWindowCount, "无窗口"),
    positiveCountLabel(summary.minimizedCount, "最小化"),
    positiveCountLabel(summary.unchangedCount, "未生效"),
    positiveCountLabel(summary.multiWindowProfileCount, "多窗口"),
    positiveCountLabel(summary.focusFailedCount, "未能前置")
  ].filter((part): part is string => Boolean(part));

  return parts.join("，");
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

function numberOrZero(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function windowOperationSuccessLabel(summary: WindowOperationSummary): string {
  switch (summary.action) {
    case "inspect":
      return `已检查 ${summary.succeededCount} / ${summary.profileCount}`;
    case "tile":
      return `已平铺 ${summary.succeededCount} / ${summary.profileCount}`;
    case "sync-layout":
      return `已同步 ${summary.succeededCount} / ${summary.profileCount}`;
    default: {
      const exhaustive: never = summary.action;
      return exhaustive;
    }
  }
}

function isWindowOperationSummaryAction(
  action: unknown
): action is WindowOperationSummaryAction {
  return action === "inspect" || action === "tile" || action === "sync-layout";
}

function optionalString(value: unknown): boolean {
  return value === undefined || typeof value === "string";
}

function optionalNumber(value: unknown): boolean {
  return value === undefined || typeof value === "number";
}

function optionalBoolean(value: unknown): boolean {
  return value === undefined || typeof value === "boolean";
}

function windowOperationReasonLabel(
  reason: WindowOperationSummaryReason | undefined
): string {
  switch (reason) {
    case "missing-source-window":
      return "主账号无窗口";
    case "minimized-source-window":
      return "主账号窗口已最小化";
    case "source-window-error":
      return "主账号窗口读取失败";
    case "sync-layout-error":
      return "同步布局失败";
    case "inspect-failed":
      return "窗口检查失败";
    case undefined:
      return "";
    default: {
      const exhaustive: never = reason;
      return exhaustive;
    }
  }
}

function positiveCountLabel(value: number | undefined, label: string): string {
  return numberOrZero(value) > 0 ? `${label} ${numberOrZero(value)} 个` : "";
}
