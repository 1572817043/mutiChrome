import type { BrowserLaunchQueueSummary } from "../../browserSessionLaunch";
import type {
  BrowserOperation,
  BrowserOperationStatus,
  BrowserOperationType
} from "../../browserOperations";
import { displayLaunchEventUrlLabel } from "../../shared/urlHelpers";

interface OperationListProps {
  operations: BrowserOperation[];
}

const RECENT_OPERATION_DISPLAY_LIMIT = 6;

export function OperationList({ operations }: OperationListProps) {
  const currentOperations = operations.filter((operation) =>
    isActiveBrowserOperation(operation.status)
  );
  const recentOperations = operations.filter(
    (operation) => !isActiveBrowserOperation(operation.status)
  );
  const visibleRecentOperations = recentOperations.slice(0, RECENT_OPERATION_DISPLAY_LIMIT);
  const recentCountLabel =
    recentOperations.length > RECENT_OPERATION_DISPLAY_LIMIT
      ? `最近 ${visibleRecentOperations.length} / ${recentOperations.length} 条`
      : recentOperations.length > 0
        ? `最近 ${recentOperations.length} 条`
        : "暂无记录";

  return (
    <div className="operation-panel" aria-label="操作面板">
      <OperationSection
        title="当前操作"
        countLabel={
          currentOperations.length > 0 ? `${currentOperations.length} 个进行中` : "空闲"
        }
        emptyLabel="没有正在运行的操作"
        listLabel="当前操作记录"
        operations={currentOperations}
      />
      <OperationSection
        title="最近操作"
        countLabel={recentCountLabel}
        emptyLabel="还没有最近操作"
        listLabel="最近操作记录"
        operations={visibleRecentOperations}
      />
    </div>
  );
}

interface OperationSectionProps {
  title: string;
  countLabel: string;
  emptyLabel: string;
  listLabel: string;
  operations: BrowserOperation[];
}

function OperationSection({
  title,
  countLabel,
  emptyLabel,
  listLabel,
  operations
}: OperationSectionProps) {
  return (
    <section className="operation-section" aria-label={title}>
      <div className="launch-event-header">
        <strong>{title}</strong>
        <span>{countLabel}</span>
      </div>
      {operations.length === 0 ? (
        <p className="launch-event-empty">{emptyLabel}</p>
      ) : (
        <ul className="operation-list" aria-label={listLabel}>
          {operations.map((operation) => {
            const detailLabel = operationDetailLabel(operation);
            return (
              <li
                className={`operation-row ${operation.status}`}
                key={operation.id}
              >
                <span className="operation-status">
                  {operationStatusLabel(operation.status)}
                </span>
                <span className="operation-type">
                  {operationTypeLabel(operation.type)}
                </span>
                <span className="operation-target-group">
                  <span className="operation-field-label">目标</span>
                  <span className="operation-target">
                    {operationTargetLabel(operation)}
                  </span>
                </span>
                <span className="operation-account-count">
                  {operationProfileCountLabel(operation)}
                </span>
                <span className="operation-progress-group">
                  <span className="operation-field-label">进度</span>
                  <span className="operation-progress">
                    {operationProgressLabel(operation)}
                  </span>
                </span>
                {detailLabel ? (
                  <p className="operation-detail">
                    {detailLabel}
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function isActiveBrowserOperation(status: BrowserOperationStatus) {
  return status === "queued" || status === "running";
}

function operationStatusLabel(status: BrowserOperationStatus): string {
  switch (status) {
    case "queued":
      return "排队中";
    case "running":
      return "运行中";
    case "succeeded":
      return "成功";
    case "failed":
      return "失败";
    case "cancelled":
      return "已取消";
  }
}

function operationTypeLabel(type: BrowserOperationType): string {
  switch (type) {
    case "profile-open":
      return "打开账号";
    case "bulk-open-url":
      return "批量打开";
    case "project-open":
      return "打开项目";
    case "window-action":
      return "窗口操作";
    case "ai-action":
      return "AI 操作";
  }
}

function operationTargetLabel(operation: BrowserOperation): string {
  if (operation.target.kind === "url") {
    return displayLaunchEventUrlLabel(operation.target.url);
  }

  if (operation.target.kind === "project") {
    return operation.target.projectName;
  }

  if (operation.target.kind === "window" || operation.target.kind === "ai") {
    return operation.target.action;
  }

  return `${operation.profileIds.length} 个账号`;
}

function operationProfileCountLabel(operation: BrowserOperation): string {
  return `${operation.profileIds.length} 个账号`;
}

function operationProgressLabel(operation: BrowserOperation): string {
  if (isBrowserLaunchQueueSummary(operation.summary)) {
    return `${operation.summary.successCount} / ${operation.summary.queuedCount}`;
  }

  return isActiveBrowserOperation(operation.status) ? "执行中" : "已结束";
}

function operationDetailLabel(operation: BrowserOperation): string {
  if (operation.cancelReason) {
    return `取消原因：${operation.cancelReason}`;
  }

  if (isBrowserLaunchQueueSummary(operation.summary)) {
    return operation.summary.failureCount > 0
      ? `失败原因：${formatLaunchFailureDetails(operation.summary)}`
      : "";
  }

  const windowSummary = operationWindowSummaryLabel(operation.summary);
  return windowSummary ? `结果：${windowSummary}` : "";
}

function formatLaunchFailureDetails(
  summary: BrowserLaunchQueueSummary,
  maxDetails = 2
): string {
  const visibleFailures = summary.failures.slice(0, maxDetails);
  const details = visibleFailures
    .map((failure) => `${failure.profileName}：${failure.message}`)
    .join("；");
  const hiddenCount = summary.failureCount - visibleFailures.length;
  return hiddenCount > 0 ? `${details}；另 ${hiddenCount} 个失败` : details;
}

function operationWindowSummaryLabel(summary: unknown): string {
  if (!summary || typeof summary !== "object" || isBrowserLaunchQueueSummary(summary)) {
    return "";
  }

  const candidate = summary as Record<string, unknown>;
  const parts = [
    windowSummaryCountLabel(candidate.inspectedCount, "已检查"),
    windowSummaryCountLabel(candidate.focusedCount, "已前置"),
    windowSummaryCountLabel(candidate.tiledCount, "已平铺"),
    windowSummaryCountLabel(candidate.syncedCount, "已同步"),
    windowSummaryCountLabel(candidate.failedCount, "失败"),
    windowSummaryCountLabel(candidate.noWindowCount, "无窗口"),
    windowSummaryCountLabel(candidate.minimizedCount, "最小化"),
    windowSummaryCountLabel(candidate.unchangedCount, "未生效"),
    windowSummaryCountLabel(candidate.focusFailedCount, "未能前置")
  ].filter((part): part is string => Boolean(part));

  return parts.join("，");
}

function windowSummaryCountLabel(value: unknown, label: string): string {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? `${label} ${value} 个`
    : "";
}

function isBrowserLaunchQueueSummary(
  summary: unknown
): summary is BrowserLaunchQueueSummary {
  if (!summary || typeof summary !== "object") {
    return false;
  }

  return (
    "successCount" in summary &&
    "queuedCount" in summary &&
    "failureCount" in summary &&
    "failures" in summary &&
    typeof summary.successCount === "number" &&
    typeof summary.queuedCount === "number" &&
    typeof summary.failureCount === "number" &&
    Array.isArray(summary.failures)
  );
}
