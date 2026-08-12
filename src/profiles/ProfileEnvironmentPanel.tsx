import type { ProfileEnvironmentSnapshot } from "../api";

interface ProfileEnvironmentPanelProps {
  snapshot: ProfileEnvironmentSnapshot | null;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
}

const directoryStatusText: Record<ProfileEnvironmentSnapshot["directoryStatus"], string> = {
  ready: "已就绪",
  missing: "缺失",
  "not-directory": "路径不是文件夹",
  empty: "文件夹为空",
  unreadable: "无法读取"
};

export function ProfileEnvironmentPanel({
  snapshot,
  loading,
  error,
  onRefresh
}: ProfileEnvironmentPanelProps) {
  return (
    <section className="profile-environment-panel" aria-labelledby="profile-environment-title">
      <div className="runtime-tabs-header">
        <div>
          <h3 id="profile-environment-title">本地环境</h3>
          <p className="muted-line">只读概览，不会修改账号、浏览器或网络设置。</p>
        </div>
        <button
          className="secondary-button compact"
          type="button"
          disabled={loading}
          onClick={onRefresh}
        >
          {loading ? "读取中…" : "刷新本地环境"}
        </button>
      </div>

      {error ? <p className="runtime-tabs-error" role="alert">{error}</p> : null}

      {snapshot ? (
        <dl className="profile-environment-list">
          <div>
            <dt>受管 Profile 目录</dt>
            <dd>{snapshot.managedProfileRoot ? "是" : "否"}<br /><code>{snapshot.profileDir}</code></dd>
          </div>
          <div><dt>目录状态</dt><dd>{directoryStatusText[snapshot.directoryStatus]}</dd></div>
          <div><dt>账号登记</dt><dd>{snapshot.registered ? "已登记" : "未登记"}</dd></div>
          <div><dt>配置浏览器</dt><dd>{snapshot.browserAvailable ? "可用" : "不可用"}<br /><code>{snapshot.browserPath}</code></dd></div>
          <div><dt>运行状态</dt><dd>{snapshot.running ? "运行中" : "未运行"}</dd></div>
          {snapshot.healthIssues.length > 0 ? (
            <div><dt>关联健康项</dt><dd>{snapshot.healthIssues.map((issue) => issue.title).join("；")}</dd></div>
          ) : null}
        </dl>
      ) : (
        <p className="muted-line">按“刷新本地环境”读取当前账号的本地隔离状态。</p>
      )}
    </section>
  );
}
