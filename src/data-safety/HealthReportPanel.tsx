import { UserPlus } from "lucide-react";
import type { RootHealthReport } from "../types";

interface HealthReportPanelProps {
  report: RootHealthReport;
  registeringOrphanId: string | null;
  onRegisterOrphan: (profileId: string) => Promise<void> | void;
}

export function HealthReportPanel({
  report,
  registeringOrphanId,
  onRegisterOrphan
}: HealthReportPanelProps) {
  const { profileCount, warningCount, errorCount } = report.summary;
  const isClean = report.issues.length === 0;
  const statusMessage = isClean
    ? "检查通过"
    : errorCount > 0
      ? "需要处理：先看错误，再处理提醒。"
      : "有提醒：建议确认后再做备份或恢复。";

  return (
    <div className="health-report" aria-label="目录健康检查结果">
      <div className="health-summary">
        <span>{profileCount} 个账号</span>
        {errorCount > 0 ? <span className="health-chip error">{errorCount} 个错误</span> : null}
        {warningCount > 0 ? (
          <span className="health-chip warning">{warningCount} 个提醒</span>
        ) : null}
        {isClean ? <span className="health-chip active">未发现问题</span> : null}
      </div>
      <p className={`health-state-line ${isClean ? "active" : errorCount > 0 ? "error" : "warning"}`}>
        {statusMessage}
      </p>

      {isClean ? (
        <p className="health-empty">索引和配置目录当前一致。</p>
      ) : (
        <ul className="health-issue-list">
          {report.issues.map((issue) => {
            const orphanProfileId =
              issue.code === "orphan_profile_dir" ? issue.profileId : null;
            return (
              <li key={`${issue.code}-${issue.profileId ?? issue.path ?? issue.title}`}>
                <div>
                  <span className={`health-severity ${issue.severity}`}>
                    {issue.severity === "error" ? "错误" : "提醒"}
                  </span>
                  <strong>{issue.title}</strong>
                </div>
                <p>{issue.detail}</p>
                {issue.path ? <code>{issue.path}</code> : null}
                {orphanProfileId ? (
                  <>
                    <p className="health-issue-note">
                      登记只会加入账号索引，不复制、不移动、不删除这个目录。
                    </p>
                    <button
                      className="secondary-button compact health-issue-action"
                      type="button"
                      aria-label={`登记为账号 ${orphanProfileId}`}
                      disabled={registeringOrphanId === orphanProfileId}
                      onClick={() => void onRegisterOrphan(orphanProfileId)}
                    >
                      <UserPlus size={15} />
                      {registeringOrphanId === orphanProfileId ? "登记中" : "登记为账号"}
                    </button>
                  </>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
