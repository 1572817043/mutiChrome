import { X } from "lucide-react";
import type { ChromeProfile } from "../types";
import type { DeleteMode } from "../profiles/DeleteConfirmDialog";

interface BatchDeleteConfirmDialogProps {
  profiles: ChromeProfile[];
  working: DeleteMode | null;
  onCancel: () => void;
  onConfirm: (mode: DeleteMode) => Promise<void> | void;
}

export function BatchDeleteConfirmDialog({
  profiles,
  working,
  onCancel,
  onConfirm
}: BatchDeleteConfirmDialogProps) {
  const titleId = "batch-delete-confirm-title";

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
            <h2 id={titleId}>确认批量删除账号</h2>
            <p>删除前再确认一次，避免误触。</p>
          </div>
          <button
            className="icon-button"
            type="button"
            aria-label="取消批量删除账号"
            onClick={onCancel}
          >
            <X size={18} />
          </button>
        </div>
        <p>将删除 {profiles.length} 个账号。</p>
        <div className="confirm-actions">
          <button className="secondary-button" type="button" onClick={onCancel}>
            取消
          </button>
          <button
            className="secondary-button danger"
            type="button"
            disabled={working !== null}
            onClick={() => void onConfirm("record")}
          >
            {working === "record" ? "删除中" : "只删除记录"}
          </button>
          <button
            className="primary-button danger"
            type="button"
            disabled={working !== null}
            onClick={() => void onConfirm("data")}
          >
            {working === "data" ? "删除中" : "删除记录和文件夹"}
          </button>
        </div>
      </section>
    </div>
  );
}
