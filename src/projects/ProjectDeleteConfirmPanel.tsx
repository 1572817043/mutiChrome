import type { AirdropProject } from "../types";

interface ProjectDeleteConfirmPanelProps {
  project: AirdropProject;
  onCancel: () => void;
  onConfirm: () => Promise<void>;
}

export function ProjectDeleteConfirmPanel({
  project,
  onCancel,
  onConfirm
}: ProjectDeleteConfirmPanelProps) {
  return (
    <div className="confirm-panel">
      <div>
        <strong>确认删除项目</strong>
        <p>{project.name} 会从项目列表移除，不会删除任何 Chrome profile。</p>
      </div>
      <div className="confirm-actions">
        <button className="secondary-button compact" type="button" onClick={onCancel}>
          取消
        </button>
        <button
          className="primary-button compact danger"
          type="button"
          aria-label="确认删除项目"
          onClick={() => void onConfirm()}
        >
          确认删除
        </button>
      </div>
    </div>
  );
}
