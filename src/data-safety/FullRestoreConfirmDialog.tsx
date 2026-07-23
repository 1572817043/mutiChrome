import { X } from "lucide-react";
import type { FullProfileRestorePreview } from "../types";

interface FullRestoreConfirmDialogProps {
  preview: FullProfileRestorePreview;
  working: boolean;
  onCancel: () => void;
  onConfirm: () => Promise<void> | void;
}

export function FullRestoreConfirmDialog({
  preview,
  working,
  onCancel,
  onConfirm
}: FullRestoreConfirmDialogProps) {
  const titleId = "full-restore-confirm-title";
  const summaryText = `扫描结果：共 ${preview.profileCount} 个账号，新增 ${preview.newProfileIds.length} 个，覆盖 ${preview.overwriteProfileIds.length} 个。`;

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onCancel();
        }
      }}
    >
      <section
        className="modal-card delete-confirm-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="modal-header">
          <div>
            <h2 id={titleId}>确认恢复完整备份</h2>
            <p>最后一步：确认新增和覆盖范围。</p>
          </div>
          <button
            className="icon-button"
            type="button"
            aria-label="取消恢复完整备份"
            onClick={onCancel}
          >
            <X size={18} />
          </button>
        </div>
        <p>{summaryText}</p>
        <ul className="restore-risk-list">
          <li>覆盖项会按现有恢复流程替换同 ID 的账号资料和 Chrome profile 文件夹。</li>
          <li>备份中没有出现的其他账号会保留；不会合并同 ID profile 文件夹内容。</li>
        </ul>
        <code className="confirm-path">{preview.path}</code>
        <div className="confirm-actions">
          <button className="secondary-button" type="button" onClick={onCancel}>
            取消
          </button>
          <button
            className="primary-button danger"
            type="button"
            disabled={working}
            onClick={() => void onConfirm()}
          >
            {working ? "恢复中" : "确认恢复"}
          </button>
        </div>
      </section>
    </div>
  );
}
