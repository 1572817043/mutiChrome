import type { WindowSyncPlan, WindowSyncSkipReason, WindowSyncSourceStatus } from "../../browserWindows";
import { errorMessage } from "../../shared/windowAutomationErrors";
import type {
  WindowSyncDetails,
  WindowSyncResultEntry
} from "./windowSyncController";

interface WindowSyncDetailsPanelProps {
  details: WindowSyncDetails | null;
}

const sourceStatusLabels: Record<WindowSyncSourceStatus, string> = {
  ready: "可同步",
  "missing-window": "没有可同步窗口",
  "minimized-window": "窗口已最小化",
  "window-error": "读取失败"
};

const skipReasonLabels: Record<WindowSyncSkipReason, string> = {
  "missing-window": "没有可同步窗口",
  "minimized-window": "窗口已最小化",
  "window-error": "读取失败"
};

const resultStatusLabels: Record<WindowSyncResultEntry["status"], string> = {
  synced: "同步成功",
  unchanged: "未生效",
  failed: "失败"
};

function formatBounds(bounds: { x: number; y: number; width: number; height: number }) {
  return `${bounds.width}x${bounds.height} @ ${bounds.x},${bounds.y}`;
}

function sourceStatusText(plan: WindowSyncPlan): string {
  const status = sourceStatusLabels[plan.sourceStatus];
  return plan.sourceStatus === "ready"
    ? `主账号：${plan.sourceProfileName}`
    : `主账号：${plan.sourceProfileName}（${status}${plan.sourceWindowError ? `：${plan.sourceWindowError}` : ""}）`;
}

function skippedText(profileName: string, reason: WindowSyncSkipReason): string {
  return `${profileName}：${skipReasonLabels[reason]}`;
}

function renderSkipped(plan: WindowSyncPlan) {
  if (plan.skipped.length === 0) {
    return <p className="muted-line">没有跳过的账号</p>;
  }

  return (
    <ul className="window-sync-details-list" aria-label="跳过账号">
      {plan.skipped.map((entry) => (
        <li key={entry.profileId}>{skippedText(entry.profileName, entry.reason)}</li>
      ))}
    </ul>
  );
}

function renderResultEntry(entry: WindowSyncResultEntry) {
  const error = entry.error ? `：${errorMessage(entry.error)}` : "";
  return (
    <li key={entry.profileId}>
      {entry.profileName}：{resultStatusLabels[entry.status]}{error}
    </li>
  );
}

export function WindowSyncDetailsPanel({ details }: WindowSyncDetailsPanelProps) {
  return (
    <section className="window-sync-details-panel" aria-label="同步详情">
      <div className="window-sync-details-header">
        <strong>同步详情</strong>
        <span>{details?.mode === "result" ? "结果" : details ? "预览" : ""}</span>
      </div>
      {!details ? (
        <p className="muted-line">尚未预览或同步布局</p>
      ) : (
        <>
          <p className="window-sync-details-source">{sourceStatusText(details.plan)}</p>
          {details.plan.sourceBounds ? (
            <p className="window-sync-details-source">
              目标 bounds：{formatBounds(details.plan.sourceBounds)}
            </p>
          ) : null}
          {details.mode === "preview" ? (
            <>
              <strong>将同步到</strong>
              {details.plan.placements.length === 0 ? (
                <p className="muted-line">没有可同步的目标账号</p>
              ) : (
                <ul className="window-sync-details-list" aria-label="同步目标">
                  {details.plan.placements.map((placement) => (
                    <li key={placement.profileId}>
                      {placement.profileName}：{formatBounds(placement.bounds)}
                    </li>
                  ))}
                </ul>
              )}
              <strong>跳过账号</strong>
              {renderSkipped(details.plan)}
            </>
          ) : (
            <>
              <strong>执行结果</strong>
              {details.result.entries.length === 0 ? (
                <p className="muted-line">没有执行目标账号</p>
              ) : (
                <ul className="window-sync-details-list" aria-label="执行结果">
                  {details.result.entries.map(renderResultEntry)}
                </ul>
              )}
              <strong>跳过账号</strong>
              {renderSkipped(details.plan)}
            </>
          )}
        </>
      )}
    </section>
  );
}
