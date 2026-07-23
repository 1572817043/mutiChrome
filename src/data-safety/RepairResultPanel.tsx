import type { RootRepairResult } from "../types";

interface RepairResultPanelProps {
  result: RootRepairResult;
}

export function RepairResultPanel({ result }: RepairResultPanelProps) {
  return (
    <div className="repair-result" aria-label="自动修复结果">
      <strong>自动修复结果</strong>
      {result.actions.length > 0 ? (
        <p className="repair-summary">已完成 {result.actions.length} 个自动修复动作。</p>
      ) : null}
      {result.actions.length === 0 ? (
        <>
          <p className="health-empty">没有可自动修复的问题。</p>
          <p className="repair-summary">
            自动修复只处理创建缺失目录这类低风险项，不会删除文件或覆盖损坏索引。
          </p>
        </>
      ) : (
        <ul className="repair-action-list">
          {result.actions.map((action) => (
            <li key={`${action.code}-${action.profileId ?? action.path ?? action.title}`}>
              <div>
                <strong>{action.title}</strong>
                {action.profileId ? <span>{action.profileId}</span> : null}
              </div>
              <p>{action.detail}</p>
              {action.path ? <code>{action.path}</code> : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
