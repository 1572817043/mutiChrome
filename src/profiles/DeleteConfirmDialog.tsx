import { X } from "lucide-react";
import type { ChromeProfile } from "../types";

export type DeleteMode = "record" | "data";

interface PendingDelete {
  profile: ChromeProfile;
  mode: DeleteMode;
}

interface DeleteConfirmDialogProps {
  pendingDelete: PendingDelete;
  onCancel: () => void;
  onConfirm: () => Promise<void> | void;
}

export function DeleteConfirmDialog({
  pendingDelete,
  onCancel,
  onConfirm
}: DeleteConfirmDialogProps) {
  const deletingData = pendingDelete.mode === "data";
  const titleId = "account-delete-confirm-title";
  const title = deletingData ? "确认删除账号和文件夹" : "确认只删除账号记录";

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
            <h2 id={titleId}>{title}</h2>
            <p>删除前再确认一次，避免误触。</p>
          </div>
          <button className="icon-button" type="button" aria-label="取消删除账号" onClick={onCancel}>
            <X size={18} />
          </button>
        </div>
        <p>
          {deletingData
            ? `${pendingDelete.profile.name} 的记录和 profile 文件夹都会被删除。`
            : `${pendingDelete.profile.name} 会从列表移除，profile 文件夹会保留。`}
        </p>
        <div className="confirm-actions">
          <button className="secondary-button" type="button" onClick={onCancel}>
            取消
          </button>
          <button
            className={`primary-button ${deletingData ? "danger" : ""}`}
            type="button"
            onClick={() => void onConfirm()}
          >
            确认删除
          </button>
        </div>
      </section>
    </div>
  );
}
