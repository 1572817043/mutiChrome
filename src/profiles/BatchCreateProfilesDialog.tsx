import { X } from "lucide-react";
import { parseBatchProfileLines } from "../domain/batchProfileParser";

interface BatchCreateProfilesDialogProps {
  value: string;
  onChange: (value: string) => void;
  onSave: () => void;
  onClose: () => void;
}

export function BatchCreateProfilesDialog({
  value,
  onChange,
  onSave,
  onClose
}: BatchCreateProfilesDialogProps) {
  const titleId = "batch-profile-title";
  const drafts = parseBatchProfileLines(value);
  const hasInput = value.trim().length > 0;

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <section
        className="modal-card edit-modal batch-profile-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="modal-header">
          <div>
            <h2 id={titleId}>批量新建账号</h2>
            <p>{drafts.length > 0 ? `${drafts.length} 个账号待创建` : "保存后才会创建账号记录"}</p>
          </div>
          <button
            className="icon-button"
            type="button"
            aria-label="取消批量新建"
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </div>

        <div className="modal-body">
          <div className="field">
            <label htmlFor="batch-profile-text">账号文本</label>
            <textarea
              id="batch-profile-text"
              aria-label="批量账号文本"
              rows={9}
              value={value}
              placeholder="测试号一, galxe x, Google 已登录"
              onChange={(event) => onChange(event.target.value)}
            />
            <div className="batch-profile-format-note">
              <strong>格式说明</strong>
              <small>每行一个账号，第一列必须是账号名称。</small>
              <small>支持：名称, 标签, 备注；名称 | 标签 | 备注；表格 Tab 分隔内容。</small>
            </div>
          </div>

          {drafts.length > 0 ? (
            <div className="batch-profile-preview" aria-label="批量账号预览">
              {drafts.slice(0, 5).map((draft, index) => (
                <div key={`${draft.name}-${index}`} className="batch-profile-preview-row">
                  <strong>{draft.name}</strong>
                  <span>{draft.tags.length > 0 ? draft.tags.join(", ") : "无标签"}</span>
                  <small>{draft.notes || "无备注"}</small>
                </div>
              ))}
              {drafts.length > 5 ? <small className="muted-line">另有 {drafts.length - 5} 个账号</small> : null}
            </div>
          ) : hasInput ? (
            <p className="batch-profile-empty">
              没有解析到可创建账号。请检查每行第一列是否有账号名称，并使用上面的格式粘贴。
            </p>
          ) : null}
        </div>

        <div className="modal-footer">
          <button className="secondary-button" type="button" onClick={onClose}>
            取消
          </button>
          <button
            className="primary-button"
            type="button"
            disabled={drafts.length === 0}
            onClick={onSave}
          >
            创建 {drafts.length} 个账号
          </button>
        </div>
      </section>
    </div>
  );
}
